// Microeconomics: the fresh-produce market where the farm meets household
// demand (with imports at parity capping the price), the labour market with
// its minimum-wage floor, Engel's law across households, and realised
// elasticities. Curves are stored so the analytics can draw the textbook
// diagrams (D, S, S₁, E, E₁) for any two months.

import { r2 } from './accounts';
import type { LabourSnapshot, MicroMonth, MicroState } from './state';

/** Own-price elasticity of demand for food (SA estimates cluster around −0.5 to −0.6). */
export const FOOD_PRICE_ELASTICITY = 0.55;
/** Short-run supply elasticity of a small farm. */
export const FARM_SUPPLY_ELASTICITY = 0.3;
/** Import parity premium over the base farm-gate price (transport and wholesale margins). */
export const IMPORT_PREMIUM = 1.18;

export function initMicro(): MicroState {
  return { months: [], basePrice: 1, localShare: null, labour: null, engel: [], elasticity: { price: null, income: null } };
}

export interface MarketInputs {
  isoDate: string;
  /** What households will spend on local produce at last month's price (ZAR). */
  spend: number;
  /** Farm capacity at base prices (ZAR of produce a normal month yields). */
  capacity: number;
  yield: number;
  /** Non-food price level relative to base (import parity moves with it). */
  priceLevel: number;
}

/** Clear the produce market: Q_d = A·P^−ε against Q_s = S₀·yield·P^σ, capped at import parity. */
export function clearProduceMarket(S: MicroState, month: number, inp: MarketInputs): MicroMonth {
  const last = S.months[S.months.length - 1];
  const pLast = last ? last.price : S.basePrice;
  const eps = FOOD_PRICE_ELASTICITY;
  const sigma = FARM_SUPPLY_ELASTICITY;
  const A = Math.max(1, inp.spend) * Math.pow(pLast, eps - 1);
  const S0 = Math.max(1, inp.capacity);
  const importParity = r2(IMPORT_PREMIUM * inp.priceLevel * 100) / 100;
  const y = Math.max(0.05, inp.yield);
  let price = Math.pow(A / (S0 * y), 1 / (eps + sigma));
  price = Math.max(0.55, price);
  let localSupply: number;
  let imports = 0;
  let quantity: number;
  if (price <= importParity) {
    quantity = A * Math.pow(price, -eps);
    localSupply = quantity;
  } else {
    price = importParity;
    quantity = A * Math.pow(price, -eps);
    localSupply = S0 * y * Math.pow(price, sigma);
    imports = Math.max(0, quantity - localSupply);
  }
  // Surpluses: demand truncated at three times the price (inelastic demand has no finite choke price).
  const consumerSurplus = (A / (1 - eps)) * (Math.pow(3 * price, 1 - eps) - Math.pow(price, 1 - eps)) - 0; // area above P below D, net of price paid already excluded by integral bounds
  const producerSurplus = (S0 * y * Math.pow(price, sigma + 1)) / (sigma + 1);
  const row: MicroMonth = { month, isoDate: inp.isoDate, price: r2(price), quantity: r2(quantity), localSupply: r2(localSupply), imports: r2(imports), yield: r2(y), importParity, A: r2(A), eps, S0: r2(S0), sigma, consumerSurplus: r2(consumerSurplus), producerSurplus: r2(producerSurplus), spend: r2(price * quantity) };
  S.months.push(row);
  if (S.months.length > 600) S.months.shift();
  S.elasticity = realisedElasticities(S.months);
  return row;
}

/** Points of the demand and supply curves of a month for drawing. */
export function marketCurves(m: MicroMonth, n = 40): { demand: Array<[number, number]>; supply: Array<[number, number]>; importLine: Array<[number, number]> } {
  const pLo = Math.max(0.3, m.price * 0.45);
  const pHi = Math.max(m.importParity * 1.2, m.price * 1.8);
  const demand: Array<[number, number]> = [];
  const supply: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const p = pLo + ((pHi - pLo) * i) / n;
    demand.push([r2(m.A * Math.pow(p, -m.eps)), r2(p)]);
    supply.push([r2(m.S0 * m.yield * Math.pow(p, m.sigma)), r2(p)]);
  }
  const qMax = Math.max(demand[0][0], supply[n][0]);
  return { demand, supply, importLine: [[0, m.importParity], [r2(qMax), m.importParity]] };
}

/** Arc elasticities from consecutive months (price) and from the cross-section (income, via Engel). */
export function realisedElasticities(months: MicroMonth[]): { price: number | null; income: number | null } {
  const es: number[] = [];
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1];
    const b = months[i];
    const dp = (b.price - a.price) / ((a.price + b.price) / 2);
    if (Math.abs(dp) < 0.01) continue;
    const dq = (b.quantity - a.quantity) / ((a.quantity + b.quantity) / 2);
    es.push(dq / dp);
  }
  const price = es.length ? r2(es.slice(-24).reduce((s, x) => s + x, 0) / Math.min(24, es.length)) : null;
  return { price, income: null };
}

export interface LabourInputs {
  /** Gross monthly wage of every filled position. */
  wages: number[];
  /** Reservation wage of every labour-force member (employed and unemployed). */
  reservations: number[];
  nmwMonthly: number;
  employed: number;
  unemployed: number;
}

export function labourSnapshot(month: number, inp: LabourInputs): LabourSnapshot {
  const offers = [...inp.wages].sort((a, b) => b - a);
  const reservations = [...inp.reservations].sort((a, b) => a - b);
  // Demand at wage w: positions worth at least w; supply at w: people whose reservation wage is at most w.
  let eq = inp.nmwMonthly;
  const lo = Math.min(...reservations, inp.nmwMonthly);
  const hi = Math.max(...offers, inp.nmwMonthly * 3);
  let best = Infinity;
  for (let i = 0; i <= 80; i++) {
    const w = lo + ((hi - lo) * i) / 80;
    const d = offers.filter((o) => o >= w).length;
    const s = reservations.filter((r) => r <= w).length;
    if (Math.abs(d - s) < best) {
      best = Math.abs(d - s);
      eq = w;
    }
  }
  const sorted = [...inp.wages].sort((a, b) => a - b);
  return { month, offers, reservations, nmwMonthly: inp.nmwMonthly, employed: inp.employed, unemployed: inp.unemployed, equilibriumWage: r2(eq), meanWage: sorted.length ? r2(sorted.reduce((s, x) => s + x, 0) / sorted.length) : 0, medianWage: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0 };
}

/** Reservation wage: the grant floor, education and age (documented assumption). */
export function reservationWage(nmwMonthly: number, eduRank: number, age: number, hasIncomeAlternative: boolean): number {
  const base = Math.max(0.55 * nmwMonthly, 1_400 + 1_900 * eduRank);
  return r2(base * (age > 50 ? 1.1 : 1) * (hasIncomeAlternative ? 1.15 : 1));
}

/** Engel's law: the food share of the budget falls with per-capita income. */
export function foodShare(perCapitaIncome: number): number {
  return Math.max(0.12, Math.min(0.55, 0.12 + 0.4 * Math.exp(-perCapitaIncome / 5_000)));
}

/** Log-linear Engel fit: share = a + b·ln(per-capita income). */
export function engelFit(rows: Array<{ perCapita: number; foodShare: number }>): { a: number; b: number } | null {
  const pts = rows.filter((r) => r.perCapita > 0);
  if (pts.length < 3) return null;
  const xs = pts.map((r) => Math.log(r.perCapita));
  const ys = pts.map((r) => r.foodShare);
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  if (den === 0) return null;
  const b = num / den;
  return { a: my - b * mx, b };
}

/** Cobb–Douglas consumer optimum for the budget-line diagram: food vs everything else. */
export function consumerOptimum(income: number, foodPrice: number, alpha: number): { food: number; other: number; utility: number } {
  const food = (alpha * income) / foodPrice;
  const other = (1 - alpha) * income;
  return { food: r2(food), other: r2(other), utility: Math.pow(food, alpha) * Math.pow(other, 1 - alpha) };
}
