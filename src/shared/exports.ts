// Community Lab's exports (the data contract, ./exchange.ts): the province's
// data as plain tables, each with its data dictionary, its provenance, and,
// for synthetic experience, the true basis it was made on.
// Used by the browser for the province on screen and by the server for pooled
// Monte Carlo exports, so both send exactly the same columns.
//
// Column names are the ones actuarial tools look for (and that Scelo IDE's
// detectors route by), so the data is ready to fit:
//   experience     year · age · sex · deaths · person_years  → Lee–Carter, CBD, life tables, A/E
//   person-years   death_event (0/1)                          → GBM and SHAP: who dies, and why
//   model points   age_at_entry · sum_assured · policy_term   → lifelib BasicTerm, IFRS 17, Solvency II
// `person_years` (not `exposure`, which catastrophe tools read as insured
// value) is the time at risk.

import {
  type CommunityExport,
  EXCHANGE_SCHEMA,
  type ExchangeColumn,
  type ExchangeRow,
  type ExperimentResult,
  type Provenance,
  type TrueBasis,
} from './exchange';
import pkg from '../../package.json';
import type { ExperienceCell, ModelPointRow, PersonYearRow } from '../sim/experience';

export const APP_VERSION: string = pkg.version;

const id = (kind: string) => `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function provenanceFor(base: Omit<Provenance, 'app' | 'appVersion' | 'createdAt'>): Provenance {
  return { app: 'community-lab', appVersion: APP_VERSION, createdAt: new Date().toISOString(), ...base };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Pooled A/E with its Poisson 95% interval, for a headline. */
function aeLine(deaths: number, expected: number): string {
  if (expected <= 0) return 'n/a';
  const half = 1.96 * Math.sqrt(Math.max(deaths, 0.5));
  return `${(deaths / expected).toFixed(3)} (95% ${(Math.max(0, deaths - half) / expected).toFixed(2)}–${((deaths + half) / expected).toFixed(2)})`;
}

const yes = (b: boolean) => (b ? 'yes' : 'no');

// ─── experience ─────────────────────────────────────────────────────────

const EXPERIENCE_COLUMNS = (banded: boolean, group: string | null): ExchangeColumn[] => [
  { name: 'year', description: 'Calendar year' },
  { name: 'age', description: banded ? 'Lower edge of the age band (age last birthday)' : 'Age last birthday', unit: 'years' },
  ...(banded ? [{ name: 'age_width', description: 'Width of the age band (the last band runs from 100 to the end of the table)', unit: 'years' }] : []),
  { name: 'sex', description: 'M or F' },
  ...(group ? [{ name: group, description: `The ${group} the person lived in (as at death, departure or the end)` }] : []),
  { name: 'person_years', description: 'Central exposure: days lived in the province in the cell, in years', unit: 'years' },
  { name: 'deaths', description: 'Deaths in the cell' },
  { name: 'expected_deaths', description: 'Deaths expected on the true basis (with improvement), day by day, without individual risk', unit: 'deaths' },
  { name: 'qx_basis', description: 'The true basis q, exposure-weighted over the cell: the answer key for a fitted table' },
];

export function experienceExport(cells: ExperienceCell[], o: { truth: TrueBasis; provenance: Provenance; ageWidth: number; group: string | null }): CommunityExport {
  const banded = o.ageWidth > 1;
  const rows: ExchangeRow[] = cells.map((c) => ({
    year: c.year,
    age: c.age,
    ...(banded ? { age_width: c.ageWidth } : {}),
    sex: c.sex,
    ...(o.group ? { [o.group]: c.group } : {}),
    person_years: r6(c.personYears),
    deaths: c.deaths,
    expected_deaths: r6(c.expected),
    qx_basis: r6(c.qxBasis),
  }));
  const D = cells.reduce((a, c) => a + c.deaths, 0);
  const E = cells.reduce((a, c) => a + c.expected, 0);
  const PY = cells.reduce((a, c) => a + c.personYears, 0);
  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  const seeds = o.provenance.seeds ?? 1;
  const sparse = D < 400;
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.export',
    id: id('experience'),
    exportKind: 'experience',
    title: `Unity Province · mortality experience${seeds > 1 ? ` · ${seeds} seeds pooled` : ''}`,
    summary:
      `Deaths and person-years by calendar year, ${banded ? `${o.ageWidth}-year age band` : 'single age'} and sex, ${years[0]}–${years[years.length - 1]}, rebuilt person by person from the simulated province${seeds > 1 ? ` and pooled over ${seeds} seeds of the same basis` : ''}. ` +
      `The true basis travels with it (qx_basis, and the full table in the truth): fit a table to it (Lee–Carter, CBD, a life table, in R, Python or Scelo IDE), then score it against the answer. ` +
      'Calendar years the province lived for less than half of are left out: a period model reads every year as a whole one.' +
      (sparse ? ` With ${D} deaths most cells are empty; pool more seeds (Community Lab's Monte Carlo export) before fitting a period model.` : ''),
    provenance: o.provenance,
    tables: [{ name: 'unity_mortality_experience', title: 'Mortality experience', description: 'One row per calendar year × age × sex cell with exposure.', columns: EXPERIENCE_COLUMNS(banded, o.group), rows }],
    truth: o.truth,
    headline: [
      { label: 'Person-years', value: Math.round(PY).toLocaleString('en-GB') },
      { label: 'Deaths', value: D.toLocaleString('en-GB') },
      { label: 'A/E on the true basis', value: aeLine(D, E) },
      { label: 'Calendar years', value: `${years[0]}–${years[years.length - 1]}` },
    ],
  };
}

// ─── person-years and deaths ─────────────────────────────────────────────

const PERSON_YEAR_COLUMNS: ExchangeColumn[] = [
  { name: 'person_id', description: 'Resident id (stable within the run)' },
  { name: 'year', description: 'Calendar year' },
  { name: 'age', description: 'Age last birthday when the year\'s exposure starts', unit: 'years' },
  { name: 'sex', description: 'M or F' },
  { name: 'person_years', description: 'Time at risk in the year: use it as an offset (log exposure), not as a predictor', unit: 'years' },
  { name: 'death_event', description: '1 if the person died in the year, else 0 (the outcome)' },
  { name: 'city', description: 'Emmaus, Newhaven or Ithemba' },
  { name: 'settlement', description: 'The settlement within the city' },
  { name: 'tier', description: 'The settlement\'s wealth tier' },
  { name: 'heritage', description: 'The people of the family they were born into' },
  { name: 'born_here', description: 'yes if born in the province' },
  { name: 'education', description: 'Highest education (as at the end of observation)' },
  { name: 'job', description: 'Occupation (as at the end of observation)' },
  { name: 'income_monthly', description: 'Gross monthly income (as at the end of observation)', unit: 'R' },
  { name: 'household_size', description: 'Members of the household (as at the end of observation)' },
  { name: 'poor_household', description: 'yes if the household is below the poverty line (as at the end of observation)' },
  { name: 'funeral_cover', description: 'yes if the household holds funeral cover (as at the end of observation)' },
  { name: 'medical_aid', description: 'yes if the household holds medical aid (as at the end of observation)' },
  { name: 'chronic_conditions', description: 'Chronic conditions other than HIV (as at the end of observation)' },
  { name: 'hiv', description: 'negative, on ART or untreated (as at the end of observation)' },
  { name: 'vitality', description: 'Frailty index, 0 (frail) to 1 (fit) (as at the end of observation)' },
];

export function personYearsExport(rows: PersonYearRow[], o: { truth: TrueBasis; provenance: Provenance }): CommunityExport {
  const panel: ExchangeRow[] = rows.map((r) => ({
    person_id: r.personId,
    year: r.year,
    age: r.age,
    sex: r.sex,
    person_years: r6(r.personYears),
    death_event: r.deathEvent,
    city: r.city,
    settlement: r.settlement,
    tier: r.tier,
    heritage: r.heritage,
    born_here: yes(r.bornHere),
    education: r.education,
    job: r.job,
    income_monthly: r.incomeMonthly,
    household_size: r.householdSize,
    poor_household: yes(r.householdPoor),
    funeral_cover: yes(r.funeralCover),
    medical_aid: yes(r.medicalAid),
    chronic_conditions: r.chronicConditions,
    hiv: r.hiv,
    vitality: r.vitality,
  }));
  const deaths: ExchangeRow[] = rows
    .filter((r) => r.deathEvent === 1)
    .map((r) => ({ person_id: r.personId, year: r.year, age: r.age, sex: r.sex, cause: r.cause ?? 'unknown', settlement: r.settlement, poor_household: yes(r.householdPoor), hiv: r.hiv }));
  const D = deaths.length;
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.export',
    id: id('person-years'),
    exportKind: 'person-years',
    title: 'Unity Province · who dies: the person-year panel',
    summary:
      `Every resident, year by year: ${panel.length.toLocaleString('en-GB')} person-years with ${D} deaths and the person's circumstances. ` +
      'A classifier on death_event (a gradient-boosted model, then SHAP) should rediscover what the simulation knows drives risk (age, poverty, HIV, frailty: see the true basis); a Poisson GLM with log(person_years) as the offset estimates it properly. ' +
      'The deaths register, with causes, travels as a second table (it is kept out of the panel: a cause would give the outcome away).',
    provenance: o.provenance,
    tables: [
      { name: 'unity_person_years', title: 'Person-year panel', description: 'One row per resident per calendar year of exposure.', columns: PERSON_YEAR_COLUMNS, rows: panel },
      {
        name: 'unity_deaths',
        title: 'Deaths register',
        description: 'One row per death, with the cause.',
        columns: [
          { name: 'person_id', description: 'Resident id' },
          { name: 'year', description: 'Calendar year of death' },
          { name: 'age', description: 'Age at the start of that year\'s exposure', unit: 'years' },
          { name: 'sex', description: 'M or F' },
          { name: 'cause', description: 'Cause of death as recorded' },
          { name: 'settlement', description: 'Settlement' },
          { name: 'poor_household', description: 'yes if the household was below the poverty line' },
          { name: 'hiv', description: 'HIV status' },
        ],
        rows: deaths,
      },
    ],
    truth: o.truth,
    headline: [
      { label: 'Person-years', value: panel.length.toLocaleString('en-GB') },
      { label: 'Deaths', value: String(D) },
    ],
  };
}

// ─── the burial society's book ───────────────────────────────────────────

export function modelPointsExport(points: ModelPointRow[], o: { provenance: Provenance; asAt: string }): CommunityExport {
  const rows: ExchangeRow[] = points.map((p) => ({
    policy_id: p.policyId,
    household_id: p.householdId,
    cover: p.cover,
    age_at_entry: p.ageAtEntry,
    sex: p.sex,
    sum_assured: p.sumAssured,
    policy_term: p.policyTerm,
    duration_mth: p.durationMonths,
    premium_pp: p.premiumPp,
  }));
  const sa = points.reduce((a, p) => a + p.sumAssured, 0);
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.export',
    id: id('model-points'),
    exportKind: 'model-points',
    title: `Unity Province · burial society in force at ${o.asAt}`,
    summary:
      `The province's burial society as lifelib model points: ${points.length} covered lives and covers, R${Math.round(sa).toLocaleString('en-GB')} sum assured. ` +
      'Funeral cover is whole of life, written as a term to age 100; life cover runs to 65. Value it with lifelib (BasicTerm, IFRS 17, Solvency II) or any projection engine and compare with Community Lab\'s own pricing in its Actuarial workbench — two engines, one book.',
    provenance: o.provenance,
    tables: [
      {
        name: 'unity_burial_society_model_points',
        title: 'Burial society model points',
        description: 'One row per covered life and cover.',
        columns: [
          { name: 'policy_id', description: 'Household, person and cover' },
          { name: 'household_id', description: 'The covered household' },
          { name: 'cover', description: 'funeral or life' },
          { name: 'age_at_entry', description: 'Age when the life came under the household\'s cover', unit: 'years' },
          { name: 'sex', description: 'M or F' },
          { name: 'sum_assured', description: 'Benefit, CPI-indexed to the as-at date', unit: 'R' },
          { name: 'policy_term', description: 'Term in years (funeral: to age 100; life: to 65)', unit: 'years' },
          { name: 'duration_mth', description: 'Months in force', unit: 'months' },
          { name: 'premium_pp', description: 'Monthly premium for this life and cover (a household premium shared over its covered lives)', unit: 'R' },
        ],
        rows,
      },
    ],
    headline: [
      { label: 'Lives × covers', value: String(points.length) },
      { label: 'Sum assured', value: `R${Math.round(sa).toLocaleString('en-GB')}` },
    ],
  };
}

// ─── the economy ────────────────────────────────────────────────────────

export function macroExport(rows: ExchangeRow[], o: { provenance: Provenance }): CommunityExport {
  const col = (name: string, description: string, unit?: string): ExchangeColumn => ({ name, description, unit });
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.export',
    id: id('macro'),
    exportKind: 'macro',
    title: 'Unity Province · the economy month by month',
    summary: `${rows.length} months of the province's own economy: prices, the repo rate its Monetary Policy Committee set, output by the three approaches, jobs, inequality, the fiscus, the bank and the markets it imports energy from. A forecast fitted here can be tested on months the province has not lived yet — run it on and compare.`,
    provenance: o.provenance,
    tables: [
      {
        name: 'unity_economy_monthly',
        title: 'Economy, monthly',
        description: 'One row per month.',
        columns: [
          col('date', 'First day of the month'),
          col('month', 'Months since the start'),
          col('cpi', 'Consumer price index (start = 100)'),
          col('inflation_yoy', 'Inflation, year on year'),
          col('repo_rate', 'Repo rate'),
          col('prime_rate', 'Prime lending rate'),
          col('gdp_nominal', 'GDP in the month, current prices', 'R'),
          col('gdp_real', 'GDP in the month, start-of-run prices', 'R'),
          col('unemployment_rate', 'Unemployment rate'),
          col('employed', 'People employed'),
          col('gini_income', 'Gini coefficient of household income'),
          col('gini_wealth', 'Gini coefficient of household wealth'),
          col('tax_revenue', 'Taxes collected in the month', 'R'),
          col('government_spending', 'Government spending in the month', 'R'),
          col('fiscal_balance', 'Tax revenue less spending', 'R'),
          col('household_disposable', 'Household disposable income', 'R'),
          col('saving_rate', 'Household saving rate'),
          col('bank_deposits', 'Deposits at the Mutual Bank', 'R'),
          col('bank_loans', 'Loans of the Mutual Bank', 'R'),
          col('petrol_rand_per_litre', '95 unleaded inland', 'R/l'),
          col('brent_usd', 'Brent crude', 'US$/bbl'),
          col('zar_per_usd', 'Rand per dollar'),
        ],
        rows,
      },
    ],
  };
}

// ─── experiments ────────────────────────────────────────────────────────

export function experimentExport(r: ExperimentResult): CommunityExport {
  const cols: ExchangeColumn[] = [
    { name: 'seed', description: 'Seed (every arm runs on every seed)' },
    { name: 'arm', description: 'baseline, or the arm\'s id' },
    ...r.metrics.map((m) => ({ name: m.id, description: `${m.label}: ${m.description}`, unit: m.unit })),
  ];
  const effects = r.arms
    .filter((a) => a.effects)
    .flatMap((a) =>
      r.metrics
        .filter((m) => a.effects && Number.isFinite(a.effects[m.id].mean))
        .map((m) => {
          const e = a.effects?.[m.id];
          return { arm: a.id, metric: m.id, label: m.label, unit: m.unit, baseline_mean: r.arms[0].metrics[m.id].mean, effect: e?.mean ?? null, lo95: e?.lo ?? null, hi95: e?.hi ?? null, seeds: e?.n ?? 0, better_share: e?.better ?? null } as ExchangeRow;
        }),
    );
  return {
    schema: EXCHANGE_SCHEMA,
    kind: 'community.export',
    id: id('experiment'),
    exportKind: 'experiment',
    title: `Unity Province · experiment: ${r.spec.title}`,
    summary: `${r.spec.question ? `${r.spec.question} ` : ''}A paired comparison: ${r.spec.seeds} seeds × ${r.spec.years} years for the baseline and ${r.spec.arms.length} arm${r.spec.arms.length === 1 ? '' : 's'}, every arm on the same seeds. The first table has one row per seed and arm; the second, each arm's effect with its 95% interval.`,
    provenance: r.provenance,
    tables: [
      { name: 'unity_experiment_runs', title: 'Runs', description: 'One row per seed × arm.', columns: cols, rows: r.rows },
      {
        name: 'unity_experiment_effects',
        title: 'Effects against the baseline',
        description: 'Mean paired difference (arm − baseline) with its 95% interval, per arm and indicator.',
        columns: [
          { name: 'arm', description: 'The arm' },
          { name: 'metric', description: 'Indicator id' },
          { name: 'label', description: 'Indicator' },
          { name: 'unit', description: 'Unit' },
          { name: 'baseline_mean', description: 'The baseline\'s mean over the seeds' },
          { name: 'effect', description: 'Mean of arm − baseline over the seeds' },
          { name: 'lo95', description: 'Lower end of the 95% interval' },
          { name: 'hi95', description: 'Upper end of the 95% interval' },
          { name: 'seeds', description: 'Seeds in the comparison' },
          { name: 'better_share', description: 'Share of seeds in which the arm did better' },
        ],
        rows: effects,
      },
    ],
  };
}
