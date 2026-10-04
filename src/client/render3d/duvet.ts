// The duvet over a bed's sleepers, draped rather than a box: a cloth surface
// settled over the bodies beneath it, the way a cloth simulation settles
// over a character's collision capsules (Chaos Cloth over a MetaHuman's
// physics asset), computed directly as a height field — each sleeper's
// limbs and trunk as capsules, the cloth's own thickness over them, the
// tension that keeps it from sinking into the gaps between them, and a
// skirt hanging to the mattress at the edges. The body beneath is not drawn
// (humans.ts hides it within the duvet's footprint, as MetaHuman hides the
// body under a garment), so nothing can poke through.
import * as THREE from 'three';

/** A capsule in the duvet's own frame: x across the bed, y up from the mattress, z along it toward the feet. */
export interface Capsule {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

/** The cloth's thickness lying flat on the mattress, and over a body. */
export const DUVET_BASE = 0.08;
export const DUVET_CLOTH = 0.035;

/**
 * The height of the draped surface at each point of an (nx + 1) × (nz + 1) grid over the duvet's footprint,
 * row by row along the bed (i = 0 at the head end), written to `out`: the cloth's thickness on the mattress,
 * lifted over each capsule to its top plus the cloth, relaxed so it spans small gaps rather than sinking into
 * them, and smoothed, never below the bodies.
 */
export function drape(nx: number, nz: number, wide: number, long: number, base: number, cloth: number, caps: Capsule[], out: Float32Array, slack = 0.012): void {
  const W = nx + 1;
  const H = nz + 1;
  const raw = new Float32Array(W * H);
  for (let i = 0; i < H; i++) {
    const z = -long / 2 + (long * i) / nz;
    for (let j = 0; j < W; j++) {
      const x = -wide / 2 + (wide * j) / nx;
      let h = base;
      for (const c of caps) {
        const dx = c.bx - c.ax;
        const dz = c.bz - c.az;
        const L2 = dx * dx + dz * dz;
        const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / L2)) : 0;
        const qx = c.ax + t * dx;
        const qz = c.az + t * dz;
        const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
        if (d2 >= c.r * c.r) continue;
        const top = c.ay + t * (c.by - c.ay) + Math.sqrt(c.r * c.r - d2) + cloth;
        if (top > h) h = top;
      }
      raw[i * W + j] = h;
    }
  }
  out.set(raw);
  const tmp = new Float32Array(W * H);
  const around = (src: Float32Array, i: number, j: number): [number, number] => {
    let s = 0;
    let n = 0;
    if (i > 0) (s += src[(i - 1) * W + j]), n++;
    if (i < H - 1) (s += src[(i + 1) * W + j]), n++;
    if (j > 0) (s += src[i * W + j - 1]), n++;
    if (j < W - 1) (s += src[i * W + j + 1]), n++;
    return [s, n];
  };
  // Tension: the cloth spans a gap narrower than its slack rather than dipping into it.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < H; i++) {
      for (let j = 0; j < W; j++) {
        const [s, n] = around(out, i, j);
        const v = s / n - slack;
        if (v > out[i * W + j]) out[i * W + j] = v;
      }
    }
  }
  // Smoothed, then lifted back over the bodies wherever the smoothing sank it.
  for (let i = 0; i < H; i++) {
    for (let j = 0; j < W; j++) {
      const [s, n] = around(out, i, j);
      tmp[i * W + j] = (out[i * W + j] * 4 + s) / (4 + n);
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = Math.max(tmp[k], raw[k]);
}

const NX = 16;
const NZ = 28;

/** One duvet: a mesh whose top follows the drape and whose skirt hangs to the mattress, laid where the bed is. */
export class Duvet {
  readonly mesh: THREE.Mesh;
  private readonly top = new Float32Array((NX + 1) * (NZ + 1));
  private readonly pos: Float32Array;
  private readonly ring: number[] = [];
  private readonly nTop = (NX + 1) * (NZ + 1);
  private wide = 1;
  private long = 1.5;

  constructor(material: THREE.Material) {
    // The perimeter of the top grid, in order, for the skirt.
    for (let j = 0; j <= NX; j++) this.ring.push(j);
    for (let i = 1; i <= NZ; i++) this.ring.push(i * (NX + 1) + NX);
    for (let j = NX - 1; j >= 0; j--) this.ring.push(NZ * (NX + 1) + j);
    for (let i = NZ - 1; i >= 1; i--) this.ring.push(i * (NX + 1));
    const n = this.nTop + this.ring.length;
    this.pos = new Float32Array(n * 3);
    const index: number[] = [];
    for (let i = 0; i < NZ; i++) {
      for (let j = 0; j < NX; j++) {
        const a = i * (NX + 1) + j;
        const b = a + 1;
        const c = a + NX + 1;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const R = this.ring.length;
    for (let k = 0; k < R; k++) {
      const t0 = this.ring[k];
      const t1 = this.ring[(k + 1) % R];
      const b0 = this.nTop + k;
      const b1 = this.nTop + ((k + 1) % R);
      index.push(t0, t1, b0, t1, b1, b0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /**
   * Lay the duvet: its centre and heading (the sleepers' frame: +z toward the feet), its size, the mattress's
   * height, and the sleepers' capsules in world space.
   */
  update(cx: number, cz: number, yaw: number, wide: number, long: number, mattressY: number, world: Capsule[]): void {
    this.wide = wide;
    this.long = long;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const local = world.map((c) => ({
      ax: (c.ax - cx) * cs - (c.az - cz) * sn,
      ay: c.ay - mattressY,
      az: (c.ax - cx) * sn + (c.az - cz) * cs,
      bx: (c.bx - cx) * cs - (c.bz - cz) * sn,
      by: c.by - mattressY,
      bz: (c.bx - cx) * sn + (c.bz - cz) * cs,
      r: c.r,
    }));
    drape(NX, NZ, wide, long, DUVET_BASE, DUVET_CLOTH, local, this.top);
    const p = this.pos;
    for (let i = 0; i <= NZ; i++) {
      for (let j = 0; j <= NX; j++) {
        const k = i * (NX + 1) + j;
        p[k * 3] = -wide / 2 + (wide * j) / NX;
        p[k * 3 + 1] = this.top[k];
        p[k * 3 + 2] = -long / 2 + (long * i) / NZ;
      }
    }
    // The skirt: straight down from the edge to just above the mattress.
    this.ring.forEach((t, k) => {
      const b = this.nTop + k;
      p[b * 3] = p[t * 3];
      p[b * 3 + 1] = 0.004;
      p[b * 3 + 2] = p[t * 3 + 2];
    });
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.position.set(cx, mattressY, cz);
    this.mesh.rotation.set(0, yaw, 0);
  }

  /** The footprint's half-extents (across, the height everything beneath is hidden to, along) and the inverse of its frame. */
  footprint(inv: THREE.Matrix4, half: THREE.Vector3): void {
    this.mesh.updateMatrixWorld(true);
    inv.copy(this.mesh.matrixWorld).invert();
    half.set(this.wide / 2, 0.6, this.long / 2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
