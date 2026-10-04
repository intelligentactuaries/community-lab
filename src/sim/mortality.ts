// Mortality basis: the Heligman–Pollard (1980) eight-parameter law
//
//   q_x = A^((x+B)^C) + D·exp(−E·(ln x − ln F)²) + G·H^x / (1 + G·H^x)
//
// (the form used by the Bayesian HP literature and the R package HPbayes),
// whose three terms capture infant/child mortality (A,B,C), the young-adult
// "hump" of accidents, violence and — in South Africa — HIV (D,E,F), and
// senescent Gompertz mortality (G,H).
//
// Presets:
//  * agincourt-2005-07 / agincourt-1994-97: posterior medians from Sharrow,
//    Clark, Collinson, Kahn & Tollman (2013), "The age pattern of increases in
//    mortality affected by HIV: Bayesian fit of the Heligman-Pollard model to
//    data from the Agincourt HDSS field site in rural northeast South Africa",
//    Demographic Research 29:39 (PMC3896243). A REAL rural South African
//    community, before and after ART roll-out.
//  * sa-2024: the Agincourt 2005-07 shape re-calibrated (scripts/calibrate.ts)
//    to Stats SA Mid-year population estimates 2024 (P0302): e0 male 63.6,
//    female 69.2, IMR 22.9 per 1,000, U5MR 28.6 per 1,000.
//  * developed-2020: an illustrative low-mortality basis (e0 ≈ 79 / 84,
//    IMR ≈ 4 per 1,000) for comparison runs.
//
// Everything downstream works from an annual qx vector by single age, so a
// custom table (age, qx_m, qx_f) can be dropped in without touching the law.

import type { Sex } from './types';

export interface HPParams {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
  G: number;
  H: number;
}

export interface MortalityPreset {
  id: string;
  label: string;
  source: string;
  /**
   * How the HP curve was fitted: to single-year q_x ("single"), or — as in
   * the Agincourt paper — to n-year interval probabilities (1q0, 4q1, then
   * 5qx). Grouped fits are converted to single-year q_x with
   * q = 1 − (1 − nqx)^(1/n) before use.
   */
  form: 'single' | 'grouped';
  male: HPParams;
  female: HPParams;
}

export const MAX_AGE = 110;

export const MORTALITY_PRESETS: MortalityPreset[] = [
  {
    id: 'sa-2024',
    label: 'South Africa 2024 (Stats SA calibrated)',
    form: 'single',
    source:
      'HP shape from Agincourt HDSS 2005-07 (Sharrow et al. 2013) re-calibrated to Stats SA P0302 2024: e0 M 63.6 / F 69.2, IMR 22.9‰',
    // Calibrated by scripts/calibrate.ts — see docs/ASSUMPTIONS.md.
    male: { A: 0.0122, B: 0.7754, C: 0.6774, D: 0.005906, E: 3.4, F: 38.0, G: 0.0001256, H: 1.0885 },
    female: { A: 0.01561, B: 0.8563, C: 0.5009, D: 0.005869, E: 2.6, F: 40.0, G: 0.00001868, H: 1.1092 },
  },
  {
    id: 'agincourt-2005-07',
    label: 'Rural SA, early ART era (Agincourt 2005-07)',
    form: 'grouped',
    source: 'Sharrow et al. 2013, Demographic Research 29:39, Table 2 posterior medians',
    male: { A: 0.0262, B: 0.7754, C: 0.2083, D: 0.1199, E: 3.7761, F: 42.261, G: 0.0009, H: 1.0827 },
    female: { A: 0.0356, B: 0.8563, C: 0.2373, D: 0.0867, E: 2.5266, F: 40.6617, G: 0.0001, H: 1.1092 },
  },
  {
    id: 'agincourt-1994-97',
    label: 'Rural SA, pre-HIV peak (Agincourt 1994-97)',
    form: 'grouped',
    source: 'Sharrow et al. 2013, Demographic Research 29:39, Table 2 posterior medians',
    male: { A: 0.0106, B: 0.7829, C: 0.0855, D: 0.0243, E: 5.2779, F: 45.2412, G: 0.001, H: 1.0798 },
    female: { A: 0.0148, B: 0.7852, C: 0.1048, D: 0.0126, E: 14.5269, F: 31.1959, G: 0.0003, H: 1.0958 },
  },
  {
    id: 'developed-2020',
    label: 'Developed country, illustrative (e0 ≈ 79/84)',
    form: 'single',
    source: 'Illustrative HP parameters in the range reported for low-mortality populations; calibrated to e0 79.0 / 84.0, IMR 4‰',
    male: { A: 0.0003348, B: 0.03, C: 0.1108, D: 0.001029, E: 9.0, F: 22.0, G: 0.00001774, H: 1.107 },
    female: { A: 0.0003268, B: 0.03, C: 0.1013, D: 0.000001, E: 9.0, F: 22.0, G: 0.000008405, H: 1.112 },
  },
];

export function presetById(id: string): MortalityPreset {
  return MORTALITY_PRESETS.find((p) => p.id === id) ?? MORTALITY_PRESETS[0];
}

/** Heligman–Pollard q_x at exact integer age x. */
export function hpQx(p: HPParams, x: number): number {
  const xx = Math.max(x, 0);
  const child = Math.pow(p.A, Math.pow(xx + p.B, p.C));
  const lnx = Math.log(Math.max(xx, 0.5));
  const hump = p.D * Math.exp(-p.E * Math.pow(lnx - Math.log(p.F), 2));
  const gh = p.G * Math.pow(p.H, xx);
  const old = gh / (1 + gh);
  return Math.min(0.999, Math.max(1e-6, child + hump + old));
}

export interface QxTable {
  /** qx[age] for age 0..MAX_AGE. */
  M: number[];
  F: number[];
  presetId: string;
  label: string;
  source: string;
}

export function singleYearQx(p: HPParams, x: number, form: MortalityPreset['form']): number {
  const raw = hpQx(p, x);
  if (form === 'single') return raw;
  const n = x === 0 ? 1 : x < 5 ? 4 : 5;
  return Math.min(0.999, Math.max(1e-6, 1 - Math.pow(1 - raw, 1 / n)));
}

export function buildQxTable(preset: MortalityPreset): QxTable {
  const M: number[] = [];
  const F: number[] = [];
  for (let x = 0; x <= MAX_AGE; x++) {
    M.push(x === MAX_AGE ? 1 : singleYearQx(preset.male, x, preset.form));
    F.push(x === MAX_AGE ? 1 : singleYearQx(preset.female, x, preset.form));
  }
  return { M, F, presetId: preset.id, label: preset.label, source: preset.source };
}

/** Build a table from an explicit age→qx map (custom upload). Gaps are linearly interpolated. */
export function tableFromRows(rows: Array<{ age: number; qxM: number; qxF: number }>, label = 'custom'): QxTable {
  const sorted = [...rows].sort((a, b) => a.age - b.age);
  const interp = (age: number, key: 'qxM' | 'qxF'): number => {
    if (!sorted.length) return 0.01;
    if (age <= sorted[0].age) return sorted[0][key];
    if (age >= sorted[sorted.length - 1].age) return sorted[sorted.length - 1][key];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].age >= age) {
        const a = sorted[i - 1];
        const b = sorted[i];
        const t = (age - a.age) / Math.max(1, b.age - a.age);
        return a[key] + t * (b[key] - a[key]);
      }
    }
    return sorted[sorted.length - 1][key];
  };
  const M: number[] = [];
  const F: number[] = [];
  for (let x = 0; x <= MAX_AGE; x++) {
    const m = x === MAX_AGE ? 1 : Math.min(0.999, Math.max(1e-6, interp(x, 'qxM')));
    const f = x === MAX_AGE ? 1 : Math.min(0.999, Math.max(1e-6, interp(x, 'qxF')));
    M.push(m);
    F.push(f);
  }
  return { M, F, presetId: 'custom', label, source: 'user-supplied table' };
}

export interface LifeTableRow {
  age: number;
  qx: number;
  lx: number;
  dx: number;
  Lx: number;
  Tx: number;
  ex: number;
}

/** Period life table with radix 100,000 and the usual a0 = 0.1 (infant deaths early), ax = 0.5 elsewhere. */
export function lifeTable(qx: number[]): LifeTableRow[] {
  const n = qx.length;
  const lx: number[] = new Array(n + 1).fill(0);
  lx[0] = 100_000;
  const rows: LifeTableRow[] = [];
  for (let x = 0; x < n; x++) {
    const dx = lx[x] * qx[x];
    lx[x + 1] = lx[x] - dx;
    const ax = x === 0 ? 0.1 : 0.5;
    const Lx = lx[x + 1] + ax * dx;
    rows.push({ age: x, qx: qx[x], lx: lx[x], dx, Lx, Tx: 0, ex: 0 });
  }
  let T = 0;
  for (let x = n - 1; x >= 0; x--) {
    T += rows[x].Lx;
    rows[x].Tx = T;
    rows[x].ex = rows[x].lx > 0 ? T / rows[x].lx : 0;
  }
  return rows;
}

export function lifeExpectancy(qx: number[], atAge = 0): number {
  const lt = lifeTable(qx);
  return lt[Math.min(atAge, lt.length - 1)]?.ex ?? 0;
}

/** Under-five mortality per 1,000 live births implied by the table. */
export function u5mr(qx: number[]): number {
  let l = 1;
  for (let x = 0; x < 5; x++) l *= 1 - qx[x];
  return (1 - l) * 1000;
}

/**
 * Convert an annual qx to the constant daily hazard that reproduces it:
 * p_day = 1 − (1 − qx)^(1/365.25). For age 0 the infant year is front-loaded
 * (≈55% of infant deaths are neonatal, first 28 days) to keep the pattern of
 * stillbirth-adjacent risk realistic in a day-stepped model.
 */
export function dailyHazard(qx: number, ageYears: number, daysSinceBirthday: number): number {
  if (ageYears === 0) {
    const neonatalShare = 0.55;
    const qNeo = qx * neonatalShare;
    const qRest = 1 - (1 - qx) / (1 - qNeo);
    if (daysSinceBirthday < 28) return 1 - Math.pow(1 - qNeo, 1 / 28);
    return 1 - Math.pow(1 - Math.max(0, qRest), 1 / (365.25 - 28));
  }
  return 1 - Math.pow(1 - qx, 1 / 365.25);
}

/** Apply annual mortality improvement r (e.g. 0.01 = 1%/yr) after t years. */
export function improvedQx(qx: number, improvement: number, yearsElapsed: number): number {
  return Math.min(0.999, Math.max(1e-6, qx * Math.pow(1 - improvement, Math.max(0, yearsElapsed))));
}

export function qxFor(table: QxTable, sex: Sex, age: number): number {
  const arr = sex === 'M' ? table.M : table.F;
  return arr[Math.min(MAX_AGE, Math.max(0, Math.floor(age)))];
}

export const AGE_BANDS: Array<{ band: string; lo: number; hi: number }> = [
  { band: '0', lo: 0, hi: 1 },
  { band: '1-4', lo: 1, hi: 5 },
  { band: '5-14', lo: 5, hi: 15 },
  { band: '15-24', lo: 15, hi: 25 },
  { band: '25-34', lo: 25, hi: 35 },
  { band: '35-44', lo: 35, hi: 45 },
  { band: '45-54', lo: 45, hi: 55 },
  { band: '55-64', lo: 55, hi: 65 },
  { band: '65-74', lo: 65, hi: 75 },
  { band: '75-84', lo: 75, hi: 85 },
  { band: '85+', lo: 85, hi: 200 },
];

export function bandFor(age: number): string {
  for (const b of AGE_BANDS) if (age >= b.lo && age < b.hi) return b.band;
  return '85+';
}
