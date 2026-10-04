// How the outside world reaches the engine: a mortality basis supplied from
// Scelo, and timed shocks (a pandemic year, a rate stress, an oil spike) from
// a stress test or a policy experiment.
//
// Everything here is inert unless the parameters ask for it. With no supplied
// basis and no shocks every factor is exactly 1 and not one random number is
// drawn differently, so the default province is unchanged and an experiment's
// arms stay on the same random numbers as their baseline (common random
// numbers: a difference between arms is the policy's, not the dice's).
//
// A supplied basis. Deaths in the province come from four channels: the table
// hazard applied directly (a calibrated share of it), illness episodes,
// injuries and maternal deaths, calibrated together so the total equals the
// preset table (docs/ASSUMPTIONS.md). Swapping the table alone would move
// only the direct share and leave A/E drifting. So the supplied table becomes
// the basis — the direct channel reads it, and A/E is measured against it —
// and the other channels are scaled by the ratio of forces of mortality,
// μ_supplied(x) / μ_preset(x), age by age and sex by sex. Total mortality then
// follows the supplied table in expectation.

import type { MortalityOverride, Shock } from '../shared/exchange';
import type { Ctx } from './ctx';
import { MAX_AGE, type QxTable } from './mortality';
import type { Person, Sex } from './types';

/** The shocks in force this month, flattened for the per-person checks. */
export interface ActiveShocks {
  mortality: Array<{ factor: number; minAge: number; maxAge: number }>;
  /** Added to the repo rate the MPC sets (basis points). */
  repoBp: number;
  /** Multiplies Brent crude. */
  oilFactor: number;
  /** Labels of what is in force, for the event ledger and the UI. */
  labels: string[];
}

export const NO_SHOCKS: ActiveShocks = Object.freeze({ mortality: [], repoBp: 0, oilFactor: 1, labels: [] }) as unknown as ActiveShocks;

/** Months since the simulation's first month: 0 in the start month. */
export function monthsSinceStart(startYear: number, startMonth: number, year: number, month: number): number {
  return (year - startYear) * 12 + (month - startMonth);
}

export function shockLabel(s: Shock): string {
  if (s.label) return s.label;
  if (s.kind === 'mortality') {
    const ages = s.minAge !== undefined || s.maxAge !== undefined ? ` (ages ${s.minAge ?? 0}–${s.maxAge ?? MAX_AGE})` : '';
    return `mortality ×${s.factor}${ages} for ${s.months} months`;
  }
  if (s.kind === 'repo') return `repo ${s.bp >= 0 ? '+' : ''}${s.bp} bp for ${s.months} months`;
  return `oil ×${s.factor} for ${s.months} months`;
}

export function activeShocks(shocks: Shock[] | undefined, month: number): ActiveShocks {
  if (!shocks?.length) return NO_SHOCKS;
  const out: ActiveShocks = { mortality: [], repoBp: 0, oilFactor: 1, labels: [] };
  for (const s of shocks) {
    if (month < s.fromMonth || month >= s.fromMonth + s.months) continue;
    out.labels.push(shockLabel(s));
    if (s.kind === 'mortality') out.mortality.push({ factor: s.factor, minAge: s.minAge ?? 0, maxAge: s.maxAge ?? MAX_AGE });
    else if (s.kind === 'repo') out.repoBp += s.bp;
    else out.oilFactor *= s.factor;
  }
  return out.labels.length ? out : NO_SHOCKS;
}

/** The mortality shock factor in force today for a person of this age (1 when none). */
export function mortalityShock(ctx: Ctx, age: number): number {
  const ms = ctx.shocks.mortality;
  if (!ms.length) return 1;
  let f = 1;
  for (const m of ms) if (age >= m.minAge && age <= m.maxAge) f *= m.factor;
  return f;
}

/**
 * μ_supplied(x) / μ_preset(x) for this person: how far a supplied basis moves the channels that do not read the
 * table (illness, maternal). 1 when the preset is the basis.
 */
export function basisRatio(ctx: Ctx, p: Person): number {
  const r = ctx.basisRatio;
  if (!r) return 1;
  return (p.sex === 'M' ? r.M : r.F)[Math.min(MAX_AGE, Math.max(0, p.age))];
}

/** Everything that scales an illness or maternal death today: the supplied basis and any mortality shock. */
export function otherChannelScale(ctx: Ctx, p: Person): number {
  return basisRatio(ctx, p) * mortalityShock(ctx, p.age);
}

// ─── building the supplied table ─────────────────────────────────────────

const clampQ = (q: number) => Math.min(0.999, Math.max(1e-6, q));

/** q at every single age 0..MAX_AGE from q at the given ages: log-linear between them, and beyond them the
 *  preset's shape scaled to meet the nearest given age. */
function fillAges(ages: number[], q: number[], calib: number[]): number[] {
  const out: number[] = [];
  const lo = ages[0];
  const hi = ages[ages.length - 1];
  for (let x = 0; x <= MAX_AGE; x++) {
    if (x === MAX_AGE) {
      out.push(1);
      continue;
    }
    let v: number;
    if (x <= lo) v = calib[x] * (q[0] / Math.max(1e-9, calib[Math.min(MAX_AGE - 1, Math.round(lo))]));
    else if (x >= hi) v = calib[x] * (q[q.length - 1] / Math.max(1e-9, calib[Math.min(MAX_AGE - 1, Math.round(hi))]));
    else {
      let i = 1;
      while (ages[i] < x) i++;
      const a0 = ages[i - 1];
      const a1 = ages[i];
      const t = (x - a0) / (a1 - a0);
      const l0 = Math.log(Math.max(1e-9, q[i - 1]));
      const l1 = Math.log(Math.max(1e-9, q[i]));
      v = Math.exp(l0 + t * (l1 - l0));
    }
    out.push(clampQ(v));
  }
  return out;
}

/** The preset's own q at a (fractional) age, interpolated. */
function calibAt(arr: number[], age: number): number {
  const a = Math.min(MAX_AGE - 1, Math.max(0, age));
  const i = Math.floor(a);
  const t = a - i;
  return arr[i] * (1 - t) + arr[Math.min(MAX_AGE - 1, i + 1)] * t;
}

/**
 * The supplied basis as a full table. A pooled table keeps the preset's sex differential around it:
 * q_M(x) = q(x)·2q_M°(x)/(q_M°(x)+q_F°(x)), and likewise for women. A table stated for another calendar year is
 * carried to the province's start with the scenario's own improvement rate.
 */
export function suppliedTable(o: MortalityOverride, calib: QxTable, startYear: number, improvement: number): QxTable {
  const ages = o.ages;
  let qM: number[];
  let qF: number[];
  if ('pooled' in o.qx) {
    const pooled = o.qx.pooled;
    qM = ages.map((a, i) => {
      const m = calibAt(calib.M, a);
      const f = calibAt(calib.F, a);
      return pooled[i] * ((2 * m) / Math.max(1e-12, m + f));
    });
    qF = ages.map((a, i) => {
      const m = calibAt(calib.M, a);
      const f = calibAt(calib.F, a);
      return pooled[i] * ((2 * f) / Math.max(1e-12, m + f));
    });
  } else {
    qM = o.qx.M;
    qF = o.qx.F;
  }
  const shift = o.year !== undefined ? Math.pow(1 - improvement, startYear - o.year) : 1;
  const M = fillAges(ages, qM.map((q) => q * shift), calib.M);
  const F = fillAges(ages, qF.map((q) => q * shift), calib.F);
  return { M, F, presetId: 'supplied', label: o.label, source: o.source };
}

/** μ ratios age by age; 1 where either side is certain death (the last age). */
export function forceRatios(supplied: QxTable, calib: QxTable): { M: Float64Array; F: Float64Array } {
  const ratio = (s: number[], c: number[]) => {
    const out = new Float64Array(MAX_AGE + 1);
    for (let x = 0; x <= MAX_AGE; x++) {
      const qs = s[x];
      const qc = c[x];
      out[x] = qs >= 1 || qc >= 1 ? 1 : Math.log(1 - qs) / Math.log(1 - Math.max(1e-12, qc));
    }
    return out;
  };
  return { M: ratio(supplied.M, calib.M), F: ratio(supplied.F, calib.F) };
}

export function sexArray(t: QxTable, sex: Sex): number[] {
  return sex === 'M' ? t.M : t.F;
}
