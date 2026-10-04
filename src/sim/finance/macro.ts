// Macroeconomics of the community: a consumer price index built from the
// national baseline, local demand pressure, the farm-gate food price, the pump
// price and the passenger-transport fares; the Reserve Bank's Monetary Policy
// Committee — six members, each with a Taylor rule around the 3% target and a
// leaning of their own, meeting every second month and voting in 25 bp steps;
// the national accounts (production, expenditure and income approaches with
// the statistical discrepancy shown); potential output and the output gap; the
// quarterly AD–AS curves; fiscal balance; and inequality (Lorenz, Gini).

import type { Rng } from '../rng';
import { r2 } from './accounts';
import type { MacroMonth, MacroState, MpcDecision, QuarterCurve } from './state';

/** Stats SA CPI weight of food and non-alcoholic beverages (2025 reweighting ≈ 17.2%). */
export const FOOD_WEIGHT = 0.172;
/** Stats SA 2025 basket: fuel 3.9% and passenger transport services 2.9% of the CPI. */
export const FUEL_WEIGHT = 0.039;
export const FARES_WEIGHT = 0.029;
export const SRAS_SLOPE = 0.5;
/**
 * The committee's leanings: how far each member's preferred rate sits from the
 * rule (a dove at −50 bp to a hawk at +50 bp). The Governor sits in the middle
 * and breaks a tie.
 */
export const MPC_MEMBERS: Array<{ name: string; lean: number }> = [
  { name: 'Deputy Governor (financial stability)', lean: -0.005 },
  { name: 'Deputy Governor (economic research)', lean: -0.0025 },
  { name: 'Governor', lean: 0 },
  { name: 'Deputy Governor (markets)', lean: 0 },
  { name: 'Deputy Governor (regulation)', lean: 0.0025 },
  { name: 'External member', lean: 0.005 },
];
const GOVERNOR = 2;
/** Pass-through of a year's depreciation of the rand into national core inflation. */
const ZAR_PASS_THROUGH = 0.08;

export function initMacro(opts: { repo: number; target: number; saInflation: number; nmwHourly: number; povertyLine: number; adultCost: number; childCost: number; childGrant: number; oldAgeGrant: number }): MacroState {
  return {
    cpi: 100,
    foodCpi: 100,
    inflYoY: opts.saInflation,
    inflMoM: opts.saInflation / 12,
    saInflation: opts.saInflation,
    expectedInflation: opts.saInflation,
    target: opts.target,
    neutralReal: 0.025,
    repo: opts.repo,
    prime: opts.repo + 0.035,
    wageIndex: 1,
    potential: 0,
    nmwHourly: opts.nmwHourly,
    povertyLine: opts.povertyLine,
    adultCost: opts.adultCost,
    childCost: opts.childCost,
    grants: { child: opts.childGrant, oldAge: opts.oldAgeGrant, oldAge75: opts.oldAgeGrant + 20 },
    months: [],
    quarters: [],
    lastIndexYear: 0,
    gdpBase: null,
    fuelCpi: 100,
    fareCpi: 100,
    saCore: opts.saInflation,
    fuelContribution: 0,
    mpc: [],
  };
}

export interface MacroStartInputs {
  calMonth: number;
  month: number;
  isoDate: string;
  /** National pump price of petrol, year on year (the whole country buys at the same regulated price). */
  fuelYoY: number;
  /** The rand against the dollar, year on year (positive = depreciation). */
  zarYoY: number;
  brent: number;
  zar: number;
}

/**
 * Start of month: national core inflation drifts back to target (pushed by the
 * rand), fuel adds its first-round effect to national headline inflation, and
 * the MPC meets in January, March, May, July, September and November.
 * Returns the committee's decision when it met.
 */
export function macroMonthStart(M: MacroState, rng: Rng, inp: MacroStartInputs): MpcDecision | null {
  // National core: AR(1) around the 3% target, nudged by the rand's pass-through.
  // (A sustained depreciation of x a year settles at ZAR_PASS_THROUGH·x above target.)
  M.saCore = M.target + (M.saCore - M.target) * 0.94 + 0.06 * ZAR_PASS_THROUGH * Math.max(-0.3, Math.min(0.5, inp.zarYoY)) + rng.normal(0, 0.0007);
  M.saCore = Math.max(0.005, Math.min(0.12, M.saCore));
  // National headline = core plus fuel's first-round effect (the 3.9% weight on the pump-price change over core).
  M.fuelContribution = FUEL_WEIGHT * (Math.max(-0.6, Math.min(1.5, inp.fuelYoY)) - M.saCore);
  M.saInflation = Math.max(-0.02, Math.min(0.2, M.saCore + M.fuelContribution));
  const last = M.months[M.months.length - 1];
  const gap = last ? last.gap : 0;
  // Expectations, the committee's forecast horizon: a credible target anchors a third of them; the rest is national
  // headline with half of fuel's first-round effect looked through, coloured by the province's own prices.
  M.expectedInflation = 0.3 * M.target + 0.7 * (0.3 * M.inflYoY + 0.7 * (M.saCore + 0.5 * M.fuelContribution));
  if (inp.calMonth % 2 !== 1) return null;
  // Each member: a Taylor rule with their own leaning, smoothed toward the current rate, in 25 bp steps — 50 bp only
  // when the rule is more than two points away.
  const star = M.neutralReal + M.expectedInflation + 1.5 * (M.expectedInflation - M.target) + 0.5 * gap;
  const prefs = MPC_MEMBERS.map((m) => {
    const want = 0.8 * M.repo + 0.2 * (star + m.lean);
    const step = Math.round((want - M.repo) * 400) / 400;
    const cap = Math.abs(star + m.lean - M.repo) > 0.02 ? 0.005 : 0.0025;
    return Math.max(-cap, Math.min(cap, step));
  });
  // The decision is the step most members favour; the Governor breaks a tie.
  const tally = new Map<number, number>();
  for (const s of prefs) tally.set(s, (tally.get(s) ?? 0) + 1);
  let best = prefs[GOVERNOR];
  let bestN = tally.get(best) ?? 0;
  for (const [s, n] of tally) if (n > bestN) [best, bestN] = [s, n];
  const before = M.repo;
  M.repo = Math.max(0.03, Math.min(0.2, r2((M.repo + best) * 10_000) / 10_000));
  M.prime = M.repo + 0.035;
  const change = Math.round((M.repo - before) * 10_000);
  const votes = { hike: prefs.filter((s) => s > 0).length, hold: prefs.filter((s) => s === 0).length, cut: prefs.filter((s) => s < 0).length };
  const verb = change > 0 ? `raise the repo rate by ${change} bp to ${(M.repo * 100).toFixed(2)}%` : change < 0 ? `cut the repo rate by ${-change} bp to ${(M.repo * 100).toFixed(2)}%` : `keep the repo rate at ${(M.repo * 100).toFixed(2)}%`;
  const split = [votes.hike && `${votes.hike} for a hike`, votes.hold && `${votes.hold} to hold`, votes.cut && `${votes.cut} for a cut`].filter(Boolean).join(', ');
  const infl = last ? last.inflYoY : M.inflYoY;
  const reasons: string[] = [];
  reasons.push(`inflation is ${(infl * 100).toFixed(1)}% against the ${(M.target * 100).toFixed(0)}% target (national ${(M.saInflation * 100).toFixed(1)}%)`);
  if (Math.abs(M.fuelContribution) >= 0.001) reasons.push(`fuel ${M.fuelContribution > 0 ? 'adds' : 'takes off'} ${Math.abs(M.fuelContribution * 100).toFixed(1)} pp, half of which the committee looks through`);
  reasons.push(`the output gap is ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}%`);
  reasons.push(`Brent is US$${inp.brent.toFixed(0)} and the rand R${inp.zar.toFixed(2)}/$`);
  const d: MpcDecision = {
    month: inp.month,
    isoDate: inp.isoDate,
    repo: M.repo,
    change,
    votes,
    rule: star,
    preferences: prefs.map((s) => M.repo - best + s),
    statement: `The Monetary Policy Committee decided to ${verb} (${split}). ${reasons.join('; ').replace(/^./, (c) => c.toUpperCase())}.`,
  };
  M.mpc.push(d);
  if (M.mpc.length > 200) M.mpc.shift();
  return d;
}

/** Annual indexation on 1 March (wages, minimum wage, basic-needs costs, poverty line) and grants in April. */
export function indexForYear(M: MacroState, calMonth: number, year: number, realWageGrowth: number): { wages: number; grants: number } | null {
  if (calMonth !== 3 || M.lastIndexYear === year) return null;
  M.lastIndexYear = year;
  const infl = Math.max(0, Math.min(0.15, M.inflYoY));
  const wages = 1 + infl + realWageGrowth;
  M.wageIndex *= wages;
  M.nmwHourly = Math.round(M.nmwHourly * (1 + infl + 0.01) * 100) / 100;
  M.povertyLine = Math.round(M.povertyLine * (1 + infl));
  M.adultCost = Math.round(M.adultCost * (1 + infl));
  M.childCost = Math.round(M.childCost * (1 + infl));
  const grants = 1 + infl;
  M.grants = { child: Math.round((M.grants.child * grants) / 10) * 10, oldAge: Math.round((M.grants.oldAge * grants) / 10) * 10, oldAge75: Math.round((M.grants.oldAge75 * grants) / 10) * 10 };
  return { wages, grants };
}

export interface MacroInputs {
  isoDate: string;
  foodPrice: number; // local produce price index (1 = base)
  /** Share of the CPI food basket that is locally priced produce (the rest follows the national baseline). */
  produceWeight: number;
  /** Pump price of petrol and the province's passenger-transport fares, relative to the start (1 = base). */
  fuelPrice: number;
  farePrice: number;
  /** For the record: pump price (R/l), Brent (US$/bbl) and the rand (R/US$). */
  petrol: number;
  brent: number;
  zar: number;
  consumption: number;
  investment: number;
  government: number;
  exports: number;
  imports: number;
  compensation: number;
  operatingSurplus: number;
  taxesOnProducts: number;
  valueAdded: number;
  employed: number;
  unemployed: number;
  /** Working-age population (potential output grows with it). */
  workingAge: number;
  taxRevenue: number;
  govSpending: number;
  fiscalTransfer: number;
  deposits: number;
  loans: number;
  householdDisposable: number;
  householdSaving: number;
  tithes: number;
  incomes: number[];
  wealth: number[];
}

/** End of month: price level, real output, the gap, the national accounts and inequality. */
export function macroMonthEnd(M: MacroState, rng: Rng, month: number, inp: MacroInputs): MacroMonth {
  const last = M.months[M.months.length - 1];
  const gap0 = last ? last.gap : 0;
  // Core prices: national core plus local demand pressure; food from the farm-gate
  // market; fuel at the regulated pump price; fares as the operators set them.
  const nonFoodMoM = (M.saCore + 0.25 * gap0) / 12 + rng.normal(0, 0.0006);
  const foodCpi = 100 * inp.foodPrice;
  const foodMoM = M.foodCpi > 0 ? foodCpi / M.foodCpi - 1 : 0;
  const fuelCpi = 100 * inp.fuelPrice;
  const fuelMoM = M.fuelCpi > 0 ? fuelCpi / M.fuelCpi - 1 : 0;
  const fareCpi = 100 * inp.farePrice;
  const fareMoM = M.fareCpi > 0 ? fareCpi / M.fareCpi - 1 : 0;
  const wp = FOOD_WEIGHT * inp.produceWeight;
  const mom = (1 - wp - FUEL_WEIGHT - FARES_WEIGHT) * nonFoodMoM + wp * foodMoM + FUEL_WEIGHT * fuelMoM + FARES_WEIGHT * fareMoM;
  M.cpi = r2(M.cpi * (1 + mom));
  M.foodCpi = r2(foodCpi);
  M.fuelCpi = r2(fuelCpi);
  M.fareCpi = r2(fareCpi);
  M.inflMoM = mom;
  const yearAgo = M.months.length >= 12 ? M.months[M.months.length - 12] : null;
  // Until a year of history exists the annual rate blends the national baseline with the months observed.
  const n = M.months.length + 1;
  M.inflYoY = yearAgo ? M.cpi / yearAgo.cpi - 1 : (n / 12) * (M.cpi / 100 - 1) * (12 / n) + (1 - n / 12) * M.saInflation;
  const gdpProduction = r2(inp.valueAdded + inp.taxesOnProducts);
  const gdpExpenditure = r2(inp.consumption + inp.investment + inp.government + inp.exports - inp.imports);
  const gdpIncome = r2(inp.compensation + inp.operatingSurplus + inp.taxesOnProducts);
  const gdpNominal = gdpProduction;
  const gdpReal = r2(gdpNominal / (M.cpi / 100));
  if (M.potential <= 0 || !last) M.potential = gdpReal;
  else {
    // Potential grows with the working-age population and trend productivity, and is pulled slowly toward realised output.
    const lfGrowth = last.workingAge > 0 ? inp.workingAge / last.workingAge - 1 : 0;
    M.potential = 0.9 * M.potential * (1 + 0.001) * (1 + 0.7 * lfGrowth) + 0.1 * gdpReal;
  }
  const gap = Math.max(-0.2, Math.min(0.2, M.potential > 0 ? (gdpReal - M.potential) / M.potential : 0));
  const labourForce = inp.employed + inp.unemployed;
  const row: MacroMonth = {
    month,
    isoDate: inp.isoDate,
    cpi: M.cpi,
    foodCpi: M.foodCpi,
    fuelCpi: M.fuelCpi,
    fareCpi: M.fareCpi,
    petrol: inp.petrol,
    brent: inp.brent,
    zar: inp.zar,
    fuelContribution: M.fuelContribution,
    inflYoY: M.inflYoY,
    inflMoM: mom,
    saInflation: M.saInflation,
    repo: M.repo,
    prime: M.prime,
    wageIndex: M.wageIndex,
    gdpNominal,
    gdpReal,
    gdpProduction,
    gdpExpenditure,
    gdpIncome,
    discrepancy: r2(gdpProduction - gdpExpenditure),
    consumption: r2(inp.consumption),
    investment: r2(inp.investment),
    government: r2(inp.government),
    exports: r2(inp.exports),
    imports: r2(inp.imports),
    compensation: r2(inp.compensation),
    operatingSurplus: r2(inp.operatingSurplus),
    taxesOnProducts: r2(inp.taxesOnProducts),
    potential: r2(M.potential),
    gap,
    employed: inp.employed,
    unemployed: inp.unemployed,
    workingAge: inp.workingAge,
    labourForce,
    unemploymentRate: labourForce > 0 ? inp.unemployed / labourForce : 0,
    participation: 0,
    taxRevenue: r2(inp.taxRevenue),
    govSpending: r2(inp.govSpending),
    fiscalBalance: r2(inp.taxRevenue - inp.govSpending),
    fiscalTransfer: r2(inp.fiscalTransfer),
    deposits: r2(inp.deposits),
    loans: r2(inp.loans),
    creditGrowthYoY: yearAgo && yearAgo.loans > 0 ? inp.loans / yearAgo.loans - 1 : null,
    householdDisposable: r2(inp.householdDisposable),
    savingRate: inp.householdDisposable > 0 ? inp.householdSaving / inp.householdDisposable : 0,
    giniIncome: gini(inp.incomes),
    giniWealth: gini(inp.wealth),
    tithes: r2(inp.tithes),
  };
  M.months.push(row);
  if (M.months.length > 600) M.months.shift();
  // Quarterly AD–AS snapshot
  if (M.months.length >= 3 && month % 3 === 2) {
    const q = M.months.slice(-3);
    const Y = r2(q.reduce((s, m) => s + m.gdpReal, 0));
    const Ystar = r2(q.reduce((s, m) => s + m.potential, 0));
    const P = M.cpi;
    const qgap = Ystar > 0 ? (Y - Ystar) / Ystar : 0;
    const prevQ = M.quarters[M.quarters.length - 1];
    const yearQ = M.quarters.length >= 4 ? M.quarters[M.quarters.length - 4] : null;
    const label = quarterLabel(inp.isoDate);
    M.quarters.push({ label, month, Y, P, Ystar, Pe: r2(P / (1 + SRAS_SLOPE * qgap)), kappa: SRAS_SLOPE, unemploymentRate: q.reduce((s, m) => s + m.unemploymentRate, 0) / 3, inflation: yearQ ? P / yearQ.P - 1 : M.inflYoY, growth: prevQ && prevQ.Y > 0 ? Y / prevQ.Y - 1 : null });
    if (M.quarters.length > 200) M.quarters.shift();
  }
  return row;
}

export function quarterLabel(isoDate: string): string {
  const y = isoDate.slice(0, 4);
  const m = Number(isoDate.slice(5, 7));
  return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
}

/** Gini coefficient of non-negative values (0 = equal). */
export function gini(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).map((x) => Math.max(0, x)).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (i + 1) * v[i];
  return r2(((2 * acc) / (n * sum) - (n + 1) / n) * 1) ;
}

/** Lorenz curve points (cumulative population share, cumulative income share). */
export function lorenz(values: number[]): Array<[number, number]> {
  const v = values.map((x) => Math.max(0, x)).sort((a, b) => a - b);
  const total = v.reduce((s, x) => s + x, 0);
  const pts: Array<[number, number]> = [[0, 0]];
  let acc = 0;
  v.forEach((x, i) => {
    acc += x;
    pts.push([(i + 1) / v.length, total > 0 ? acc / total : (i + 1) / v.length]);
  });
  return pts;
}

/**
 * Textbook AD–AS curves through a quarter's equilibrium: AD with unit price
 * elasticity through (Y, P); SRAS rising from the expected price level with
 * slope κ around potential; LRAS vertical at potential.
 */
export function adasCurves(q: QuarterCurve, n = 40, span = 0.3): { ad: Array<[number, number]>; sras: Array<[number, number]>; lras: Array<[number, number]> } {
  const lo = q.Ystar * (1 - span);
  const hi = q.Ystar * (1 + span);
  const ad: Array<[number, number]> = [];
  const sras: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const Y = lo + ((hi - lo) * i) / n;
    ad.push([r2(Y), r2(q.P * (2 - Y / q.Y))]);
    sras.push([r2(Y), r2(q.Pe * (1 + q.kappa * ((Y - q.Ystar) / q.Ystar)))]);
  }
  const pMin = Math.min(...ad.map((p) => p[1]), ...sras.map((p) => p[1]));
  const pMax = Math.max(...ad.map((p) => p[1]), ...sras.map((p) => p[1]));
  return { ad, sras, lras: [[r2(q.Ystar), r2(pMin)], [r2(q.Ystar), r2(pMax)]] };
}

/** Ordinary least squares slope/intercept for the Phillips and Okun fits. */
export function ols(xs: number[], ys: number[]): { a: number; b: number; r2: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
    syy += ys[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (a + b * xs[i]), 2), 0);
  return { a, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}
