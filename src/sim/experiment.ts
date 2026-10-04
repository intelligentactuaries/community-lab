// Experiments: does a policy, a stress or a basis change the province, and by
// how much? Each arm runs on the same seeds as the baseline — the same
// households, the same weather, the same dice wherever the change does not
// reach (the engine's named random-number streams) — so the difference
// between an arm and the baseline on one seed is the change's doing, and the
// spread of those paired differences over the seeds is the uncertainty that
// is left. Far fewer seeds are needed than for two independent samples.
//
// The indicators are the questions three audiences ask of a province:
//   actuaries     deaths against the basis, the burial society's reserve,
//                 claims against premiums, ruin;
//   governments   poverty, inequality, unemployment, output, inflation,
//                 tax, grants, the fiscal balance;
//   social        life expectancy, child deaths, cover, debt and savings,
//   developers    crime.
// Every definition is stated in METRICS, and every one is computed from the
// engine's own records after the run.

import {
  type ArmResult,
  type ExperimentArm,
  type ExperimentResult,
  type ExperimentSpec,
  type MetricDef,
  EXCHANGE_SCHEMA,
  distribution,
  pairedEffect,
} from '../shared/exchange';
import { alivePeople } from './ctx';
import { Simulation } from './engine';
import { assumptionsHash, type ScenarioParams } from './params';
import { applyPatch } from './patch';
import { experienceE0 } from './stats';
import { DAYS_PER_YEAR } from './time';

export const METRICS: MetricDef[] = [
  { id: 'population', label: 'Residents at the end', unit: 'people', better: 'neutral', group: 'demography', description: 'People living in the province on the last day.' },
  { id: 'deaths_per_1000', label: 'Deaths per 1,000 a year', unit: '‰', better: 'lower', group: 'health', description: 'Deaths over the run per 1,000 person-years lived (the crude death rate).' },
  { id: 'ae', label: 'Deaths: actual / expected', unit: '×', better: 'neutral', group: 'health', description: 'Deaths over the run against the expected deaths on the basis, age by age and day by day (pooled A/E).' },
  { id: 'e0', label: 'Life expectancy at birth', unit: 'years', better: 'higher', group: 'health', description: 'The basis table scaled by the run\'s own A/E for each sex; men and women averaged.' },
  { id: 'u5mr', label: 'Under-five deaths per 1,000 births', unit: '‰', better: 'lower', group: 'health', description: 'Deaths of children under five over the run per 1,000 births over the run.' },
  { id: 'hospital_per_1000', label: 'Hospital admissions per 1,000 a year', unit: '‰', better: 'lower', group: 'health', description: 'Clinic-ward and central-hospital admissions per 1,000 person-years.' },
  { id: 'scheme_reserve', label: 'Burial society reserve at the end', unit: 'R', better: 'higher', group: 'insurance', description: 'The society\'s reserve on the last day (nominal rand).' },
  { id: 'scheme_ruin', label: 'Burial society ruined', unit: '0/1', better: 'lower', group: 'insurance', description: '1 if the reserve went below zero during the run (its mean over seeds is the probability of ruin).' },
  { id: 'loss_ratio', label: 'Claims / premiums', unit: '×', better: 'lower', group: 'insurance', description: 'Claims paid over the run against premiums received.' },
  { id: 'funeral_cover', label: 'Households with funeral cover', unit: 'share', better: 'higher', group: 'insurance', description: 'Share of households holding funeral cover on the last day.' },
  { id: 'poverty', label: 'Households in poverty (last year)', unit: 'share', better: 'lower', group: 'equity', description: 'Share of households below the poverty line, averaged over the last twelve month-ends.' },
  { id: 'gini', label: 'Income Gini (last year)', unit: 'index', better: 'lower', group: 'equity', description: 'Gini coefficient of household income, averaged over the last twelve months.' },
  { id: 'unemployment', label: 'Unemployment (last year)', unit: 'share', better: 'lower', group: 'economy', description: 'Unemployment rate, averaged over the last twelve months.' },
  { id: 'gdp_per_capita', label: 'Real GDP per resident (last year)', unit: 'R', better: 'higher', group: 'economy', description: 'Real GDP over the last twelve months (start-of-run prices) per resident.' },
  { id: 'inflation', label: 'Inflation, a year on average', unit: 'share', better: 'lower', group: 'economy', description: 'Annualised growth of the province\'s CPI over the run.' },
  { id: 'household_debt', label: 'Household debt at the end', unit: 'R', better: 'lower', group: 'economy', description: 'Sum of households\' debt on the last day.' },
  { id: 'household_savings', label: 'Household savings at the end', unit: 'R', better: 'higher', group: 'economy', description: 'Sum of households\' savings on the last day.' },
  { id: 'tax_revenue', label: 'Tax revenue a year', unit: 'R', better: 'neutral', group: 'fiscal', description: 'Taxes collected over the run, per year.' },
  { id: 'grant_spend', label: 'Social grants a year', unit: 'R', better: 'neutral', group: 'fiscal', description: 'SASSA child-support and older-persons grants paid over the run, per year.' },
  { id: 'fiscal_balance', label: 'Fiscal balance a year', unit: 'R', better: 'higher', group: 'fiscal', description: 'Tax revenue less government spending over the run, per year.' },
  { id: 'incidents_per_1000', label: 'Incidents per 1,000 a year', unit: '‰', better: 'lower', group: 'justice', description: 'Crimes, intrusions and other incidents per 1,000 person-years.' },
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);

/** Every indicator in METRICS for a finished run. */
export function indicators(sim: Simulation): Record<string, number> {
  const w = sim.world;
  const st = w.stats;
  const F = w.finance;
  const days = Math.max(1, w.lastDayStep);
  const years = days / DAYS_PER_YEAR;
  const py = st.exposures.reduce((a, e) => a + e.exposureM + e.exposureF, 0);
  const expected = st.exposures.reduce((a, e) => a + e.expectedM + e.expectedF, 0);
  const per1000 = (n: number) => (py > 0 ? (n / py) * 1000 : Number.NaN);
  const e0M = experienceE0(sim.ctx, 'M');
  const e0F = experienceE0(sim.ctx, 'F');
  const u5 = (st.deathsByBand['0'] ?? 0) + (st.deathsByBand['1-4'] ?? 0);
  const hhs = Object.values(w.households).filter((h) => h.dissolvedDay === null && h.memberIds.length);
  const snaps = st.series.slice(-12);
  const months = F ? F.macro.months : [];
  const last12 = months.slice(-12);
  const pop12 = mean(snaps.map((s) => s.population));
  let grants = 0;
  for (const row of F?.flows ?? []) for (const [k, v] of Object.entries(row.cells)) if (k.endsWith('>grants')) grants += v;
  const cpiEnd = F ? F.macro.cpi : Number.NaN;
  return {
    population: alivePeople(w).length,
    deaths_per_1000: per1000(st.deaths),
    ae: expected > 0 ? st.deaths / expected : Number.NaN,
    e0: e0M !== null && e0F !== null ? (e0M + e0F) / 2 : Number.NaN,
    u5mr: st.births > 0 ? (u5 / st.births) * 1000 : Number.NaN,
    hospital_per_1000: per1000(st.hospitalisations),
    scheme_reserve: Math.round(w.insurance.reserve),
    scheme_ruin: w.insurance.ruined ? 1 : 0,
    loss_ratio: w.insurance.premiumsIn > 0 ? w.insurance.claimsOut / w.insurance.premiumsIn : Number.NaN,
    funeral_cover: hhs.length ? hhs.filter((h) => h.insurance.funeral).length / hhs.length : Number.NaN,
    poverty: mean(snaps.filter((s) => s.households > 0).map((s) => s.poorHouseholds / s.households)),
    gini: mean(last12.map((m) => m.giniIncome)),
    unemployment: mean(last12.map((m) => m.unemploymentRate)),
    gdp_per_capita: pop12 > 0 ? last12.reduce((a, m) => a + m.gdpReal, 0) / pop12 : Number.NaN,
    inflation: years > 0 && cpiEnd > 0 ? Math.pow(cpiEnd / 100, 1 / years) - 1 : Number.NaN,
    household_debt: Math.round(hhs.reduce((a, h) => a + h.debt, 0)),
    household_savings: Math.round(hhs.reduce((a, h) => a + h.savings, 0)),
    tax_revenue: Math.round(months.reduce((a, m) => a + m.taxRevenue, 0) / years),
    grant_spend: Math.round(grants / years),
    fiscal_balance: Math.round(months.reduce((a, m) => a + m.fiscalBalance, 0) / years),
    incidents_per_1000: per1000(st.incidents),
  };
}

/** The parameters of one arm on one seed: the base and its basis and shocks, then the arm's changes, its own basis
 *  (in place of the base's) and its shocks (after the base's). */
export function armParams(spec: Pick<ExperimentSpec, 'base' | 'baseMortality' | 'baseShocks'>, arm: ExperimentArm | null, seed: string): { params: Partial<ScenarioParams>; rejected: string[] } {
  const base = applyPatch({}, spec.base);
  const withArm = arm ? applyPatch(base.params, arm.params) : base;
  const params: Partial<ScenarioParams> = { ...withArm.params, seed, journalRetentionMonths: 0 };
  const mortality = arm?.mortality ?? spec.baseMortality;
  if (mortality) params.mortalityOverride = mortality;
  const shocks = [...(spec.baseShocks ?? []), ...(arm?.shocks ?? [])];
  if (shocks.length) params.shocks = shocks;
  return { params, rejected: [...base.rejected, ...(arm ? withArm.rejected : [])] };
}

/** The seeds of an experiment: shared by every arm. */
export function experimentSeeds(spec: Pick<ExperimentSpec, 'seeds'>): string[] {
  return Array.from({ length: spec.seeds }, (_, i) => `exp-${i + 1}`);
}

export interface ArmRun {
  arm: string;
  seed: string;
  metrics: Record<string, number>;
  ms: number;
  basisHash: string;
  assumptionsHash: string;
}

/** Run one arm on one seed for the experiment's years (time-lapse; the same pipeline as the animated province).
 *  `onDay` runs after every simulated day — the server's workers check for a cancel there. */
export function runArm(spec: Pick<ExperimentSpec, 'base' | 'baseMortality' | 'baseShocks' | 'years'>, arm: ExperimentArm | null, seed: string, onDay?: (day: number) => void): ArmRun {
  const t0 = performance.now();
  const { params } = armParams(spec, arm, seed);
  const sim = new Simulation(params);
  sim.runDays(Math.round(spec.years * DAYS_PER_YEAR), onDay);
  return { arm: arm?.id ?? 'baseline', seed, metrics: indicators(sim), ms: Math.round(performance.now() - t0), basisHash: sim.world.basisHash, assumptionsHash: assumptionsHash(sim.params) };
}

/** Distributions per arm and paired effects against the baseline, from the runs of every arm on every seed. */
export function summariseExperiment(id: string, spec: ExperimentSpec, runs: ArmRun[], elapsedMs: number, appVersion: string): ExperimentResult {
  const seeds = experimentSeeds(spec);
  const arms: Array<{ id: string; label: string }> = [{ id: 'baseline', label: 'Baseline' }, ...spec.arms.map((a) => ({ id: a.id, label: a.label }))];
  const byArm = new Map<string, Map<string, ArmRun>>();
  for (const r of runs) {
    let m = byArm.get(r.arm);
    if (!m) byArm.set(r.arm, (m = new Map()));
    m.set(r.seed, r);
  }
  const series = (arm: string, metric: string) => seeds.map((s) => byArm.get(arm)?.get(s)?.metrics[metric] ?? Number.NaN);
  const results: ArmResult[] = arms.map((a) => ({
    id: a.id,
    label: a.label,
    metrics: Object.fromEntries(METRICS.map((m) => [m.id, distribution(series(a.id, m.id))])),
    effects: a.id === 'baseline' ? null : Object.fromEntries(METRICS.map((m) => [m.id, pairedEffect(series(a.id, m.id), series('baseline', m.id), m.better)])),
  }));
  const rows = runs
    .slice()
    .sort((x, y) => seeds.indexOf(x.seed) - seeds.indexOf(y.seed) || arms.findIndex((a) => a.id === x.arm) - arms.findIndex((a) => a.id === y.arm))
    .map((r) => ({ seed: r.seed, arm: r.arm, ...Object.fromEntries(METRICS.map((m) => [m.id, Number.isFinite(r.metrics[m.id]) ? r.metrics[m.id] : null])) }));
  const base = byArm.get('baseline');
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.experiment',
    id,
    spec,
    metrics: METRICS,
    arms: results,
    rows,
    provenance: {
      app: 'community-lab',
      appVersion,
      createdAt: new Date().toISOString(),
      seeds: spec.seeds,
      assumptionsHash: base?.values().next().value?.assumptionsHash,
      scenario: spec.title,
      notes: [`${spec.seeds} seeds × ${spec.years} years for each of ${arms.length} arms (the baseline and ${spec.arms.length} more), every arm on the same seeds.`],
    },
    elapsedMs,
  };
}
