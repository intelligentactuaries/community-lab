// Data preparation for the stats strip and the analytics drawer.
import { alivePeople } from '../../sim/ctx';
import { ASFR_SHAPE_SA } from '../../sim/fertility';
import { AGE_BANDS, lifeExpectancy, lifeTable } from '../../sim/mortality';
import type { Simulation } from '../../sim/engine';
import { aeTable, experienceE0, overallAe, realisedFertility } from '../../sim/stats';
import type { Person, World } from '../../sim/types';

export function pyramid(world: World, people: Person[] = alivePeople(world)): { bands: string[]; male: number[]; female: number[] } {
  const bands = ['0-4', '5-9', '10-14', '15-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80+'];
  const male = new Array(bands.length).fill(0);
  const female = new Array(bands.length).fill(0);
  for (const p of people) {
    const i = Math.min(bands.length - 1, Math.floor(p.age / 5));
    if (p.sex === 'M') male[i]++;
    else female[i]++;
  }
  return { bands, male, female };
}

export function headline(sim: Simulation) {
  const w = sim.world;
  const st = w.stats;
  const people = alivePeople(w);
  const adults = people.filter((p) => p.age >= 15 && p.age < sim.params.retirementAge);
  const employed = adults.filter((p) => p.income > 0 || p.job === 'homemaker').length;
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  const incomes = hhs.map((h) => h.monthlyIncome).sort((a, b) => a - b);
  const median = incomes.length ? incomes[Math.floor(incomes.length / 2)] : 0;
  const year = Math.floor(w.day / 365.25);
  const yearRows = st.yearly;
  const lastYear = yearRows[yearRows.length - 1];
  const ytdBirths = st.births - (lastYear ? yearRows.reduce((s, y) => s + y.births, 0) : 0);
  const ytdDeaths = st.deaths - (lastYear ? yearRows.reduce((s, y) => s + y.deaths, 0) : 0);
  const e0M = lifeExpectancy(sim.ctx.qx.M);
  const e0F = lifeExpectancy(sim.ctx.qx.F);
  const xM = experienceE0(sim.ctx, 'M');
  const xF = experienceE0(sim.ctx, 'F');
  const ae = overallAe(st.exposures);
  const rf = realisedFertility(st);
  const church = st.weeklyChurch[st.weeklyChurch.length - 1];
  return {
    population: people.length,
    households: hhs.length,
    children: people.filter((p) => p.age < 15).length,
    elderly: people.filter((p) => p.age >= 65).length,
    dependency: adults.length ? (people.length - adults.length) / adults.length : 0,
    births: st.births,
    deaths: st.deaths,
    ytdBirths,
    ytdDeaths,
    year,
    e0M,
    e0F,
    xM,
    xF,
    ae,
    expectedDeaths: st.exposures.reduce((s, r) => s + r.expectedM + r.expectedF, 0),
    personYears: st.exposures.reduce((s, r) => s + r.exposureM + r.exposureF, 0),
    tfrBasis: sim.params.tfr,
    tfrRealised: rf.tfr,
    birthsAe: st.expectedBirths > 0 ? st.births / st.expectedBirths : null,
    expectedBirths: st.expectedBirths,
    employed,
    adults: adults.length,
    employment: adults.length ? employed / adults.length : 0,
    medianIncome: median,
    poor: hhs.filter((h) => h.poor).length,
    ill: people.filter((p) => p.health.illnesses.length).length,
    inHospital: people.filter((p) => p.health.hospitalDaysLeft > 0).length,
    church: church && church.population ? church.attendance / church.population : null,
    incidents: st.incidents,
    arrests: st.arrests,
    reserve: w.insurance.reserve,
    ruined: w.insurance.ruined,
    claims: w.insurance.claimCount,
    marriages: st.marriages,
    divorces: st.divorces,
    homeschooled: people.filter((p) => p.schooling === 'homeschool').length,
    atSchool: people.filter((p) => p.schooling === 'school').length,
  };
}

export { aeTable, realisedFertility, AGE_BANDS, ASFR_SHAPE_SA, lifeTable };
