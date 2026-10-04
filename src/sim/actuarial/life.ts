// Life contingencies on the scenario's own mortality basis: the life table's
// functions, the force of mortality, the commutation functions at a valuation
// rate, and from them the expected present values, net premiums and net
// premium reserves in the International Actuarial Notation.
//
//   ₜpₓ = lₓ₊ₜ / lₓ            survival;  qₓ = 1 − pₓ;  μₓ ≈ −ln pₓ
//   Dₓ = vˣ·lₓ   Nₓ = Σ Dᵧ (y ≥ x)   Cₓ = vˣ⁺¹·dₓ   Mₓ = Σ Cᵧ
//   Aₓ = Mₓ/Dₓ                 whole-life assurance, paid at the end of the year of death
//   A¹ₓ:n̄| = (Mₓ − Mₓ₊ₙ)/Dₓ     term assurance;  ₙEₓ = Dₓ₊ₙ/Dₓ the pure endowment
//   Aₓ:n̄| = A¹ₓ:n̄| + ₙEₓ         endowment assurance
//   äₓ = Nₓ/Dₓ   äₓ:n̄| = (Nₓ − Nₓ₊ₙ)/Dₓ   ₙ|äₓ = Nₓ₊ₙ/Dₓ   annuities-due
//   ä⁽¹²⁾ₓ ≈ äₓ − 11/24        Woolhouse
//   Pₓ = Aₓ/äₓ   P¹ₓ:n̄| = A¹ₓ:n̄|/äₓ:n̄|   net premiums (the equivalence principle)
//   ₜVₓ = Aₓ₊ₜ − Pₓ·äₓ₊ₜ        the prospective net premium reserve
//
// The table is the scenario's annual qₓ by single age (Heligman–Pollard, see
// mortality.ts) with the mortality improvement applied to today.

import { MAX_AGE, lifeTable } from '../mortality';
import { rateSet } from './interest';

/** The commutation functions of a table at rate i, age 0..MAX_AGE (radix 100,000). */
export interface Commutation {
  i: number;
  v: number;
  q: number[];
  l: number[];
  d: number[];
  D: number[];
  N: number[];
  C: number[];
  M: number[];
  /** Rₓ = Σ Mᵧ and Sₓ = Σ Nᵧ, for increasing benefits. */
  R: number[];
  S: number[];
}

export function commutation(qx: number[], i: number): Commutation {
  const lt = lifeTable(qx);
  const n = lt.length;
  const v = 1 / (1 + i);
  const l = lt.map((r) => r.lx);
  const d = lt.map((r) => r.dx);
  const D = new Array<number>(n);
  const C = new Array<number>(n);
  for (let x = 0; x < n; x++) {
    D[x] = Math.pow(v, x) * l[x];
    C[x] = Math.pow(v, x + 1) * d[x];
  }
  const N = new Array<number>(n).fill(0);
  const M = new Array<number>(n).fill(0);
  const R = new Array<number>(n).fill(0);
  const S = new Array<number>(n).fill(0);
  let sN = 0;
  let sM = 0;
  let sR = 0;
  let sS = 0;
  for (let x = n - 1; x >= 0; x--) {
    sN += D[x];
    sM += C[x];
    N[x] = sN;
    M[x] = sM;
    sR += M[x];
    sS += N[x];
    R[x] = sR;
    S[x] = sS;
  }
  return { i, v, q: qx.slice(), l, d, D, N, C, M, R, S };
}

const at = (arr: number[], x: number): number => (x < 0 ? arr[0] : x < arr.length ? arr[x] : 0);

/** The expected present values at age x (and a term n, where it applies) on a commutation table. */
export interface Epv {
  x: number;
  n: number;
  /** Aₓ, A¹ₓ:n̄|, ₙEₓ, Aₓ:n̄|; and A⁽¹²⁾ₓ, Āₓ (payable at the end of the month of death / immediately, UDD). */
  Ax: number;
  A1xn: number;
  nEx: number;
  Axn: number;
  A12x: number;
  Abarx: number;
  /** äₓ, aₓ, äₓ:n̄|, ₙ|äₓ, ä⁽¹²⁾ₓ, ä⁽¹²⁾ₓ:n̄|. */
  axDue: number;
  ax: number;
  axnDue: number;
  nDefAxDue: number;
  ax12Due: number;
  axn12Due: number;
}

export function epv(cm: Commutation, x: number, n: number): Epv {
  const Dx = at(cm.D, x);
  if (Dx <= 0) return { x, n, Ax: 1, A1xn: 1, nEx: 0, Axn: 1, A12x: 1, Abarx: 1, axDue: 1, ax: 0, axnDue: 1, nDefAxDue: 0, ax12Due: 1, axn12Due: 1 };
  const r = rateSet(cm.i);
  const Ax = at(cm.M, x) / Dx;
  const A1xn = (at(cm.M, x) - at(cm.M, x + n)) / Dx;
  const nEx = at(cm.D, x + n) / Dx;
  const axDue = at(cm.N, x) / Dx;
  const axnDue = (at(cm.N, x) - at(cm.N, x + n)) / Dx;
  return {
    x,
    n,
    Ax,
    A1xn,
    nEx,
    Axn: A1xn + nEx,
    A12x: (cm.i / r.i12) * Ax,
    Abarx: (cm.i / r.delta) * Ax,
    axDue,
    ax: axDue - 1,
    axnDue,
    nDefAxDue: at(cm.N, x + n) / Dx,
    ax12Due: Math.max(0, axDue - 11 / 24),
    axn12Due: Math.max(0, axnDue - (11 / 24) * (1 - nEx)),
  };
}

/** Net annual premiums per unit sum assured at age x for a term n: whole life, term and endowment (and their monthly equivalents). */
export interface NetPremiums {
  wholeLife: number;
  term: number;
  endowment: number;
  /** Monthly premiums that are equivalent (payable in advance, from ä⁽¹²⁾). */
  wholeLifeMonthly: number;
  termMonthly: number;
}

export function netPremiums(cm: Commutation, x: number, n: number): NetPremiums {
  const e = epv(cm, x, n);
  const Dx = at(cm.D, x);
  const Nxn = at(cm.N, x) - at(cm.N, x + n);
  const wholeLife = Dx > 0 && at(cm.N, x) > 0 ? at(cm.M, x) / at(cm.N, x) : 1;
  const term = Nxn > 0 ? (at(cm.M, x) - at(cm.M, x + n)) / Nxn : 1;
  const endowment = Nxn > 0 ? (at(cm.M, x) - at(cm.M, x + n) + at(cm.D, x + n)) / Nxn : 1;
  return {
    wholeLife,
    term,
    endowment,
    wholeLifeMonthly: e.ax12Due > 0 ? e.Ax / (12 * e.ax12Due) : 1 / 12,
    termMonthly: e.axn12Due > 0 ? e.A1xn / (12 * e.axn12Due) : 1 / 12,
  };
}

export type PolicyKind = 'wholeLife' | 'term' | 'endowment';

/** The prospective net premium reserve ₜV per unit sum assured, t = 0..n (to the end of the table for whole life). */
export function reservePath(cm: Commutation, x: number, n: number, kind: PolicyKind): Array<{ t: number; age: number; V: number }> {
  const P = netPremiums(cm, x, n);
  const horizon = kind === 'wholeLife' ? Math.max(1, MAX_AGE - x) : n;
  const out: Array<{ t: number; age: number; V: number }> = [];
  for (let t = 0; t <= horizon; t++) {
    const e = epv(cm, x + t, Math.max(0, n - t));
    let V: number;
    if (kind === 'wholeLife') V = e.Ax - P.wholeLife * e.axDue;
    else if (kind === 'term') V = t >= n ? 0 : e.A1xn - P.term * e.axnDue;
    else V = t >= n ? 1 : e.Axn - P.endowment * e.axnDue;
    out.push({ t, age: x + t, V: Math.max(0, Math.min(1, V)) });
  }
  return out;
}

/** The force of mortality implied by the annual rates under a constant force within each year: μₓ = −ln(1 − qₓ). */
export function forceOfMortality(qx: number[]): number[] {
  return qx.map((q) => -Math.log(Math.max(1e-12, 1 - Math.min(0.999999, q))));
}

/** ₜpₓ from the table. */
export function tpx(qx: number[], x: number, t: number): number {
  let p = 1;
  for (let y = x; y < x + t && y < qx.length; y++) p *= 1 - qx[y];
  return x + t > qx.length ? 0 : p;
}

/** The curtate expectation eₓ = Σₖ ₖpₓ and the complete e̊ₓ (the life table's, with a₀ = 0.1 and ½ elsewhere). */
export function expectations(qx: number[]): Array<{ age: number; curtate: number; complete: number }> {
  const lt = lifeTable(qx);
  const out: Array<{ age: number; curtate: number; complete: number }> = [];
  let tail = 0;
  for (let x = lt.length - 1; x >= 0; x--) {
    out[x] = { age: x, curtate: lt[x].lx > 0 ? tail / lt[x].lx : 0, complete: lt[x].ex };
    tail += lt[x].lx;
  }
  return out;
}

/** The monthly rate of mortality that reproduces an annual qₓ: 1 − (1 − qₓ)^(1/12). */
export function monthlyQ(q: number): number {
  return 1 - Math.pow(1 - Math.min(0.999999, Math.max(0, q)), 1 / 12);
}

/**
 * The natural (yearly renewable) premium for a sum assured of 1 at age x,
 * v·qₓ, against the level premium of a term assurance from entry age x₀ to
 * age x₀ + n: the classic diagram whose gap the reserve accumulates.
 */
export function naturalVsLevel(cm: Commutation, x0: number, n: number): { natural: Array<[number, number]>; level: number; reserve: Array<[number, number]> } {
  const natural: Array<[number, number]> = [];
  for (let t = 0; t < n; t++) natural.push([x0 + t, cm.v * at(cm.q, x0 + t)]);
  const level = netPremiums(cm, x0, n).term;
  const reserve = reservePath(cm, x0, n, 'term').map((r) => [r.age, r.V] as [number, number]);
  return { natural, level, reserve };
}
