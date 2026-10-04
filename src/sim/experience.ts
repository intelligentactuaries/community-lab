// The province as data an actuary can take away: exposure and deaths by
// calendar year, age and sex; a person-year panel for modelling who dies; the
// burial society's in-force book as model points; the economy's monthly
// series; and the basis everything was generated on.
//
// Exposure is rebuilt person by person from the days that bound each life in
// the province — arrival (the founding day, a birth here, a move in) and exit
// (death, emigration) — with exactly the engine's own conventions, so the
// totals reconcile with its daily bookkeeping (stats.ts statsDayStep):
//   • a resident counts on day d when arrivedDay ≤ d < exit (the day of a
//     death or a departure is not counted; the day of a birth or an arrival is);
//   • age on day d is ⌊(d − birthDay) / 365.25⌋, as ageDayStep sets it;
//   • expected deaths on day d are the basis's daily hazard, with improvement,
//     exactly as basisDailyHazard computes it (no individual multipliers: A/E
//     is against the basis).
//
// Covariates in the panel describe a person as they are at the end of the
// observation (or were when they died or left) — the engine keeps no history
// of a job or an income — and the exports say so.

import type { TrueBasis } from '@scelo/core/exchange';
import type { Ctx } from './ctx';
import { MAX_AGE, dailyHazard, improvedQx, lifeExpectancy, qxFor } from './mortality';
import { communityOfPerson } from './population';
import { DAYS_PER_YEAR, calendarForDay } from './time';
import type { Household, Person, Sex, World } from './types';
import { CITY, COMMUNITY, cityOf, tierOf } from './world';

/** Anything holding a world and its context (a Simulation). */
export interface SimLike {
  world: World;
  ctx: Ctx;
}

/** The last day the engine has counted (its day step runs at 00:00, so today is in). */
export function lastCountedDay(world: World): number {
  return Math.max(0, world.lastDayStep);
}

/** Day index of 1 January of each calendar year the run touches, to map a day to its year without a Date per day. */
function yearStarts(startMs: number, lastDay: number): { first: number; starts: number[] } {
  const first = calendarForDay(startMs, 0).year;
  const last = calendarForDay(startMs, lastDay).year;
  const starts: number[] = [];
  for (let y = first; y <= last + 1; y++) starts.push(Math.round((Date.UTC(y, 0, 1) - startMs) / 86_400_000));
  return { first, starts };
}

function yearOf(ys: { first: number; starts: number[] }, d: number): number {
  let i = 0;
  while (i + 1 < ys.starts.length && ys.starts[i + 1] <= d) i++;
  return ys.first + i;
}

function exitDay(p: Person, lastDay: number): number {
  return Math.min(p.deathDay ?? p.leftDay ?? lastDay + 1, lastDay + 1);
}

const ageOn = (p: Person, d: number) => Math.floor((d - p.birthDay) / DAYS_PER_YEAR);

/** The engine's basis daily hazard for this person on day d (stats.ts basisDailyHazard, at any day). */
function hazardOn(ctx: Ctx, p: Person, d: number): number {
  const age = ageOn(p, d);
  const q = improvedQx(qxFor(ctx.qx, p.sex, age), ctx.params.mortalityImprovement, d / DAYS_PER_YEAR);
  return dailyHazard(q, age, (d - p.birthDay) % Math.round(DAYS_PER_YEAR));
}

export type Grouping = 'none' | 'city' | 'settlement' | 'tier';

export interface ExperienceCell {
  year: number;
  /** Age last birthday, or the lower edge of the band when banded. */
  age: number;
  ageWidth: number;
  sex: Sex;
  group: string | null;
  personYears: number;
  deaths: number;
  expected: number;
  /** Exposure-weighted basis q over the cell (the answer key, cell by cell). */
  qxBasis: number;
}

function groupOf(world: World, p: Person, g: Grouping): string | null {
  if (g === 'none') return null;
  const com = communityOfPerson(world, p);
  if (g === 'settlement') return COMMUNITY[com]?.name ?? com;
  if (g === 'city') return CITY[cityOf(com)]?.name ?? cityOf(com);
  return tierOf(com);
}

/**
 * Calendar years the run observed for at least `minFraction` of their days. A period model reads each year as a
 * whole year, so a sliver at either end (the four days of January a run ends in) would be a cell of noise.
 */
export function observedYears(sim: SimLike, minFraction = 0.5): Set<number> {
  const lastDay = lastCountedDay(sim.world);
  const ys = yearStarts(sim.ctx.startMs, lastDay);
  const out = new Set<number>();
  for (let i = 0; i + 1 < ys.starts.length; i++) {
    const from = Math.max(0, ys.starts[i]);
    const to = Math.min(lastDay + 1, ys.starts[i + 1]);
    const len = ys.starts[i + 1] - ys.starts[i];
    if (to - from >= minFraction * len) out.add(ys.first + i);
  }
  return out;
}

/**
 * Exposure, deaths and expected deaths by calendar year × age × sex (× a grouping), from day `from` to the last
 * counted day. `ageWidth` 1 gives single ages; 5 gives quinquennial bands (age = lower edge; the last band is
 * open-ended from 100). Years observed for less than half their days are left out (observedYears) unless
 * `partialYears` is set.
 */
export function experienceCells(sim: SimLike, opts: { ageWidth?: number; group?: Grouping; from?: number; partialYears?: boolean } = {}): ExperienceCell[] {
  const { world, ctx } = sim;
  const width = Math.max(1, Math.round(opts.ageWidth ?? 1));
  const group = opts.group ?? 'none';
  const from = Math.max(0, opts.from ?? 0);
  const lastDay = lastCountedDay(world);
  const ys = yearStarts(ctx.startMs, lastDay);
  const keep = opts.partialYears ? null : observedYears(sim);
  const perDay = 1 / DAYS_PER_YEAR;
  const cells = new Map<string, ExperienceCell & { qWeighted: number }>();
  const bandOf = (age: number) => (width === 1 ? Math.min(age, MAX_AGE) : Math.min(Math.floor(age / width) * width, 100));
  const cellFor = (year: number, age: number, sex: Sex, g: string | null) => {
    const a = bandOf(age);
    const key = `${year}|${a}|${sex}|${g ?? ''}`;
    let c = cells.get(key);
    if (!c) {
      c = { year, age: a, ageWidth: width === 1 ? 1 : a >= 100 ? 11 : width, sex, group: g, personYears: 0, deaths: 0, expected: 0, qxBasis: 0, qWeighted: 0 };
      cells.set(key, c);
    }
    return c;
  };
  for (const id in world.people) {
    const p = world.people[id];
    const g = groupOf(world, p, group);
    const start = Math.max(p.arrivedDay, from);
    const end = exitDay(p, lastDay);
    let yi = 0;
    for (let d = start; d < end; d++) {
      while (yi + 1 < ys.starts.length && ys.starts[yi + 1] <= d) yi++;
      const age = ageOn(p, d);
      const c = cellFor(ys.first + yi, age, p.sex, g);
      c.personYears += perDay;
      c.expected += hazardOn(ctx, p, d);
      c.qWeighted += perDay * improvedQx(qxFor(ctx.qx, p.sex, age), ctx.params.mortalityImprovement, d / DAYS_PER_YEAR);
    }
    if (!p.alive && p.deathDay !== null && p.deathDay >= from && p.deathDay <= lastDay) {
      cellFor(yearOf(ys, p.deathDay), ageOn(p, p.deathDay), p.sex, g).deaths += 1;
    }
  }
  return [...cells.values()]
    .filter((c) => !keep || keep.has(c.year))
    .map(({ qWeighted, ...c }) => ({ ...c, qxBasis: c.personYears > 0 ? qWeighted / c.personYears : 0 }))
    .sort((a, b) => a.year - b.year || a.age - b.age || a.sex.localeCompare(b.sex) || (a.group ?? '').localeCompare(b.group ?? ''));
}

/** Sum experience cells from several runs of one basis (a Monte Carlo pool): same keys add up. */
export function poolCells(runs: ExperienceCell[][]): ExperienceCell[] {
  const out = new Map<string, ExperienceCell & { qWeighted: number }>();
  for (const cells of runs) {
    for (const c of cells) {
      const key = `${c.year}|${c.age}|${c.sex}|${c.group ?? ''}`;
      const o = out.get(key) ?? { ...c, personYears: 0, deaths: 0, expected: 0, qxBasis: 0, qWeighted: 0 };
      o.personYears += c.personYears;
      o.deaths += c.deaths;
      o.expected += c.expected;
      o.qWeighted += c.qxBasis * c.personYears;
      out.set(key, o);
    }
  }
  return [...out.values()]
    .map(({ qWeighted, ...c }) => ({ ...c, qxBasis: c.personYears > 0 ? qWeighted / c.personYears : 0 }))
    .sort((a, b) => a.year - b.year || a.age - b.age || a.sex.localeCompare(b.sex) || (a.group ?? '').localeCompare(b.group ?? ''));
}

// ─── the person-year panel ───────────────────────────────────────────────

export interface PersonYearRow {
  personId: string;
  year: number;
  /** Age last birthday at the start of the person's exposure that year. */
  age: number;
  sex: Sex;
  personYears: number;
  /** 1 if the person died in this year. */
  deathEvent: number;
  cause: string | null;
  city: string;
  settlement: string;
  tier: string;
  heritage: string;
  bornHere: boolean;
  education: string;
  job: string;
  incomeMonthly: number;
  householdSize: number;
  householdPoor: boolean;
  funeralCover: boolean;
  medicalAid: boolean;
  chronicConditions: number;
  hiv: string;
  vitality: number;
}

function householdOf(world: World, p: Person): Household | null {
  return world.households[p.householdId] ?? null;
}

/** One row per person per calendar year they were exposed: the panel a Poisson GLM or a classifier is fitted to. */
export function personYearRows(sim: SimLike, opts: { from?: number } = {}): PersonYearRow[] {
  const { world, ctx } = sim;
  const lastDay = lastCountedDay(world);
  const ys = yearStarts(ctx.startMs, lastDay);
  const from = Math.max(0, opts.from ?? 0);
  const rows: PersonYearRow[] = [];
  for (const id in world.people) {
    const p = world.people[id];
    const start = Math.max(p.arrivedDay, from);
    const end = exitDay(p, lastDay);
    if (end <= start) continue;
    const hh = householdOf(world, p);
    const com = communityOfPerson(world, p);
    const conds = p.health.conditions;
    const fixed = {
      personId: p.id,
      sex: p.sex,
      city: CITY[cityOf(com)]?.name ?? cityOf(com),
      settlement: COMMUNITY[com]?.name ?? com,
      tier: tierOf(com),
      heritage: p.heritage ?? 'unknown',
      bornHere: p.bornHere,
      education: p.education,
      job: p.job,
      incomeMonthly: Math.round(p.income),
      householdSize: hh ? hh.memberIds.length : 0,
      householdPoor: !!hh?.poor,
      funeralCover: !!hh?.insurance.funeral,
      medicalAid: !!hh?.insurance.medical,
      chronicConditions: conds.filter((c) => !c.startsWith('hiv')).length,
      hiv: conds.includes('hiv-untreated') ? 'untreated' : conds.includes('hiv-on-art') ? 'on ART' : 'negative',
      vitality: Math.round(p.health.vitality * 100) / 100,
    };
    let segStart = start;
    while (segStart < end) {
      const y = yearOf(ys, segStart);
      const nextYear = ys.starts[y - ys.first + 1] ?? Number.POSITIVE_INFINITY;
      const segEnd = Math.min(end, nextYear);
      const died = !p.alive && p.deathDay !== null && p.deathDay >= segStart && p.deathDay <= segEnd && p.deathDay <= lastDay && segEnd === end;
      rows.push({ ...fixed, year: y, age: ageOn(p, segStart), personYears: (segEnd - segStart) / DAYS_PER_YEAR, deathEvent: died ? 1 : 0, cause: died ? p.causeOfDeath : null });
      segStart = segEnd;
    }
  }
  return rows.sort((a, b) => a.year - b.year || a.personId.localeCompare(b.personId, 'en', { numeric: true }));
}

// ─── the burial society's book as model points ───────────────────────────

export interface ModelPointRow {
  policyId: string;
  householdId: string;
  personId: string;
  cover: 'funeral' | 'life';
  ageAtEntry: number;
  sex: Sex;
  sumAssured: number;
  /** Years: life cover runs to 65; funeral cover is whole of life, written here as a term to age 100. */
  policyTerm: number;
  durationMonths: number;
  /** The household's monthly premium for this cover, split equally over its covered lives. */
  premiumPp: number;
}

/**
 * The society's in-force book today, one model point per covered life and cover, in lifelib's BasicTerm shape
 * (age_at_entry, sex, sum_assured, policy_term, duration_mth, premium_pp). Cover is held by the household; a life
 * entered when the household took the cover, or when they joined it, whichever was later.
 */
export function modelPointRows(sim: SimLike): ModelPointRow[] {
  const { world, ctx } = sim;
  const P = ctx.params;
  const F = world.finance;
  const cpiF = F && F.macro.months.length ? F.macro.cpi / 100 : 1;
  const today = lastCountedDay(world);
  const out: ModelPointRow[] = [];
  for (const hh of Object.values(world.households)) {
    if (hh.dissolvedDay !== null || (!hh.insurance.funeral && !hh.insurance.life)) continue;
    const members = hh.memberIds.map((id) => world.people[id]).filter((p): p is Person => !!p && p.alive && !p.emigrated);
    const lifeAdults = hh.insurance.life ? members.filter((p) => p.age >= 18 && p.age < 65) : [];
    const funeralPremium = Math.round(P.funeralPremium * cpiF * 100) / 100;
    const lifePremium = Math.round(P.lifeCoverPremium * cpiF * 100) / 100;
    for (const p of members) {
      const since = Math.max(hh.formedDay, p.arrivedDay);
      const durationMonths = Math.max(0, Math.floor((today - since) / (DAYS_PER_YEAR / 12)));
      const ageAtEntry = Math.max(0, ageOn(p, since));
      if (hh.insurance.funeral) {
        out.push({ policyId: `${hh.id}-${p.id}-F`, householdId: hh.id, personId: p.id, cover: 'funeral', ageAtEntry, sex: p.sex, sumAssured: Math.round(P.funeralBenefit * cpiF), policyTerm: Math.max(1, 100 - ageAtEntry), durationMonths, premiumPp: Math.round((funeralPremium / Math.max(1, members.length)) * 100) / 100 });
      }
      if (lifeAdults.includes(p)) {
        out.push({ policyId: `${hh.id}-${p.id}-L`, householdId: hh.id, personId: p.id, cover: 'life', ageAtEntry: Math.max(18, ageAtEntry), sex: p.sex, sumAssured: Math.round(P.lifeCoverSum * cpiF), policyTerm: Math.max(1, 65 - Math.max(18, ageAtEntry)), durationMonths, premiumPp: lifePremium });
      }
    }
  }
  return out;
}

// ─── the economy ────────────────────────────────────────────────────────

/** The economy month by month (finance macro + markets). */
export function macroRows(sim: SimLike): Array<Record<string, number | string | null>> {
  const F = sim.world.finance;
  if (!F) return [];
  const markets = new Map(F.markets.months.map((m) => [m.month, m]));
  return F.macro.months.map((m) => {
    const k = markets.get(m.month);
    return {
      date: m.isoDate,
      month: m.month,
      cpi: m.cpi,
      inflation_yoy: m.inflYoY,
      repo_rate: m.repo,
      prime_rate: m.prime,
      gdp_nominal: Math.round(m.gdpNominal),
      gdp_real: Math.round(m.gdpReal),
      unemployment_rate: m.unemploymentRate,
      employed: m.employed,
      gini_income: m.giniIncome,
      gini_wealth: m.giniWealth,
      tax_revenue: Math.round(m.taxRevenue),
      government_spending: Math.round(m.govSpending),
      fiscal_balance: Math.round(m.fiscalBalance),
      household_disposable: Math.round(m.householdDisposable),
      saving_rate: m.savingRate,
      bank_deposits: Math.round(m.deposits),
      bank_loans: Math.round(m.loans),
      petrol_rand_per_litre: m.petrol,
      brent_usd: k?.brent ?? m.brent,
      zar_per_usd: k?.zar ?? m.zar,
    };
  });
}

// ─── the answer key ─────────────────────────────────────────────────────

/** The basis the province's deaths were generated on, and what moves one person's risk around it. */
export function trueBasis(sim: SimLike): TrueBasis {
  const { ctx } = sim;
  const P = ctx.params;
  const ages = Array.from({ length: MAX_AGE + 1 }, (_, x) => x);
  const supplied = !!P.mortalityOverride;
  return {
    label: ctx.qx.label,
    source: supplied ? `${ctx.qx.source} (supplied to Community Lab; e0 ${lifeExpectancy(ctx.qx.M).toFixed(1)} M / ${lifeExpectancy(ctx.qx.F).toFixed(1)} F)` : `${ctx.qx.source}; Heligman–Pollard preset "${P.mortalityPreset}"`,
    baseYear: calendarForDay(ctx.startMs, 0).year,
    improvement: P.mortalityImprovement,
    qx: { ages, M: [...ctx.qx.M], F: [...ctx.qx.F] },
    individualRisk: [
      'Each age band dies on the basis in expectation; within a band, risk is shared out by individual multipliers that average to 1.',
      `Poverty: a poor household's members carry ×${P.povertyMortalityMultiplier} before the within-band normalisation.`,
      `Bereavement: up to ×${P.bereavementMultiplier} at the height of grief, fading over months.`,
      'Chronic conditions: untreated HIV ×4.5, on ART ×1.4, cardiovascular disease ×1.4, COPD ×1.3, diabetes ×1.3, disability ×1.2, hypertension ×1.15.',
      'Vitality: ×(1.6 − 0.8·vitality), so the frailest carry about twice the risk of the fittest.',
      'Illness episodes, injuries and maternal deaths supply part of each age\'s deaths; together with the table share they are calibrated to the basis (docs/ASSUMPTIONS.md).',
    ],
  };
}
