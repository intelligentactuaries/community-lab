// Shared geometry: rounded boxes, capsules, spheres and cylinders, cached by
// size; and a batch that collects the pieces of a building (walls, floors,
// furniture) and merges them into one mesh per material.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map<string, THREE.BufferGeometry>();
const q = (v: number) => Math.round(v * 1000) / 1000;

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

/** A box with rounded edges (radius clamped to the smallest half-side). */
export function rbox(w: number, h: number, d: number, r = 0.04, seg = 2): THREE.BufferGeometry {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return cached(`rb|${q(w)}|${q(h)}|${q(d)}|${q(rr)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`b|${q(w)}|${q(h)}|${q(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

export function sphere(r: number, ws = 22, hs = 16): THREE.BufferGeometry {
  return cached(`s|${q(r)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

/** A capsule of radius r whose straight part is len long, standing on the y axis. */
export function capsule(r: number, len: number, cap = 6, radial = 14): THREE.BufferGeometry {
  return cached(`c|${q(r)}|${q(len)}|${cap}|${radial}`, () => new THREE.CapsuleGeometry(r, len, cap, radial));
}

export function cyl(rt: number, rb: number, h: number, seg = 18): THREE.BufferGeometry {
  return cached(`y|${q(rt)}|${q(rb)}|${q(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

export function plane(w: number, d: number): THREE.BufferGeometry {
  return cached(`p|${q(w)}|${q(d)}`, () => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2));
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** A transform from position, a yaw (about y) and optional pitch/roll and scale. */
export function xf(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0): THREE.Matrix4 {
  tmpE.set(pitch, yaw, roll, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpV.set(x, y, z);
  tmpS.set(sx, sy, sz);
  return tmpM.clone().compose(tmpV, tmpQ, tmpS);
}

/**
 * Collects transformed copies of geometries by material, then merges each
 * material's pieces into one mesh: a furnished building becomes a few draw
 * calls. Every piece is converted to non-indexed position/normal/uv so any
 * mix of primitives merges.
 */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material, matrix: THREE.Matrix4): void {
    const c = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(c.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((c.attributes.position.count) * 2), 2));
    c.applyMatrix4(matrix);
    c.clearGroups();
    let arr = this.parts.get(m);
    if (!arr) {
      arr = [];
      this.parts.set(m, arr);
    }
    arr.push(c);
  }
  get empty(): boolean {
    return this.parts.size === 0;
  }
  /** One mesh per material. Receives shadows; casts them unless told otherwise. */
  build(opts: { cast?: boolean; receive?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    for (const [m, geos] of this.parts) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      // Materials that tile in world space (floors) get their UVs from the position.
      const scale = (m.userData as { uvScale?: number }).uvScale;
      if (scale) {
        const pos = merged.attributes.position;
        const uv = merged.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / scale, pos.getZ(i) / scale);
      }
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = opts.cast ?? true;
      mesh.receiveShadow = opts.receive ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
      if (geos.length > 1) for (const x of geos) x.dispose();
    }
    this.parts.clear();
    return g;
  }
}

/** Dispose every geometry under an object that is not one of the shared cached ones. */
export function disposeTree(o: THREE.Object3D): void {
  const shared = new Set(cache.values());
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
  });
}
