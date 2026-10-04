// A person's body shape from the kit, the way MakeHuman makes one: the base
// mesh plus its macro targets weighted by sex, age, muscle, weight and
// ancestry (MakeHuman's own interpolation, apps/human.py), plus face and body
// details. Age runs through development: a child's proportions and face up to
// eleven, puberty (earlier for girls) to the young adult by 16-18, then the
// slow changes of age.
import type { Kit } from './kit';

export type Sex = 'M' | 'F';

export interface BodyParams {
  sex: Sex;
  /**
   * Where the build lies between MakeHuman's female (0) and male (1) shapes (MetaHuman's masculine–feminine
   * axis): the sex's own end when unset; a little way in for a slighter man or a broader woman.
   */
  gender?: number;
  /** Years. */
  age: number;
  /** 0..1, 0.5 average (MakeHuman's weight). */
  weight: number;
  /** 0..1, 0.5 average. */
  muscle: number;
  /** Shares of MakeHuman's three ancestry sets (summing to 1). */
  ancestry: { african: number; asian: number; caucasian: number };
  /** Face and body details by name (kit.meta.details), -1..1. */
  details: Record<string, number>;
}

/** MakeHuman age (years, 1..90) standing for a person's age: development runs ahead through puberty. */
export function mhYears(sex: Sex, age: number): number {
  if (age <= 1) return 1;
  const [a0, a1] = sex === 'F' ? [10, 16.5] : [11.5, 18.5];
  if (age <= a0) return age;
  if (age < a1) {
    const t = (age - a0) / (a1 - a0);
    return a0 + (25 - a0) * t * t * (3 - 2 * t);
  }
  if (age < 25) return 25;
  return Math.min(90, age);
}

/** MakeHuman's age value (0..1) for years. */
export function mhAgeValue(years: number): number {
  const y = Math.max(1, Math.min(90, years));
  return y < 25 ? (y - 1) / 48 : (y - 25) / 130 + 0.5;
}

/** Weights of the baby, child, young and old sets for an age value. */
export function ageWeights(v: number): [number, number, number, number] {
  if (v < 0.5) {
    const young = Math.max(0, (v - 0.1875) * 3.2);
    return [Math.max(0, 1 - v * 5.333), Math.max(0, Math.min(1, 5.333 * v) - young), young, 0];
  }
  const old = Math.max(0, v * 2 - 1);
  return [0, 0, 1 - old, old];
}

function three(x: number): [number, number, number] {
  const hi = Math.max(0, x * 2 - 1);
  const lo = Math.max(0, 1 - x * 2);
  return [lo, 1 - hi - lo, hi];
}

const AGES = ['baby', 'child', 'young', 'old'];
const MUSCLES = ['minmuscle', 'averagemuscle', 'maxmuscle'];
const WEIGHTS = ['minweight', 'averageweight', 'maxweight'];
const RACES = ['african', 'asian', 'caucasian'] as const;

/** Every target with a weight for this person: [target index, weight]. */
export function targetWeights(kit: Kit, p: BodyParams): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // The female and male sets, blended as MakeHuman blends them for its gender slider.
  const gender = clamp01(p.gender ?? (p.sex === 'M' ? 1 : 0));
  const sets: Array<['female' | 'male', number]> = [['female', 1 - gender], ['male', gender]];
  const ages = ageWeights(mhAgeValue(mhYears(p.sex, p.age)));
  const m = three(clamp01(p.muscle));
  const w = three(clamp01(p.weight));
  const macro = kit.meta.macro;
  let rs = 0;
  for (const r of RACES) rs += Math.max(0, p.ancestry[r]);
  for (const [g, gw] of sets) {
    if (gw <= 0) continue;
    for (let a = 0; a < 4; a++) {
      const av = ages[a] * gw;
      if (av <= 0) continue;
      for (const r of RACES) {
        const rv = Math.max(0, p.ancestry[r]) / (rs || 1);
        const t = macro[`${r}-${g}-${AGES[a]}`];
        if (rv > 0 && t !== undefined) out.push([t, av * rv]);
      }
      for (let mi = 0; mi < 3; mi++) {
        if (m[mi] <= 0) continue;
        for (let wi = 0; wi < 3; wi++) {
          if (w[wi] <= 0) continue;
          const t = macro[`universal-${g}-${AGES[a]}-${MUSCLES[mi]}-${WEIGHTS[wi]}`];
          if (t !== undefined) out.push([t, av * m[mi] * w[wi]]);
        }
      }
    }
  }
  for (const d of kit.meta.details) {
    const v = p.details[d.name] ?? 0;
    if (v > 0) for (const t of d.hi) out.push([t, v]);
    else if (v < 0) for (const t of d.lo) out.push([t, -v]);
  }
  return out;
}

/** The shaped base vertices (MakeHuman's rest pose) and joints (bones then points), for these target weights. */
export function morph(kit: Kit, weights: Array<[number, number]>, pos: Float32Array, joints: Float32Array): void {
  pos.set(kit.base);
  joints.set(kit.joints);
  const nj = kit.joints.length;
  const dense = kit.targetsDense;
  const idx = kit.targetsIndex;
  const val = kit.targetsValue;
  const tj = kit.targetsJoints;
  for (const [ti, w] of weights) {
    const t = kit.meta.targets[ti];
    const k = w * t.scale;
    if (t.kind === 'dense') {
      const o = t.offset;
      for (let i = 0, n = pos.length; i < n; i++) pos[i] += dense[o + i] * k;
    } else {
      const o = t.offset;
      const c = t.count ?? 0;
      for (let e = 0; e < c; e++) {
        const v = idx[o + e] * 3;
        const s = (o + e) * 3;
        pos[v] += val[s] * k;
        pos[v + 1] += val[s + 1] * k;
        pos[v + 2] += val[s + 2] * k;
      }
    }
    const jo = t.joint * nj;
    for (let i = 0; i < nj; i++) joints[i] += tj[jo + i] * w;
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
