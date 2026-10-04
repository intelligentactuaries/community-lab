// World markets the province imports its energy prices from: Brent crude, the
// rand, and the regulated pump prices the Department of Mineral and Petroleum
// Resources (DMPR) sets on the first Wednesday of every month — the basic fuel
// price (the import-parity cost of a litre landed at the coast) plus the fuel
// levies, the slate levy and the regulated margins. Treasury's fuel-levy policy
// lives here too (the annual Budget adjustment in April and temporary relief
// when the price spikes, as in April–June 2026), with NERSA's electricity
// tariff (April each year) and the price of a new small car.
//
// Calibration anchors (January 2026 unless stated; see docs/ASSUMPTIONS.md,
// "Transport economics"): 95 unleaded inland R20.75/l (7 January 2026); general
// fuel levy R4.17/l petrol, R4.00/l diesel; RAF levy R2.18/l; carbon fuel levy
// 11c / 14c; slate levy 62c; Brent ≈ US$62/bbl; R16.60/US$. The Budget of
// February 2026 raised the general fuel levy by inflation from April (R4.29/l
// petrol); Treasury cut it by R3/l from 1 April to 2 June 2026, then by R1.50/l
// in June, when Brent passed US$85. NERSA's corrected MYPD6 path: +8.76% on
// 1 April 2026 and +8.83% on 1 April 2027.

import type { Rng } from '../rng';
import { r2 } from './accounts';

/** Litres in a US barrel. */
export const BARREL_LITRES = 158.987;
/** US inflation the long-run oil anchor and the rand's purchasing-power path drift with. */
export const US_INFLATION = 0.025;

export interface MarketMonth {
  month: number;
  isoDate: string;
  /** Month-average Brent (US$/bbl) and exchange rate (R/US$). */
  brent: number;
  zar: number;
  /** Refining margin of petrol over crude (US$/bbl). */
  crack: number;
  /** Basic fuel prices (R/l) behind this month's pump prices (last month's import parity). */
  bfpPetrol: number;
  bfpDiesel: number;
  bfpJet: number;
  /** 95 unleaded inland retail, diesel 0.05% inland wholesale and at the pump, Jet A1 (R/l). */
  petrol: number;
  diesel: number;
  dieselRetail: number;
  jet: number;
  /** State take per litre (general fuel levy net of relief, RAF, carbon levy) and the relief itself. */
  levyPetrol: number;
  levyDiesel: number;
  reliefPetrol: number;
  reliefDiesel: number;
  /** Slate levy and the regulated margins and logistics (R/l). */
  slate: number;
  marginsPetrol: number;
  /** Commercial electricity tariff (R/kWh). */
  electricity: number;
  /** Price of a new small car incl. VAT (R). */
  carPrice: number;
}

export interface MarketsState {
  brent: number;
  /**
   * Where Brent would be without a stress test's oil shock. Set the first time a shock applies and kept after it
   * lifts, so the stressed run's oil follows exactly the unstressed path with the factor on top; absent in a run
   * that was never stressed.
   */
  brentBase?: number;
  /** Long-run nominal anchor Brent reverts to (drifts with US inflation). */
  anchor: number;
  zar: number;
  /** The rand's purchasing-power-parity path (drifts with the inflation differential). */
  ppp: number;
  crack: number;
  /** This month's import parity, which sets next month's pump prices. */
  bfpPetrol: number;
  bfpDiesel: number;
  bfpJet: number;
  petrol: number;
  diesel: number;
  dieselRetail: number;
  jet: number;
  gflPetrol: number;
  gflDiesel: number;
  raf: number;
  carbonPetrol: number;
  carbonDiesel: number;
  slate: number;
  /** Wholesale and retail margins, storage, distribution and the zone differential for 95 inland. */
  marginsPetrol: number;
  /** Wholesale margin, storage, distribution and zone differential for diesel. */
  logisticsDiesel: number;
  /** The unregulated dealer margin on diesel at the pump. */
  dieselDealer: number;
  /** Into-plane costs on jet fuel. */
  jetLogistics: number;
  /** Ocean freight, insurance and stock financing per litre (scales with the rand). */
  freight: number;
  electricity: number;
  carPrice: number;
  /** Temporary fuel-levy relief in force (R/l off the general fuel levy). */
  relief: { petrol: number; diesel: number; monthsLeft: number; phase: 'full' | 'taper' } | null;
  /** Earliest month Treasury would grant relief again. */
  reliefCooldownUntil: number;
  reliefEpisodes: Array<{ month: number; isoDate: string; petrol: number; diesel: number; months: number; cost: number }>;
  lastBudgetYear: number;
  lastNersaYear: number;
  lastMarginYear: number;
  base: { petrol: number; diesel: number; dieselRetail: number; jet: number; electricity: number; brent: number; zar: number; carPrice: number };
  months: MarketMonth[];
}

export function initMarkets(): MarketsState {
  const S: MarketsState = {
    brent: 62,
    anchor: 68,
    zar: 16.6,
    ppp: 16.6,
    crack: 14,
    bfpPetrol: 0,
    bfpDiesel: 0,
    bfpJet: 0,
    petrol: 0,
    diesel: 0,
    dieselRetail: 0,
    jet: 0,
    gflPetrol: 4.17,
    gflDiesel: 4.0,
    raf: 2.18,
    carbonPetrol: 0.11,
    carbonDiesel: 0.14,
    slate: 0.62,
    marginsPetrol: 5.15,
    logisticsDiesel: 1.85,
    dieselDealer: 1.3,
    jetLogistics: 0.9,
    freight: 0.58,
    electricity: 2.05,
    carPrice: 205_000,
    relief: null,
    reliefCooldownUntil: 0,
    reliefEpisodes: [],
    lastBudgetYear: 0,
    lastNersaYear: 0,
    lastMarginYear: 0,
    base: { petrol: 0, diesel: 0, dieselRetail: 0, jet: 0, electricity: 2.05, brent: 62, zar: 16.6, carPrice: 205_000 },
    months: [],
  };
  computeImportParity(S);
  setPumpPrices(S);
  S.base = { petrol: S.petrol, diesel: S.diesel, dieselRetail: S.dieselRetail, jet: S.jet, electricity: S.electricity, brent: S.brent, zar: S.zar, carPrice: S.carPrice };
  return S;
}

/** Import parity per litre: crude plus the refining margin, converted at the month's rand, plus freight and insurance. */
function computeImportParity(S: MarketsState): void {
  const perLitre = (usdPerBbl: number) => (usdPerBbl * S.zar) / BARREL_LITRES;
  const freight = S.freight * (S.zar / 16.6);
  S.bfpPetrol = r2(perLitre(S.brent + S.crack) + freight);
  // Diesel's crack is wider, and widens further when crude is dear (middle distillates tighten first).
  S.bfpDiesel = r2(perLitre(S.brent + S.crack + 4 + 0.3 * Math.max(0, S.brent - S.anchor)) + freight);
  S.bfpJet = r2(perLitre(S.brent + S.crack + 6 + 0.3 * Math.max(0, S.brent - S.anchor)) + freight);
}

/** The DMPR build-up: basic fuel price + general fuel levy (less any relief) + RAF + carbon + slate + margins. */
function setPumpPrices(S: MarketsState): void {
  const rp = S.relief?.petrol ?? 0;
  const rd = S.relief?.diesel ?? 0;
  S.petrol = r2(S.bfpPetrol + Math.max(0, S.gflPetrol - rp) + S.raf + S.carbonPetrol + S.slate + S.marginsPetrol);
  S.diesel = r2(S.bfpDiesel + Math.max(0, S.gflDiesel - rd) + S.raf + S.carbonDiesel + S.slate + S.logisticsDiesel);
  S.dieselRetail = r2(S.diesel + S.dieselDealer);
  S.jet = r2(S.bfpJet + S.jetLogistics);
}

/** The state's take per litre: the general fuel levy after relief, the RAF levy and the carbon fuel levy. */
export function levyPerLitre(S: MarketsState, fuel: 'petrol' | 'diesel'): number {
  if (fuel === 'petrol') return r2(Math.max(0, S.gflPetrol - (S.relief?.petrol ?? 0)) + S.raf + S.carbonPetrol);
  return r2(Math.max(0, S.gflDiesel - (S.relief?.diesel ?? 0)) + S.raf + S.carbonDiesel);
}

/** Share of a rand spent at the pump that is fuel levies (paid to SARS). */
export function levyShare(S: MarketsState, fuel: 'petrol' | 'diesel' | 'dieselRetail'): number {
  const price = fuel === 'petrol' ? S.petrol : fuel === 'diesel' ? S.diesel : S.dieselRetail;
  return price > 0 ? levyPerLitre(S, fuel === 'petrol' ? 'petrol' : 'diesel') / price : 0;
}

export interface MarketsInputs {
  month: number;
  isoDate: string;
  calMonth: number;
  year: number;
  /** Community inflation (year on year) and its level relative to the start. */
  inflYoY: number;
  cpiFactor: number;
  repo: number;
  /** A stress test's multiplier on Brent this month (shocks.ts); 1 or absent when none is in force. */
  oilFactor?: number;
}

export interface MarketsNews {
  budget: string | null;
  nersa: string | null;
  relief: string | null;
  reliefEnded: string | null;
  priceChange: { petrol: number; diesel: number } | null;
}

/**
 * The first Wednesday of the month. Regulated adjustments come first (the
 * Budget's levy change and NERSA's tariff in April, the margin review in
 * December), then this month's pump prices from last month's import parity,
 * then the month's oil and rand, which set next month's import parity.
 */
export function marketsMonthStart(S: MarketsState, rng: Rng, inp: MarketsInputs): MarketsNews {
  const news: MarketsNews = { budget: null, nersa: null, relief: null, reliefEnded: null, priceChange: null };
  const infl = Math.max(0, Math.min(0.15, inp.inflYoY));
  const yearAgo = S.months.length >= 12 ? S.months[S.months.length - 12] : null;
  // ── The Budget (April): the general fuel levy rises with inflation unless pump prices have already jumped ──
  if (inp.calMonth === 4 && S.lastBudgetYear !== inp.year) {
    S.lastBudgetYear = inp.year;
    const petrolYoY = yearAgo && yearAgo.petrol > 0 ? S.petrol / yearAgo.petrol - 1 : 0;
    if (petrolYoY >= 0.15) news.budget = `The Budget left the general fuel levy unchanged at R${S.gflPetrol.toFixed(2)}/l (petrol up ${(petrolYoY * 100).toFixed(0)}% on a year ago).`;
    else {
      const oldP = S.gflPetrol;
      S.gflPetrol = r2(S.gflPetrol * (1 + infl));
      S.gflDiesel = r2(S.gflDiesel * (1 + infl));
      news.budget = `The Budget raised the general fuel levy by inflation, ${Math.round((S.gflPetrol - oldP) * 100)}c to R${S.gflPetrol.toFixed(2)}/l on petrol; the RAF levy stays at R${S.raf.toFixed(2)}.`;
    }
  }
  // ── NERSA (April): the corrected MYPD6 increases, then a cost-reflective CPI + 1.5% ──
  if (inp.calMonth === 4 && S.lastNersaYear !== inp.year) {
    S.lastNersaYear = inp.year;
    const rise = inp.year === 2026 ? 0.0876 : inp.year === 2027 ? 0.0883 : infl + 0.015;
    S.electricity = r2(S.electricity * (1 + rise) * 1000) / 1000;
    news.nersa = `NERSA's tariff took effect: electricity up ${(rise * 100).toFixed(2)}% to R${S.electricity.toFixed(3)}/kWh.`;
  }
  // ── DMPR margin review (December): margins and logistics follow costs ──
  if (inp.calMonth === 12 && S.lastMarginYear !== inp.year) {
    S.lastMarginYear = inp.year;
    S.marginsPetrol = r2(S.marginsPetrol * (1 + infl));
    S.logisticsDiesel = r2(S.logisticsDiesel * (1 + infl));
    S.dieselDealer = r2(S.dieselDealer * (1 + infl));
    S.jetLogistics = r2(S.jetLogistics * (1 + infl));
    S.slate = r2(S.slate * (1 + infl));
  }
  // ── Relief: ends, tapers, or is granted when the price has spiked ──
  if (S.relief) {
    S.relief.monthsLeft--;
    if (S.relief.monthsLeft <= 0) {
      if (S.relief.phase === 'full') {
        S.relief = { petrol: r2(S.relief.petrol / 2), diesel: r2(S.relief.diesel / 2), monthsLeft: 1, phase: 'taper' };
        news.relief = `Treasury halved the fuel-levy relief to R${S.relief.petrol.toFixed(2)}/l petrol and R${S.relief.diesel.toFixed(2)}/l diesel for a final month.`;
      } else {
        S.relief = null;
        news.reliefEnded = 'The temporary fuel-levy relief has ended; the full general fuel levy applies again.';
      }
    }
  }
  const prevPetrol = S.petrol;
  const prevDiesel = S.diesel;
  const threeAgo = S.months.length >= 3 ? S.months[S.months.length - 3] : null;
  // The price this month would be without new relief:
  const pre = r2(S.bfpPetrol + Math.max(0, S.gflPetrol - (S.relief?.petrol ?? 0)) + S.raf + S.carbonPetrol + S.slate + S.marginsPetrol);
  const spike = (threeAgo && threeAgo.petrol > 0 && pre / threeAgo.petrol - 1 >= 0.2) || pre - prevPetrol >= 2.5;
  if (!S.relief && spike && inp.month >= S.reliefCooldownUntil && inp.month > 0) {
    const petrol = Math.min(3, S.gflPetrol);
    const diesel = Math.min(3.93, S.gflDiesel);
    S.relief = { petrol, diesel, monthsLeft: 2, phase: 'full' };
    S.reliefCooldownUntil = inp.month + 12;
    S.reliefEpisodes.push({ month: inp.month, isoDate: inp.isoDate, petrol, diesel, months: 3, cost: 0 });
    if (S.reliefEpisodes.length > 40) S.reliefEpisodes.shift();
    news.relief = `Treasury announced temporary fuel-levy relief: R${petrol.toFixed(2)}/l off petrol and R${diesel.toFixed(2)}/l off diesel for two months, then half for a third, as pump prices spiked.`;
  }
  // ── This month's pump prices from last month's import parity ──
  setPumpPrices(S);
  if (inp.month > 0) news.priceChange = { petrol: r2(S.petrol - prevPetrol), diesel: r2(S.diesel - prevDiesel) };
  // ── The month's oil and rand ──
  S.anchor *= Math.pow(1 + US_INFLATION, 1 / 12);
  const prevBrent = S.brent;
  const base = S.brentBase ?? S.brent;
  let dl = 0.05 * (Math.log(S.anchor) - Math.log(base)) + rng.normal(0, 0.075);
  // Rare supply shocks (a war in the Gulf) and demand collapses (a global recession).
  const u = rng.next();
  if (u < 1 / 96) dl += Math.max(0.1, rng.normal(0.32, 0.08));
  else if (u < 1 / 96 + 1 / 160) dl -= Math.max(0.1, rng.normal(0.28, 0.08));
  const nextBase = r2(Math.max(18, Math.min(220, base * Math.exp(dl))));
  // A stress test's oil shock sits on top of the path Brent would take anyway (the same draws either way).
  const oilFactor = inp.oilFactor ?? 1;
  if (oilFactor !== 1 || S.brentBase !== undefined) {
    S.brentBase = nextBase;
    S.brent = r2(Math.max(18, Math.min(440, nextBase * oilFactor)));
  } else S.brent = nextBase;
  const dOil = Math.log(S.brent / prevBrent);
  S.crack = r2(Math.max(6, 14 + 0.6 * (S.crack - 14) + rng.normal(0, 1.5) + 12 * Math.max(0, dOil)));
  // The rand: purchasing-power parity with slow reversion, a carry effect from real rates, an oil-importer's reaction and noise.
  S.ppp *= 1 + (Math.max(-0.02, Math.min(0.2, inp.inflYoY)) - US_INFLATION) / 12;
  const realRepo = inp.repo - inp.inflYoY;
  const dz = 0.03 * (Math.log(S.ppp) - Math.log(S.zar)) - (1.5 * (realRepo - 0.03)) / 12 + 0.12 * dOil + rng.normal(0, 0.028);
  S.zar = r2(Math.max(8, Math.min(60, S.zar * Math.exp(dz))) * 100) / 100;
  computeImportParity(S);
  // Relief costs the fiscus what it forgoes (estimated at the province's own consumption in transport.ts).
  // A new small car: local prices with a third of the value imported at the rand.
  S.carPrice = Math.round((S.base.carPrice * inp.cpiFactor * Math.pow(S.zar / S.base.zar, 0.3)) / 100) * 100;
  return news;
}

/** Record the month's market row (after the month's prices are final). */
export function marketsRecord(S: MarketsState, month: number, isoDate: string): MarketMonth {
  const row: MarketMonth = {
    month,
    isoDate,
    brent: S.brent,
    zar: S.zar,
    crack: S.crack,
    bfpPetrol: r2(S.petrol - Math.max(0, S.gflPetrol - (S.relief?.petrol ?? 0)) - S.raf - S.carbonPetrol - S.slate - S.marginsPetrol),
    bfpDiesel: r2(S.diesel - Math.max(0, S.gflDiesel - (S.relief?.diesel ?? 0)) - S.raf - S.carbonDiesel - S.slate - S.logisticsDiesel),
    bfpJet: r2(S.jet - S.jetLogistics),
    petrol: S.petrol,
    diesel: S.diesel,
    dieselRetail: S.dieselRetail,
    jet: S.jet,
    levyPetrol: levyPerLitre(S, 'petrol'),
    levyDiesel: levyPerLitre(S, 'diesel'),
    reliefPetrol: S.relief?.petrol ?? 0,
    reliefDiesel: S.relief?.diesel ?? 0,
    slate: S.slate,
    marginsPetrol: S.marginsPetrol,
    electricity: S.electricity,
    carPrice: S.carPrice,
  };
  S.months.push(row);
  if (S.months.length > 600) S.months.shift();
  return row;
}
