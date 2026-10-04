// Exposure-to-risk bookkeeping and the actuarial outputs: actual-vs-expected
// (A/E) mortality by age band and sex with Poisson confidence limits,
// realised fertility (ASFR / TFR from woman-years), crude rates, and an
// experience-adjusted life expectancy.

import type { Ctx } from './ctx';
import { alivePeople } from './ctx';
import { ASFR_SHAPE_SA, asfrAt, asfrBandFor } from './fertility';
import { AGE_BANDS, bandFor, dailyHazard, improvedQx, lifeExpectancy, qxFor } from './mortality';
import { DAYS_PER_YEAR } from './time';
import type { AgeBandExposure, Person, SimStats, StatsSnapshot, World } from './types';
import { CITIES, COMMUNITIES, cityOf } from './world';

export function initStats(): SimStats {
  return {
    births: 0,
    deaths: 0,
    marriages: 0,
    divorces: 0,
    emigrations: 0,
    immigrations: 0,
    incidents: 0,
    arrests: 0,
    disputes: 0,
    fights: 0,
    mediations: 0,
    illnesses: 0,
    hospitalisations: 0,
    recoveries: 0,
    funerals: 0,
    weddings: 0,
    courtCases: 0,
    convictions: 0,
    roadAccidents: 0,
    conversations: 0,
    churchServices: 0,
    hymnsSung: 0,
    surgeries: 0,
    taxiRides: 0,
    rideTrips: 0,
    rideFares: 0,
    busRides: 0,
    trainRides: 0,
    flights: 0,
    airTrips: 0,
    ambulanceRuns: 0,
    deathsByCause: {},
    deathsBySource: { table: 0, illness: 0, accident: 0, maternal: 0 },
    tableDeathsByBand: {},
    deathsByBand: {},
    illnessByKind: {},
    illnessByMonth: new Array(12).fill(0),
    birthsByMotherBand: {},
    womanYearsByBand: Object.fromEntries(ASFR_SHAPE_SA.map((b) => [b.band, 0])),
    expectedBirths: 0,
    exposures: AGE_BANDS.map((b) => ({ band: b.band, lo: b.lo, hi: b.hi, exposureM: 0, exposureF: 0, deathsM: 0, deathsF: 0, expectedM: 0, expectedF: 0 })),
    series: [],
    yearly: [],
    incidentsByKind: {},
    weeklyChurch: [],
    weatherLog: [],
    hospitalVisits: 0,
    clinicVisits: 0,
    kmDriven: 0,
  };
}

/** Basis daily hazard for a person (the assumed table with improvement, no individual multipliers). */
export function basisDailyHazard(ctx: Ctx, p: Person): number {
  const yearsElapsed = ctx.world.day / DAYS_PER_YEAR;
  const q = improvedQx(qxFor(ctx.qx, p.sex, p.age), ctx.params.mortalityImprovement, yearsElapsed);
  const daysSinceBirthday = (ctx.world.day - p.birthDay) % Math.round(DAYS_PER_YEAR);
  return dailyHazard(q, p.age, daysSinceBirthday);
}

export function statsDayStep(ctx: Ctx): void {
  const st = ctx.world.stats;
  const perDay = 1 / DAYS_PER_YEAR;
  for (const p of alivePeople(ctx.world)) {
    const band = bandFor(p.age);
    const row = st.exposures.find((e) => e.band === band)!;
    const h = basisDailyHazard(ctx, p);
    if (p.sex === 'M') {
      row.exposureM += perDay;
      row.expectedM += h;
    } else {
      row.exposureF += perDay;
      row.expectedF += h;
      const fb = asfrBandFor(p.age);
      if (fb) {
        st.womanYearsByBand[fb] += perDay;
        st.expectedBirths += asfrAt(ctx.asfr, p.age) * perDay;
      }
    }
  }
}

export type DeathSource = 'table' | 'illness' | 'accident' | 'maternal';

export function recordDeath(ctx: Ctx, p: Person, cause: string, source: DeathSource = 'table'): void {
  const st = ctx.world.stats;
  st.deaths++;
  st.deathsBySource[source]++;
  if (source === 'table') st.tableDeathsByBand[bandFor(p.age)] = (st.tableDeathsByBand[bandFor(p.age)] ?? 0) + 1;
  st.deathsByCause[cause] = (st.deathsByCause[cause] ?? 0) + 1;
  const band = bandFor(p.age);
  st.deathsByBand[band] = (st.deathsByBand[band] ?? 0) + 1;
  const row = st.exposures.find((e) => e.band === band)!;
  if (p.sex === 'M') row.deathsM++;
  else row.deathsF++;
}

export function recordBirth(ctx: Ctx, mother: Person | null): void {
  const st = ctx.world.stats;
  st.births++;
  const band = mother ? asfrBandFor(mother.age) : null;
  if (band) st.birthsByMotherBand[band] = (st.birthsByMotherBand[band] ?? 0) + 1;
}

export interface AeRow {
  band: string;
  sex: 'M' | 'F' | 'all';
  exposure: number;
  actual: number;
  expected: number;
  ratio: number | null;
  lo: number | null;
  hi: number | null;
}

/** Poisson-based 95% interval for A/E: (A ± 1.96√A)/E, floored at 0. */
export function aeTable(exposures: AgeBandExposure[]): AeRow[] {
  const rows: AeRow[] = [];
  const push = (band: string, sex: AeRow['sex'], exposure: number, actual: number, expected: number) => {
    const ratio = expected > 0 ? actual / expected : null;
    const half = 1.96 * Math.sqrt(Math.max(actual, 0.5));
    // Below ~0.1 expected deaths an interval is meaningless (hundreds-wide); report it as not estimable.
    const est = expected >= 0.1;
    rows.push({ band, sex, exposure, actual, expected, ratio: est ? ratio : null, lo: est ? Math.max(0, (actual - half) / expected) : null, hi: est ? (actual + half) / expected : null });
  };
  let tM = { e: 0, a: 0, x: 0 };
  let tF = { e: 0, a: 0, x: 0 };
  for (const r of exposures) {
    push(r.band, 'M', r.exposureM, r.deathsM, r.expectedM);
    push(r.band, 'F', r.exposureF, r.deathsF, r.expectedF);
    push(r.band, 'all', r.exposureM + r.exposureF, r.deathsM + r.deathsF, r.expectedM + r.expectedF);
    tM = { e: tM.e + r.exposureM, a: tM.a + r.deathsM, x: tM.x + r.expectedM };
    tF = { e: tF.e + r.exposureF, a: tF.a + r.deathsF, x: tF.x + r.expectedF };
  }
  push('all', 'M', tM.e, tM.a, tM.x);
  push('all', 'F', tF.e, tF.a, tF.x);
  push('all', 'all', tM.e + tF.e, tM.a + tF.a, tM.x + tF.x);
  return rows;
}

export function overallAe(exposures: AgeBandExposure[]): number | null {
  let a = 0;
  let e = 0;
  for (const r of exposures) {
    a += r.deathsM + r.deathsF;
    e += r.expectedM + r.expectedF;
  }
  return e > 0 ? a / e : null;
}

/** Experience-adjusted e0: the basis table scaled by the sex-specific A/E (credibility-free; small exposures are noisy — shown with the A/E and its interval). */
export function experienceE0(ctx: Ctx, sex: 'M' | 'F'): number | null {
  let a = 0;
  let e = 0;
  for (const r of ctx.world.stats.exposures) {
    a += sex === 'M' ? r.deathsM : r.deathsF;
    e += sex === 'M' ? r.expectedM : r.expectedF;
  }
  if (e < 0.5 || a < 3) return null;
  const ratio = a / e;
  const qx = (sex === 'M' ? ctx.qx.M : ctx.qx.F).map((q, i) => (i === ctx.qx.M.length - 1 ? 1 : Math.min(0.999, q * ratio)));
  return lifeExpectancy(qx);
}

/** Realised ASFR per band and TFR from births / woman-years. */
export function realisedFertility(st: SimStats): { bands: Array<{ band: string; rate: number; womanYears: number; births: number }>; tfr: number } {
  const bands = ASFR_SHAPE_SA.map((b) => {
    const wy = st.womanYearsByBand[b.band] ?? 0;
    const births = st.birthsByMotherBand[b.band] ?? 0;
    return { band: b.band, rate: wy > 0 ? births / wy : 0, womanYears: wy, births };
  });
  const tfr = bands.reduce((s, b) => s + b.rate * 5, 0);
  return { bands, tfr };
}

export function monthlySnapshot(ctx: Ctx): StatsSnapshot {
  const world = ctx.world;
  const st = world.stats;
  const people = alivePeople(world);
  const adults = people.filter((p) => p.age >= 15 && p.age < ctx.params.retirementAge);
  const employed = adults.filter((p) => p.income > 0 || p.job === 'homemaker');
  const unemployed = adults.filter((p) => p.job === 'unemployed');
  const hhs = Object.values(world.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  const blank = () => ({ population: 0, households: 0, meanIncome: 0, poor: 0 });
  const byCommunity: StatsSnapshot['byCommunity'] = Object.fromEntries(COMMUNITIES.map((c) => [c.id, blank()]));
  const byCity: StatsSnapshot['byCity'] = Object.fromEntries(CITIES.map((c) => [c.id, blank()]));
  for (const h of hhs) {
    const com = world.buildings[h.houseId]?.community ?? 'ebenezer';
    const members = h.memberIds.filter((id) => world.people[id]?.alive && !world.people[id]?.emigrated).length;
    for (const c of [byCommunity[com], byCity[cityOf(com)]]) {
      c.households++;
      c.population += members;
      c.meanIncome += h.monthlyIncome;
      if (h.poor) c.poor++;
    }
  }
  for (const c of [...Object.values(byCommunity), ...Object.values(byCity)]) c.meanIncome = c.households ? Math.round(c.meanIncome / c.households) : 0;
  const lastChurch = st.weeklyChurch[st.weeklyChurch.length - 1];
  const macro = world.finance?.macro.months[world.finance.macro.months.length - 1];
  const snap: StatsSnapshot = {
    day: world.day,
    isoDate: ctx.cal.isoDate,
    population: people.length,
    households: hhs.length,
    births: st.births,
    deaths: st.deaths,
    marriages: st.marriages,
    divorces: st.divorces,
    emigrations: st.emigrations,
    immigrations: st.immigrations,
    employedAdults: employed.length,
    workingAge: adults.length,
    unemployedAdults: unemployed.length,
    children: people.filter((p) => p.age < 15).length,
    elderly: people.filter((p) => p.age >= 65).length,
    ill: people.filter((p) => p.health.illnesses.length > 0).length,
    inHospital: people.filter((p) => p.health.hospitalDaysLeft > 0).length,
    meanMood: people.length ? people.reduce((s, p) => s + p.mood, 0) / people.length : 0,
    meanIncome: hhs.length ? hhs.reduce((s, h) => s + h.monthlyIncome, 0) / hhs.length : 0,
    poorHouseholds: hhs.filter((h) => h.poor).length,
    byCommunity,
    byCity,
    churchAttendanceLastSunday: lastChurch ? lastChurch.attendance : 0,
    incidentsCum: st.incidents,
    arrestsCum: st.arrests,
    insuranceReserve: world.insurance.reserve,
    temp: (world.weather.tempMax + world.weather.tempMin) / 2,
    rainMm: world.weather.rainMm,
    season: world.weather.season,
    meanVitality: people.length ? people.reduce((s, p) => s + p.health.vitality, 0) / people.length : 0,
    homeschooled: people.filter((p) => p.schooling === 'homeschool').length,
    atSchool: people.filter((p) => p.schooling === 'school').length,
    inflation: macro?.inflYoY ?? 0,
    repo: macro?.repo ?? 0,
    gdpNominal: macro?.gdpNominal ?? 0,
    gdpReal: macro?.gdpReal ?? 0,
    unemploymentRate: macro?.unemploymentRate ?? 0,
    bankDeposits: macro?.deposits ?? 0,
    bankLoans: macro?.loans ?? 0,
    taxRevenue: macro?.taxRevenue ?? 0,
  };
  st.series.push(snap);
  return snap;
}

/** Record today's weather (replacing the entry if the operator forced it later in the day). */
export function logWeather(world: World): void {
  const w = world.weather;
  const log = world.stats.weatherLog;
  const entry = { day: world.day, tempMin: w.tempMin, tempMax: w.tempMax, rainMm: w.rainMm, condition: w.condition, windKmh: w.windKmh, windDir: w.windDir };
  const last = log[log.length - 1];
  if (last && last.day === world.day) log[log.length - 1] = entry;
  else log.push(entry);
  if (log.length > 400) log.shift();
}

/** Called at each anniversary: summarise the year just completed. */
export function yearlySummary(ctx: Ctx, year: number, opening: { births: number; deaths: number; marriages: number; population: number }): void {
  const st = ctx.world.stats;
  const people = alivePeople(ctx.world);
  const midPop = (opening.population + people.length) / 2 || 1;
  const births = st.births - opening.births;
  const deaths = st.deaths - opening.deaths;
  const rf = realisedFertility(st);
  st.yearly.push({
    year,
    population: people.length,
    births,
    deaths,
    cbr: (births / midPop) * 1000,
    cdr: (deaths / midPop) * 1000,
    tfr: rf.tfr,
    e0M: experienceE0(ctx, 'M'),
    e0F: experienceE0(ctx, 'F'),
    marriages: st.marriages - opening.marriages,
    aeRatio: overallAe(st.exposures),
  });
}
