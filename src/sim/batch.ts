// Monte Carlo batch runner: N seeds × Y years in macro mode, one summary row
// per replication plus percentile aggregates. Used by scripts/batch.ts (CLI)
// and by the server's /api/batch route.

import { alivePeople } from './ctx';
import { Simulation } from './engine';
import type { ScenarioParams } from './params';
import { experienceE0, overallAe, realisedFertility } from './stats';

export interface BatchRow {
  seed: string;
  years: number;
  population0: number;
  population: number;
  births: number;
  deaths: number;
  expectedDeaths: number;
  ae: number | null;
  expectedBirths: number;
  fertilityAe: number | null;
  tfr: number;
  e0M: number | null;
  e0F: number | null;
  marriages: number;
  divorces: number;
  emigrations: number;
  immigrations: number;
  incidents: number;
  arrests: number;
  illnesses: number;
  hospitalisations: number;
  reserve: number;
  claims: number;
  premiums: number;
  ruined: boolean;
  ruinMonth: number | null;
  poorShareEnd: number;
  personYears: number;
  ms: number;
}

export interface BatchSummary {
  rows: BatchRow[];
  years: number;
  seeds: number;
  basisHash: string;
  percentiles: Record<string, { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }>;
  ruinProbability: number;
  pooledAe: number | null;
  pooledFertilityAe: number | null;
}

export function summariseRun(sim: Simulation, seed: string, years: number, ms: number, population0: number): BatchRow {
  const w = sim.world;
  const st = w.stats;
  const expectedDeaths = st.exposures.reduce((s, r) => s + r.expectedM + r.expectedF, 0);
  const py = st.exposures.reduce((s, r) => s + r.exposureM + r.exposureF, 0);
  const rf = realisedFertility(st);
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  return {
    seed,
    years,
    population0,
    population: alivePeople(w).length,
    births: st.births,
    deaths: st.deaths,
    expectedDeaths,
    ae: overallAe(st.exposures),
    expectedBirths: st.expectedBirths,
    fertilityAe: st.expectedBirths > 0 ? st.births / st.expectedBirths : null,
    tfr: rf.tfr,
    e0M: experienceE0(sim.ctx, 'M'),
    e0F: experienceE0(sim.ctx, 'F'),
    marriages: st.marriages,
    divorces: st.divorces,
    emigrations: st.emigrations,
    immigrations: st.immigrations,
    incidents: st.incidents,
    arrests: st.arrests,
    illnesses: st.illnesses,
    hospitalisations: st.hospitalisations,
    reserve: Math.round(w.insurance.reserve),
    claims: w.insurance.claimCount,
    premiums: Math.round(w.insurance.premiumsIn),
    ruined: w.insurance.ruined,
    ruinMonth: w.insurance.ruinMonth,
    poorShareEnd: hhs.length ? hhs.filter((h) => h.poor).length / hhs.length : 0,
    personYears: py,
    ms,
  };
}

function pct(values: number[], q: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function aggregate(rows: BatchRow[], years: number, basisHash: string): BatchSummary {
  const keys: Array<keyof BatchRow> = ['population', 'births', 'deaths', 'ae', 'fertilityAe', 'tfr', 'e0M', 'e0F', 'marriages', 'divorces', 'emigrations', 'immigrations', 'incidents', 'arrests', 'illnesses', 'hospitalisations', 'reserve', 'claims', 'poorShareEnd'];
  const percentiles: BatchSummary['percentiles'] = {};
  for (const k of keys) {
    const vals = rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) continue;
    percentiles[k] = { p5: pct(vals, 0.05), p25: pct(vals, 0.25), p50: pct(vals, 0.5), p75: pct(vals, 0.75), p95: pct(vals, 0.95), mean: vals.reduce((a, b) => a + b, 0) / vals.length };
  }
  const A = rows.reduce((s, r) => s + r.deaths, 0);
  const E = rows.reduce((s, r) => s + r.expectedDeaths, 0);
  const B = rows.reduce((s, r) => s + r.births, 0);
  const EB = rows.reduce((s, r) => s + r.expectedBirths, 0);
  return {
    rows,
    years,
    seeds: rows.length,
    basisHash,
    percentiles,
    ruinProbability: rows.length ? rows.filter((r) => r.ruined).length / rows.length : 0,
    pooledAe: E > 0 ? A / E : null,
    pooledFertilityAe: EB > 0 ? B / EB : null,
  };
}

export function runBatch(params: Partial<ScenarioParams>, years: number, seeds: string[], onRow?: (row: BatchRow, i: number) => void): BatchSummary {
  const rows: BatchRow[] = [];
  let basisHash = '';
  const days = Math.round(years * 365.25);
  seeds.forEach((seed, i) => {
    const t0 = performance.now();
    const sim = new Simulation({ journalRetentionMonths: 0, ...params, seed });
    basisHash = sim.world.basisHash;
    const pop0 = alivePeople(sim.world).length;
    sim.runDays(days);
    const row = summariseRun(sim, seed, years, performance.now() - t0, pop0);
    rows.push(row);
    onRow?.(row, i);
  });
  return aggregate(rows, years, basisHash);
}

export function batchCsv(summary: BatchSummary): string {
  const cols = Object.keys(summary.rows[0] ?? {}) as Array<keyof BatchRow>;
  const lines = [cols.join(',')];
  for (const r of summary.rows) lines.push(cols.map((c) => String(r[c] ?? '')).join(','));
  return lines.join('\n');
}
