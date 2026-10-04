// One person's body, built from the kit: shaped by their parameters, posed
// into the rest pose, scaled to their height with the soles on the ground.
// Proxies (clothes, hair, eyes...) are fitted to the shaped body as modelled
// and then carried through the same rest pose and scale, so they sit on it
// exactly as MakeHuman fits them.
import type { Kit } from './kit';
import { deform, restPose, type Rest } from './rest';
import { morph, targetWeights, type BodyParams } from './shape';

export interface Body {
  /** Shipped vertices as modelled (MakeHuman's pose, unscaled): what proxies are fitted to. */
  modelled: Float32Array;
  /** Shipped vertices in the rest pose, scaled, soles at y = 0. */
  pos: Float32Array;
  /** Bones then points, in the rest pose, scaled. */
  joints: Float32Array;
  rest: Rest;
  scale: number;
  /** Subtracted from y (before scaling) to put the soles on the ground. */
  floor: number;
  height: number;
}

/** The body for these parameters at this standing height (metres). */
export function buildBody(kit: Kit, p: BodyParams, height: number): Body {
  const modelled = new Float32Array(kit.base.length);
  const joints = new Float32Array(kit.joints.length);
  morph(kit, targetWeights(kit, p), modelled, joints);
  const rest = restPose(kit.boneNames, kit.boneParents, kit.points, joints);
  const pos = new Float32Array(modelled.length);
  deform(modelled, pos, kit.vertices, kit.skinIndex, kit.skinWeight, rest.matrices);
  // Standing height: the soles (the body's lowest point) to the top of the head.
  const nb = kit.meta.body.vertices;
  const src = kit.array('body.src') as Uint16Array;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < nb; i++) {
    const y = pos[src[i] * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const scale = height / Math.max(0.2, hi - lo);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= scale;
    pos[i + 1] = (pos[i + 1] - lo) * scale;
    pos[i + 2] *= scale;
  }
  const jr = rest.joints;
  for (let i = 0; i < jr.length; i += 3) {
    jr[i] *= scale;
    jr[i + 1] = (jr[i + 1] - lo) * scale;
    jr[i + 2] *= scale;
  }
  return { modelled, pos, joints: jr, rest, scale, floor: lo, height };
}

/** Carry points fitted to the modelled body (a proxy) into the body's rest pose and scale. */
export function toRest(body: Body, pts: Float32Array, count: number, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>): void {
  deform(pts, pts, count, skinIndex, skinWeight, body.rest.matrices);
  const s = body.scale;
  for (let i = 0; i < count * 3; i += 3) {
    pts[i] *= s;
    pts[i + 1] = (pts[i + 1] - body.floor) * s;
    pts[i + 2] *= s;
  }
}

/**
 * Smooth normals for a triangle mesh whose vertices are copies (texture seams) of fewer positions:
 * accumulated per position (src), so a seam does not show.
 */
export function seamlessNormals(pos: Float32Array, src: ArrayLike<number>, index: ArrayLike<number>, nPos: number, out: Float32Array): void {
  const acc = new Float32Array(nPos * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = src[index[t]] * 3;
    const b = src[index[t + 1]] * 3;
    const c = src[index[t + 2]] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    acc[a] += nx;
    acc[a + 1] += ny;
    acc[a + 2] += nz;
    acc[b] += nx;
    acc[b + 1] += ny;
    acc[b + 2] += nz;
    acc[c] += nx;
    acc[c + 1] += ny;
    acc[c + 2] += nz;
  }
  for (let i = 0; i < src.length; i++) {
    const s = src[i] * 3;
    const x = acc[s];
    const y = acc[s + 1];
    const z = acc[s + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l;
    out[i * 3 + 1] = y / l;
    out[i * 3 + 2] = z / l;
  }
}

/** Positions for a mesh's vertices from the positions they copy. */
export function gather(pos: Float32Array, src: ArrayLike<number>, out: Float32Array): void {
  for (let i = 0; i < src.length; i++) {
    const s = src[i] * 3;
    out[i * 3] = pos[s];
    out[i * 3 + 1] = pos[s + 1];
    out[i * 3 + 2] = pos[s + 2];
  }
}
