// The burial and life society, priced and diagnosed the actuarial way: the
// lives it covers and what each costs on the basis (the pure risk premium
// against the flat premium the society charges), the loss and combined
// ratios its books show, and the classical risk theory of its surplus —
// the compound-Poisson claims process, the safety loading, the adjustment
// coefficient and Lundberg's bound, a simulated surplus fan with finite-
// horizon ruin probabilities, and the one-year 99.5% capital requirement the
// Solvency Assessment and Management regime asks of an insurer.
//
//   claims a month  N ~ Poisson(λ),  λ = Σ q⁽¹²⁾ᵢ over the insured lives
//   claim size      X = the cover of the life that died: P(X = xᵢ) = q⁽¹²⁾ᵢ / λ
//   surplus         U(t) = u + c·t − S(t),  S(t) = Σ Xₖ, premiums c a month net of admin
//   safety loading  θ = c / (λ·E[X]) − 1
//   adjustment coefficient R:  λ(Mₓ(R) − 1) = c·R
//   Lundberg        ψ(u) ≤ e^(−R·u);   Cramér–Lundberg  ψ(u) ≈ C·e^(−R·u)
//   SCR             the 99.5th percentile of the worst one-year fall in surplus

import { Rng } from '../rng';
import { improvedQx, qxFor, type QxTable } from '../mortality';
import type { Household, Sex, World } from '../types';
import { monthlyQ } from './life';

export interface SchemeBasis {
  funeralBenefit: number;
  lifeCoverSum: number;
  funeralPremium: number;
  lifeCoverPremium: number;
  /** The CPI factor the society indexes premiums and benefits by. */
  cpiF: number;
  /** Administration, as a share of premiums (the society's books: 2%). */
  adminShare: number;
  /** Life cover runs for adults of these ages. */
  lifeAges: [number, number];
}

export interface InsuredLife {
  id: string;
  name: string;
  householdId: string;
  household: string;
  age: number;
  sex: Sex;
  funeral: boolean;
  life: boolean;
  /** The claim on this life's death, at today's indexed benefits. */
  benefit: number;
  /** Annual and monthly rates of mortality on the basis. */
  q: number;
  qMonthly: number;
  /** The pure risk premium a month: q⁽¹²⁾ × benefit. */
  netMonthly: number;
}

/** The lives the society covers today, with what each costs on the basis. */
export function insuredLives(world: World, qx: QxTable, basis: SchemeBasis, improvement: number, yearsElapsed: number): InsuredLife[] {
  const out: InsuredLife[] = [];
  for (const hh of Object.values(world.households)) {
    if (hh.dissolvedDay || (!hh.insurance.funeral && !hh.insurance.life)) continue;
    for (const id of hh.memberIds) {
      const p = world.people[id];
      if (!p || !p.alive || p.emigrated) continue;
      const lifeCovered = hh.insurance.life && p.age >= basis.lifeAges[0] && p.age < basis.lifeAges[1];
      const benefit = (hh.insurance.funeral ? Math.round(basis.funeralBenefit * basis.cpiF) : 0) + (lifeCovered ? Math.round(basis.lifeCoverSum * basis.cpiF) : 0);
      if (benefit <= 0) continue;
      const q = improvedQx(qxFor(qx, p.sex, p.age), improvement, yearsElapsed);
      const qm = monthlyQ(q);
      out.push({ id, name: `${p.firstName} ${p.surname}`, householdId: hh.id, household: hh.name, age: p.age, sex: p.sex, funeral: hh.insurance.funeral, life: lifeCovered, benefit, q, qMonthly: qm, netMonthly: qm * benefit });
    }
  }
  return out;
}

export interface HouseholdPricing {
  id: string;
  name: string;
  members: number;
  /** What the society charges this household a month, and the pure risk premium for its lives. */
  charged: number;
  net: number;
  /** charged / net: above 1 the household subsidises the pool, below 1 it is subsidised. */
  ratio: number | null;
  oldest: number;
}

export interface SchemePricing {
  lives: number;
  households: number;
  funeralHouseholds: number;
  lifeHouseholds: number;
  adultsCovered: number;
  /** Premiums charged a month (before admin), and the pure risk premium (expected claims) a month. */
  chargedMonthly: number;
  netMonthly: number;
  /** The implicit loading on the pure premium: charged / net − 1 (expense and safety together). */
  loading: number | null;
  /** Expected claims a month, λ, and the mean claim E[X]. */
  lambda: number;
  meanClaim: number;
  /** The claim-size distribution: each cover amount with its probability. */
  claimMix: Array<{ amount: number; weight: number; lives: number }>;
  funeral: { charged: number; net: number; households: number };
  life: { charged: number; net: number; adults: number };
  byHousehold: HouseholdPricing[];
  /** The pure monthly premium for the life cover's sum assured by age, men and women (the natural premium curve). */
  naturalByAge: Array<{ age: number; M: number; F: number }>;
}

export function schemePricing(world: World, lives: InsuredLife[], qx: QxTable, basis: SchemeBasis, improvement: number, yearsElapsed: number): SchemePricing {
  const fPrem = Math.round(basis.funeralPremium * basis.cpiF);
  const lPrem = Math.round(basis.lifeCoverPremium * basis.cpiF);
  const byHh = new Map<string, HouseholdPricing & { hh: Household }>();
  let funeralHouseholds = 0;
  let lifeHouseholds = 0;
  let adultsCovered = 0;
  let funeralNet = 0;
  let lifeNet = 0;
  const mix = new Map<number, { weight: number; lives: number }>();
  let lambda = 0;
  for (const l of lives) {
    let row = byHh.get(l.householdId);
    if (!row) {
      const hh = world.households[l.householdId];
      row = { id: l.householdId, name: l.household, members: 0, charged: (hh.insurance.funeral ? fPrem : 0), net: 0, ratio: null, oldest: 0, hh };
      byHh.set(l.householdId, row);
      if (hh.insurance.funeral) funeralHouseholds++;
      if (hh.insurance.life) lifeHouseholds++;
    }
    row.members++;
    row.net += l.netMonthly;
    row.oldest = Math.max(row.oldest, l.age);
    if (l.life) {
      row.charged += lPrem;
      adultsCovered++;
      lifeNet += l.qMonthly * Math.round(basis.lifeCoverSum * basis.cpiF);
    }
    if (l.funeral) funeralNet += l.qMonthly * Math.round(basis.funeralBenefit * basis.cpiF);
    lambda += l.qMonthly;
    const m = mix.get(l.benefit) ?? { weight: 0, lives: 0 };
    m.weight += l.qMonthly;
    m.lives++;
    mix.set(l.benefit, m);
  }
  const byHousehold = [...byHh.values()].map(({ hh: _hh, ...r }) => ({ ...r, ratio: r.net > 0 ? r.charged / r.net : null })).sort((a, b) => (a.ratio ?? 99) - (b.ratio ?? 99));
  const chargedMonthly = byHousehold.reduce((s, r) => s + r.charged, 0);
  const netMonthly = lives.reduce((s, l) => s + l.netMonthly, 0);
  const naturalByAge: Array<{ age: number; M: number; F: number }> = [];
  const sum = Math.round(basis.lifeCoverSum * basis.cpiF);
  for (let age = basis.lifeAges[0]; age < basis.lifeAges[1]; age++) {
    naturalByAge.push({ age, M: monthlyQ(improvedQx(qxFor(qx, 'M', age), improvement, yearsElapsed)) * sum, F: monthlyQ(improvedQx(qxFor(qx, 'F', age), improvement, yearsElapsed)) * sum });
  }
  return {
    lives: lives.length,
    households: byHousehold.length,
    funeralHouseholds,
    lifeHouseholds,
    adultsCovered,
    chargedMonthly,
    netMonthly,
    loading: netMonthly > 0 ? chargedMonthly / netMonthly - 1 : null,
    lambda,
    meanClaim: lambda > 0 ? netMonthly / lambda : 0,
    claimMix: [...mix.entries()].map(([amount, m]) => ({ amount, weight: lambda > 0 ? m.weight / lambda : 0, lives: m.lives })).sort((a, b) => a.amount - b.amount),
    funeral: { charged: funeralHouseholds * fPrem, net: funeralNet, households: funeralHouseholds },
    life: { charged: adultsCovered * lPrem, net: lifeNet, adults: adultsCovered },
    byHousehold,
    naturalByAge,
  };
}

export interface RiskTheory {
  /** Premium income a month net of admin, expected claims a month, the safety loading θ. */
  c: number;
  lambda: number;
  EX: number;
  EX2: number;
  expectedClaims: number;
  theta: number | null;
  /** The adjustment coefficient (per rand), and the Cramér–Lundberg constant C; null when the loading is not positive. */
  R: number | null;
  C: number | null;
  /** Lundberg's bound e^(−Ru) and the Cramér–Lundberg approximation C·e^(−Ru) at a reserve u. */
  lundberg: (u: number) => number | null;
  approx: (u: number) => number | null;
}

/** The moment generating function of the claim mix, Mₓ(r) = Σ wᵢ·e^(r·xᵢ), and its derivative. */
function mgf(mix: Array<{ amount: number; weight: number }>, r: number): { M: number; M1: number } {
  let M = 0;
  let M1 = 0;
  for (const m of mix) {
    const e = m.weight * Math.exp(r * m.amount);
    M += e;
    M1 += m.amount * e;
  }
  return { M, M1 };
}

export function riskTheory(pricing: Pick<SchemePricing, 'lambda' | 'claimMix' | 'chargedMonthly' | 'meanClaim'>, adminShare: number): RiskTheory {
  const c = pricing.chargedMonthly * (1 - adminShare);
  const lambda = pricing.lambda;
  const mix = pricing.claimMix;
  const EX = mix.reduce((s, m) => s + m.weight * m.amount, 0);
  const EX2 = mix.reduce((s, m) => s + m.weight * m.amount * m.amount, 0);
  const expectedClaims = lambda * EX;
  const theta = expectedClaims > 0 ? c / expectedClaims - 1 : null;
  let R: number | null = null;
  let C: number | null = null;
  if (theta !== null && theta > 0 && mix.length) {
    // h(r) = λ(Mₓ(r) − 1) − c·r starts at 0 with a negative slope and turns up: bracket the positive root, then bisect.
    const h = (r: number) => lambda * (mgf(mix, r).M - 1) - c * r;
    let hi = 1e-7;
    let guard = 0;
    while (h(hi) < 0 && guard++ < 60) hi *= 2;
    if (h(hi) > 0) {
      let lo = 0;
      for (let k = 0; k < 100; k++) {
        const mid = (lo + hi) / 2;
        if (h(mid) < 0) lo = mid;
        else hi = mid;
      }
      R = (lo + hi) / 2;
      const { M1 } = mgf(mix, R);
      const den = M1 - (1 + theta) * EX;
      C = den > 0 ? Math.min(1, (theta * EX) / den) : null;
    }
  }
  return {
    c,
    lambda,
    EX,
    EX2,
    expectedClaims,
    theta,
    R,
    C,
    lundberg: (u) => (R === null ? null : Math.exp(-R * Math.max(0, u))),
    approx: (u) => (R === null || C === null ? null : Math.min(1, C * Math.exp(-R * Math.max(0, u)))),
  };
}

export interface SurplusSimulation {
  months: number;
  paths: number;
  /** Quantiles of the surplus at the end of each month (index 0 = today). */
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
  /** Ruin probabilities within one, five and ten years (or the horizon, if shorter). */
  ruin1: number;
  ruin5: number;
  ruin10: number;
  /** The one-year capital requirement: the 99.5th percentile of the worst fall in surplus within twelve months. */
  scr: number;
  /** The corridor the minimum capital requirement sits in: 25% to 45% of the SCR. */
  mcr: [number, number];
  /** ψ(u) over one year and ten years for a grid of reserves (the capital-versus-ruin curve). */
  curve: Array<{ u: number; ruin1: number; ruin10: number }>;
}

/**
 * The surplus process simulated month by month: Poisson claim counts at λ,
 * sizes from the mix, premiums c in; ruin when the surplus is below zero at a
 * month end. Everything is in today's money (the society indexes premiums
 * and benefits alike). The same seed gives the same fan.
 */
export function simulateSurplus(u: number, rt: Pick<RiskTheory, 'c' | 'lambda'>, mix: Array<{ amount: number; weight: number }>, months = 120, paths = 1000, seed = 7): SurplusSimulation {
  const rng = new Rng(seed, 'scheme-surplus');
  const cum = mix.map((m) => m.amount);
  const w = mix.reduce<number[]>((acc, m) => {
    acc.push((acc.length ? acc[acc.length - 1] : 0) + m.weight);
    return acc;
  }, []);
  const draw = (): number => {
    const r = rng.next() * (w.length ? w[w.length - 1] : 1);
    for (let i = 0; i < w.length; i++) if (r <= w[i]) return cum[i];
    return cum.length ? cum[cum.length - 1] : 0;
  };
  const byMonth: number[][] = Array.from({ length: months + 1 }, () => new Array<number>(paths));
  const worst12: number[] = new Array(paths);
  const ruinAt: number[] = new Array(paths).fill(Infinity);
  // The ruin curve is read off the same paths: ruin at reserve u' happens when the loss process exceeds u'.
  const maxLoss12: number[] = new Array(paths);
  const maxLossAll: number[] = new Array(paths);
  for (let p = 0; p < paths; p++) {
    let loss = 0;
    let worst = 0;
    let worstAll = 0;
    byMonth[0][p] = u;
    for (let m = 1; m <= months; m++) {
      const n = rng.poisson(rt.lambda);
      for (let k = 0; k < n; k++) loss += draw();
      loss -= rt.c;
      if (loss > worstAll) worstAll = loss;
      if (m <= 12 && loss > worst) worst = loss;
      const U = u - loss;
      byMonth[m][p] = U;
      if (U < 0 && ruinAt[p] === Infinity) ruinAt[p] = m;
    }
    worst12[p] = worst;
    maxLoss12[p] = worst;
    maxLossAll[p] = worstAll;
  }
  const q = (arr: number[], k: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    const i = (s.length - 1) * k;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const share = (h: number) => ruinAt.filter((m) => m <= h).length / paths;
  const scr = Math.max(0, q(worst12, 0.995));
  const uMax = Math.max(u * 2, scr * 1.5, 1);
  const curve: Array<{ u: number; ruin1: number; ruin10: number }> = [];
  for (let k = 0; k <= 24; k++) {
    const uu = (uMax * k) / 24;
    curve.push({ u: uu, ruin1: maxLoss12.filter((l) => l > uu).length / paths, ruin10: maxLossAll.filter((l) => l > uu).length / paths });
  }
  return {
    months,
    paths,
    p5: byMonth.map((v) => q(v, 0.05)),
    p25: byMonth.map((v) => q(v, 0.25)),
    p50: byMonth.map((v) => q(v, 0.5)),
    p75: byMonth.map((v) => q(v, 0.75)),
    p95: byMonth.map((v) => q(v, 0.95)),
    ruin1: share(Math.min(12, months)),
    ruin5: share(Math.min(60, months)),
    ruin10: share(Math.min(120, months)),
    scr,
    mcr: [0.25 * scr, 0.45 * scr],
    curve,
  };
}

/**
 * The premium the society would need for Lundberg's bound to hold a target
 * ruin probability at its present reserve: R* = −ln(target)/u, then the c
 * that solves λ(Mₓ(R*) − 1) = c·R*; returned as a multiple of today's premium.
 */
export function premiumForRuinTarget(rt: Pick<RiskTheory, 'c' | 'lambda'>, mix: Array<{ amount: number; weight: number }>, u: number, target: number): { multiplier: number; R: number; c: number } | null {
  if (u <= 0 || target <= 0 || target >= 1 || rt.c <= 0 || rt.lambda <= 0) return null;
  const R = -Math.log(target) / u;
  const c = (rt.lambda * (mgf(mix, R).M - 1)) / R;
  if (!Number.isFinite(c)) return null;
  return { multiplier: Math.max(1, c / rt.c), R, c };
}

/** The society's loss ratio year by year from its surplus path (claims ÷ premiums), with the combined ratio at the admin share. */
export function lossRatios(path: Array<{ month: number; premiums: number; claims: number }>, adminShare: number): Array<{ year: number; premiums: number; claims: number; lossRatio: number | null; combined: number | null }> {
  const byYear = new Map<number, { premiums: number; claims: number }>();
  for (const r of path) {
    const y = Math.floor(r.month / 12);
    const row = byYear.get(y) ?? { premiums: 0, claims: 0 };
    row.premiums += r.premiums;
    row.claims += r.claims;
    byYear.set(y, row);
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, r]) => ({ year, premiums: r.premiums, claims: r.claims, lossRatio: r.premiums > 0 ? r.claims / r.premiums : null, combined: r.premiums > 0 ? r.claims / r.premiums + adminShare : null }));
}
