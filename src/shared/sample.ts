// The sample workspace: what File › New workspace writes, so the workbench
// opens on something that runs. Every file is generated from the engine's
// own definitions (the lab's templates, the mortality presets, the default
// basis), so a sample can never describe a parameter, a template or a table
// the engine does not have.

import { buildQxTable, presetById } from '../sim/mortality';
import { DEFAULT_PARAMS } from '../sim/params';
import { EXPERIMENT_SCHEMA_URI, PROVINCE_SCHEMA_URI } from './files';
import { TEMPLATE_BY_ID } from './templates';

export interface SampleFile {
  path: string;
  text: string;
}

const j = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`;

function experimentFile(id: string, years: number, seeds: number, notes: string): string {
  const t = TEMPLATE_BY_ID.get(id);
  if (!t) throw new Error(`no template ${id}`);
  return j({ $schema: EXPERIMENT_SCHEMA_URI, notes, ...t.build(years), seeds, years });
}

/** The sa-2024 preset with mortality 15% heavier at every age: a "fitted" table to import, as CSV. */
function stressedTable(): string {
  const q = buildQxTable(presetById('sa-2024'));
  const lines = ['age,qx_m,qx_f'];
  for (let x = 0; x < q.M.length; x++) lines.push(`${x},${Math.min(1, q.M[x] * 1.15).toFixed(6)},${Math.min(1, q.F[x] * 1.15).toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}

const README = `# A Community Lab workspace

This folder is a project for Community Lab IDE. Everything in it is an ordinary
file: version it with git, share it, edit it in any editor.

| File | What running it does (Ctrl+Enter, or the Run button) |
|---|---|
| \`*.province.json\` | Rebuilds the province on it: a seed, the basis (only what differs from the defaults), and optionally a mortality table and timed shocks. |
| \`*.experiment.json\` | Runs a paired experiment on the worker pool: the baseline and each arm on the same seeds, effects with 95% intervals. The result is saved beside it under \`results/\`. |
| \`*.js\` | Runs a script beside the editor, with the engine and the worker pool at hand. Its output lands in the Console. |

Anything else (CSV, Markdown, JSON) opens as text.

## What is here

- \`scenarios/\`: the default province, an ageing one, and one that lives through a pandemic year.
- \`experiments/\`: the SAM life stresses on the burial society, and a higher old-age grant.
- \`scripts/\`: a first look at the province, A/E by age band, pooled experience over many seeds, and the funeral premium tested on the worker pool.
- \`bases/stressed-sa-2024.csv\`: a mortality table (the sa-2024 preset, 15% heavier at every age) for a province to live on. \`scenarios/stressed-basis.province.json\` uses it.

## The script API

A script is JavaScript, run as the body of an async function, so \`await\` works at the top level.

| | |
|---|---|
| \`await province({ seed, basis, mortality, shocks })\` | A province of its own, built in the script's worker. \`mortality\` may name a CSV in this workspace. |
| \`p.run({ years })\` / \`p.run({ days })\` | Lives whole days, as the IDE's province does (about four seconds a simulated year). |
| \`p.date\`, \`p.years\`, \`p.basis\`, \`p.basisHash\` | Where it has got to, and what it was built on. |
| \`p.indicators()\` | The lab's indicators (deaths per 1,000, A/E, e0, the society's reserve, poverty, Gini, ...): \`METRICS\` says how each is defined. |
| \`p.people()\`, \`p.households()\` | The residents and households as plain rows. |
| \`p.experience({ ageWidth })\` | Deaths, person-years and expected deaths by year, age and sex, on the true basis. |
| \`p.events(kind?)\` | The event ledger: births, deaths, weddings, incidents, the economy. |
| \`p.world\` | The engine's own state, read-only by convention. |
| \`await experiment(spec)\` | A paired experiment on the worker pool. \`template(id, years)\` gives one of the lab's. |
| \`await monteCarlo({ basis, seeds, years })\` | Seeds of one basis on the worker pool: percentiles, the probability of ruin, pooled A/E. |
| \`await pooledExperience({ basis, seeds, years, ageWidth })\` | Experience pooled over seeds, for a period table with enough deaths to fit. |
| \`print(...)\`, \`table(rows)\`, \`plot({ x, series })\` | Output in the Console. |
| \`await readFile(path)\`, \`await writeFile(path, text)\`, \`csv(rows)\` | This workspace's files. |

Every province and every run carries its basis hash: the same seed and the same basis give the same province, on any machine.
`;

const FIRST_LOOK = `// A first look: build the province, live two years, and read it.
// Run it with Ctrl+Enter (Cmd+Enter on a Mac). Two simulated years take about ten seconds.

const p = await province({ seed: 'first-look' });
print(\`\${p.basis.regionName} Province on \${p.date}: \${p.people().length} residents in \${p.households().length} households. Basis \${p.basisHash}.\`);

p.run({ years: 2 });
print(\`Two years on, \${p.date}:\`);

const ind = p.indicators();
const show = ['population', 'deaths_per_1000', 'ae', 'e0', 'scheme_reserve', 'poverty', 'unemployment', 'gini'];
table(METRICS.filter((m) => show.includes(m.id)).map((m) => ({ indicator: m.label, value: ind[m.id], unit: m.unit })));

// Who lives where
const byCity = {};
for (const person of p.people()) byCity[person.city] = (byCity[person.city] ?? 0) + 1;
table(Object.entries(byCity).map(([city, residents]) => ({ city, residents })));

// What happened: the last few births and deaths in the ledger
table(p.events().filter((e) => e.kind === 'birth' || e.kind === 'death').slice(-8));
`;

const AE_BY_AGE = `// Actual against expected deaths by age band, on the basis the province was built on.
// Five simulated years, about twenty seconds. One province is about 400 people, so the
// bands are noisy: scripts/pooled-experience.js pools seeds on the worker pool instead.

const p = await province({ seed: 'ae-by-age' });
p.run({ years: 5 });

const bands = {};
for (const r of p.experience({ ageWidth: 10 })) {
  const b = (bands[r.age] ??= { band: \`\${r.age}-\${r.age + 9}\`, person_years: 0, deaths: 0, expected: 0 });
  b.person_years += r.person_years;
  b.deaths += r.deaths;
  b.expected += r.expected_deaths;
}
const rows = Object.values(bands).map((b) => ({ ...b, ae: b.expected > 0 ? b.deaths / b.expected : null }));
table(rows, ['band', 'person_years', 'deaths', 'expected', 'ae']);
plot({ x: rows.map((b) => b.band), series: { 'A/E': rows.map((b) => b.ae) }, title: 'Actual / expected deaths by age band', yLabel: 'A/E' });

const D = rows.reduce((a, b) => a + b.deaths, 0);
const E = rows.reduce((a, b) => a + b.expected, 0);
print(\`Pooled A/E \${(D / E).toFixed(3)}: \${D} deaths against \${E.toFixed(1)} expected.\`);

await writeFile('results/ae-by-age.csv', csv(rows));
print('Saved results/ae-by-age.csv');
`;

const POOLED = `// Experience pooled over seeds: the same basis lived 16 times on the worker pool,
// enough deaths for a period table. About three minutes with eight workers.

const exp = await pooledExperience({ seeds: 16, years: 10, ageWidth: 5 });
print(exp.headline.map((h) => \`\${h.label}: \${h.value}\`).join(' · '));

// Crude central rates against the true basis, men, by five-year band
const cells = {};
for (const r of exp.rows.filter((r) => r.sex === 'M')) {
  const c = (cells[r.age] ??= { age: r.age, deaths: 0, person_years: 0, expected: 0 });
  c.deaths += r.deaths;
  c.person_years += r.person_years;
  c.expected += r.expected_deaths;
}
const rows = Object.values(cells).filter((c) => c.person_years > 0).map((c) => ({
  age: c.age,
  m_actual: c.deaths / c.person_years,
  m_basis: c.expected / c.person_years,
  deaths: c.deaths,
}));
plot({ x: rows.map((r) => r.age), series: { experience: rows.map((r) => r.m_actual || null), basis: rows.map((r) => r.m_basis) }, title: 'Men: crude death rates against the basis', yLabel: 'deaths per person-year', log: true });
await writeFile('results/pooled-experience.csv', csv(exp.rows));
print(\`Saved \${exp.rows.length} cells to results/pooled-experience.csv, with the true basis in the export's provenance.\`);
`;

const PREMIUM = `// Is the funeral premium adequate? The lab's template, run on the worker pool:
// the baseline and two arms (the premium cut and raised by a fifth) on the same
// 6 seeds for 8 years. About two minutes with eight workers.

const spec = template('premium-adequacy', 8);
spec.seeds = 6;
const r = await experiment(spec);

const m = (id) => METRICS.find((x) => x.id === id);
table(
  r.arms.slice(1).flatMap((arm) =>
    ['scheme_reserve', 'scheme_ruin', 'loss_ratio'].map((id) => ({
      arm: arm.label,
      indicator: m(id).label,
      baseline: r.arms[0].metrics[id].mean,
      effect: arm.effects[id].mean,
      lo95: arm.effects[id].lo,
      hi95: arm.effects[id].hi,
    })),
  ),
);
print('An interval that does not cross zero is an effect these seeds can tell from the province\\'s own randomness.');
`;

export const SAMPLE_FILES: SampleFile[] = [
  { path: 'README.md', text: README },
  {
    path: 'scenarios/baseline.province.json',
    text: j({ $schema: PROVINCE_SCHEMA_URI, title: 'The default province', notes: 'Unity Province on the default basis: published South African mortality (sa-2024) and fertility, the 2026/27 tax tables, a repo rate of 6.75%.', seed: DEFAULT_PARAMS.seed, basis: {} }),
  },
  {
    path: 'scenarios/ageing.province.json',
    text: j({ $schema: PROVINCE_SCHEMA_URI, title: 'An ageing province', notes: 'An older age profile, fertility well below replacement and faster mortality improvement: more pensioners, fewer workers, a heavier grant bill.', seed: 'ageing-1', basis: { ageProfile: 'ageing', tfr: 1.6, mortalityImprovement: 0.015 } }),
  },
  {
    path: 'scenarios/pandemic.province.json',
    text: j({
      $schema: PROVINCE_SCHEMA_URI,
      title: 'A pandemic year',
      notes: 'The default province, living through a year of pandemic mortality from its second year: every age a quarter heavier, and those of sixty and over a further 44%.',
      seed: DEFAULT_PARAMS.seed,
      basis: {},
      shocks: [
        { kind: 'mortality', label: 'Pandemic: all ages ×1.25', fromMonth: 12, months: 12, factor: 1.25 },
        { kind: 'mortality', label: 'Pandemic: 60 and over a further ×1.44', fromMonth: 12, months: 12, factor: 1.44, minAge: 60 },
      ],
    }),
  },
  {
    path: 'scenarios/stressed-basis.province.json',
    text: j({ $schema: PROVINCE_SCHEMA_URI, title: 'Living on a supplied table', notes: 'The province lives on bases/stressed-sa-2024.csv instead of its preset: every death channel follows the table, and A/E is measured against it.', seed: DEFAULT_PARAMS.seed, basis: {}, mortality: 'bases/stressed-sa-2024.csv' }),
  },
  { path: 'experiments/sam-life-stresses.experiment.json', text: experimentFile('sam-life-stresses', 10, 8, 'SAM life underwriting stresses, lived through: mortality +15% at every age for the whole run, and a catastrophe month of 1.5 extra deaths per 1,000 lives.') },
  { path: 'experiments/old-age-grant.experiment.json', text: experimentFile('old-age-grant', 10, 8, 'A 20% higher older persons grant: what it costs the fiscus, and what it buys in poverty and health.') },
  { path: 'scripts/first-look.js', text: FIRST_LOOK },
  { path: 'scripts/ae-by-age.js', text: AE_BY_AGE },
  { path: 'scripts/pooled-experience.js', text: POOLED },
  { path: 'scripts/premium-check.js', text: PREMIUM },
  { path: 'bases/stressed-sa-2024.csv', text: stressedTable() },
];
