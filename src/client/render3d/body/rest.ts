// The rest pose every body is bound in. MakeHuman models its people with the
// arms 42° from the sides, elbows bent forward and the legs apart; the
// animator (motion.ts) wants the pose the old model had: arms straight, 30°
// out in the frontal plane, palms toward the body, legs straight and nearly
// together. Each body is posed into it once, as it is built (a linear blend of
// its own bones about its own joints, so a child's shoulder turns about a
// child's shoulder), with the fingers given a relaxed curl on the way.
import * as THREE from 'three';

/** The arms' angle from the sides in the rest pose (motion.ts relies on it). */
export const A_POSE = (30 * Math.PI) / 180;
/** The legs' angle from vertical. */
const LEG_OUT = (2 * Math.PI) / 180;
const D = Math.PI / 180;
/** A relaxed hand: each finger's three joints (knuckle, middle, tip), degrees; the thumb first. */
const CURL: Record<number, [number, number, number]> = { 1: [6, 12, 10], 2: [14, 24, 12], 3: [18, 30, 14], 4: [22, 34, 16], 5: [26, 38, 18] };

export interface Rest {
  /** Per bone: 3×4 matrices (row-major rotation | translation) taking the modelled pose to the rest pose. */
  matrices: Float32Array;
  /** Joints (bones then points) in the rest pose. */
  joints: Float32Array;
}

const qa = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();

/**
 * The rotations that take a body from MakeHuman's pose to the rest pose, bone by bone (world rotations
 * about each bone's joint), and where the joints (bones, then points) end up.
 */
export function restPose(names: string[], parents: number[], points: string[], joints: Float32Array): Rest {
  const n = names.length;
  const at = new Map(names.map((x, i) => [x, i]));
  const J = (i: number, out: THREE.Vector3) => out.set(joints[i * 3], joints[i * 3 + 1], joints[i * 3 + 2]);
  const Jn = (name: string, out: THREE.Vector3) => J(at.get(name)!, out);
  const Pn = (name: string, out: THREE.Vector3) => J(n + points.indexOf(name), out);
  const R: THREE.Quaternion[] = [];
  const Jr = new Float32Array(joints.length);
  // Each hand's back (dorsal) direction as modelled: across the knuckles × along the hand (flipped for the right).
  const dorsal0: Record<string, THREE.Vector3> = {};
  for (const s of ['L', 'R']) {
    const width = Jn(`f21${s}`, new THREE.Vector3()).sub(Jn(`f51${s}`, vc));
    const along = Jn(`f31${s}`, new THREE.Vector3()).sub(Jn(`hand${s}`, vc));
    dorsal0[s] = width.cross(along).normalize().multiplyScalar(s === 'L' ? 1 : -1);
  }
  for (let b = 0; b < n; b++) {
    const p = parents[b];
    const q = new THREE.Quaternion();
    if (p >= 0) {
      q.copy(R[p]);
      // The joint follows its parent: J' = R_p (J - J_p) + J'_p.
      J(b, va).sub(J(p, vb)).applyQuaternion(R[p]);
      Jr[b * 3] = va.x + Jr[p * 3];
      Jr[b * 3 + 1] = va.y + Jr[p * 3 + 1];
      Jr[b * 3 + 2] = va.z + Jr[p * 3 + 2];
    } else {
      Jr[b * 3] = joints[b * 3];
      Jr[b * 3 + 1] = joints[b * 3 + 1];
      Jr[b * 3 + 2] = joints[b * 3 + 2];
    }
    const name = names[b];
    const s = /[LR]$/.test(name) ? name.slice(-1) : '';
    const base = s ? name.slice(0, -1) : name;
    const side = s === 'L' ? 1 : -1;
    const arm = new THREE.Vector3(side * Math.sin(A_POSE), -Math.cos(A_POSE), 0);
    const leg = new THREE.Vector3(side * Math.sin(LEG_OUT), -Math.cos(LEG_OUT), 0);
    // Turn this bone (and so everything below it) so it points along `want`.
    const aim = (dir: THREE.Vector3, want: THREE.Vector3) => {
      dir.normalize().applyQuaternion(q);
      qa.setFromUnitVectors(dir, want);
      q.premultiply(qa);
    };
    if (base === 'upperarm') aim(Jn(`forearm${s}`, va).sub(Jn(name, vb)), arm);
    else if (base === 'forearm') aim(Jn(`hand${s}`, va).sub(Jn(name, vb)), arm);
    else if (base === 'hand') {
      aim(Jn(`f31${s}`, va).sub(Jn(name, vb)), arm);
      // Turn the hand about the arm so its back faces out and up in the frontal plane: the palm meets the thigh when the arm hangs.
      const d = va.copy(dorsal0[s]).applyQuaternion(q);
      d.addScaledVector(arm, -d.dot(arm)).normalize();
      const want = vb.set(side * Math.cos(A_POSE), Math.sin(A_POSE), 0);
      const ang = Math.atan2(vc.copy(d).cross(want).dot(arm), d.dot(want));
      qa.setFromAxisAngle(arm, ang);
      q.premultiply(qa);
    } else if (/^f\d\d$/.test(base)) {
      const f = Number(base[1]);
      const k = Number(base[2]);
      const dir = (k < 3 ? Jn(`f${f}${k + 1}${s}`, va) : Pn(`tip${f}${s}`, va)).sub(Jn(name, vb));
      dir.normalize().applyQuaternion(q);
      // Toward the palm, as the hand now lies.
      const volar = vb.copy(dorsal0[s]).applyQuaternion(R[at.get(`hand${s}`)!]).negate();
      const axis = vc.copy(dir).cross(volar);
      if (axis.lengthSq() > 1e-10) {
        qa.setFromAxisAngle(axis.normalize(), CURL[f][k - 1] * D);
        q.premultiply(qa);
      }
    } else if (base === 'thigh') aim(Jn(`shin${s}`, va).sub(Jn(name, vb)), leg);
    else if (base === 'shin') aim(Jn(`foot${s}`, va).sub(Jn(name, vb)), leg);
    else if (base === 'foot' || base === 'toe') q.identity(); // the feet stay flat on the ground as modelled
    R.push(q);
  }
  // The points ride on their bones: fingertips on the last finger joints, the head top on the head, toe tips on the toes.
  for (let k = 0; k < points.length; k++) {
    const pt = points[k];
    const m = /^tip(\d)([LR])$/.exec(pt);
    const t = /^toeTip([LR])$/.exec(pt);
    const b = pt === 'headTop' ? at.get('head')! : m ? at.get(`f${m[1]}3${m[2]}`)! : t ? at.get(`toe${t[1]}`)! : 0;
    J(n + k, va).sub(J(b, vb)).applyQuaternion(R[b]);
    const i = (n + k) * 3;
    Jr[i] = va.x + Jr[b * 3];
    Jr[i + 1] = va.y + Jr[b * 3 + 1];
    Jr[i + 2] = va.z + Jr[b * 3 + 2];
  }
  // Matrices: v' = R (v - J) + J'.
  const M = new Float32Array(n * 12);
  const m4 = new THREE.Matrix4();
  for (let b = 0; b < n; b++) {
    m4.makeRotationFromQuaternion(R[b]);
    const e = m4.elements;
    const jx = joints[b * 3];
    const jy = joints[b * 3 + 1];
    const jz = joints[b * 3 + 2];
    const o = b * 12;
    // (three.js matrices are column-major: row r, column c at e[c * 4 + r].)
    for (let r = 0; r < 3; r++) {
      M[o + r * 4] = e[r];
      M[o + r * 4 + 1] = e[4 + r];
      M[o + r * 4 + 2] = e[8 + r];
      M[o + r * 4 + 3] = Jr[b * 3 + r] - (e[r] * jx + e[4 + r] * jy + e[8 + r] * jz);
    }
  }
  return { matrices: M, joints: Jr };
}

/** Blend-skin vertices by the rest matrices: dst = Σ w M_b src (src and dst may be the same array). */
export function deform(src: Float32Array, dst: Float32Array, count: number, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, M: Float32Array): void {
  for (let v = 0; v < count; v++) {
    const x = src[v * 3];
    const y = src[v * 3 + 1];
    const z = src[v * 3 + 2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k];
      if (w <= 0) continue;
      const o = skinIndex[v * 4 + k] * 12;
      ox += w * (M[o] * x + M[o + 1] * y + M[o + 2] * z + M[o + 3]);
      oy += w * (M[o + 4] * x + M[o + 5] * y + M[o + 6] * z + M[o + 7]);
      oz += w * (M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11]);
    }
    dst[v * 3] = ox;
    dst[v * 3 + 1] = oy;
    dst[v * 3 + 2] = oz;
  }
}
