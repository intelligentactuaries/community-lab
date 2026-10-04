# Script API

Everything a [script](scripts.md) can call. These are the declarations the editor itself reads to complete and
check a script, so what completes in the editor is what exists.

## Provinces

### `province(options)`

```ts
province(options?: {
  seed?: string;                       // default "agincourt-12"
  basis?: Basis;                       // the parameters you change, e.g. { tfr: 1.6, ageProfile: 'ageing' }
  mortality?: string | MortalityTable; // a CSV in the workspace, or a table inline
  shocks?: Shock[];
}): Promise<Province>
```

Builds a province of the script's own, in the script's worker; the province on screen is untouched. The same seed
and basis give the same province, and the same basis hash, as the IDE's own. A basis entry the engine does not
accept (an unknown name, a value out of range) is left out with a warning in the Console, and the rest is built.
`mortality` and `shocks` take the same forms as in a [province file](province-files.md).

### The province

| Member | What it is |
|---|---|
| `p.run({ years })`, `p.run({ days })` | Lives whole days, with the same day step as the IDE's province (one year when neither is given). Returns the province, so calls chain. About three to four seconds a simulated year. |
| `p.date` | The current simulated date, `YYYY-MM-DD`. |
| `p.years` | Simulated years elapsed. |
| `p.basis` | The full basis the province was built on. |
| `p.basisHash` | The fingerprint of the basis, seed included. |
| `p.indicators()` | The 21 [indicators](../reference/indicators.md) for the run so far, by id. |
| `p.people()` | Residents alive and living in the province, one row each (below). |
| `p.households()` | Households that still exist, one row each (below). |
| `p.experience({ ageWidth, group })` | Deaths, person-years and expected deaths by calendar year, age and sex, rebuilt person by person (below). `ageWidth` defaults to 1 (single ages); `group` is `'none'` (the default), `'city'`, `'settlement'` or `'tier'`. |
| `p.events(kind)` | The event ledger (the most recent few thousand events), optionally of one kind: `'birth'`, `'death'`, `'wedding'` and so on. |
| `p.world` | The engine's own state. Read it; changing it is undefined behaviour. |

**`people()` rows:** `id`, `name`, `sex` (`'M'` or `'F'`), `age`, `city`, `settlement`, `tier`, `household`,
`education`, `job`, `income`, `marital`, `health`, `conditions` (a list), `heritage`, `born_here`.

**`households()` rows:** `id`, `name`, `city`, `settlement`, `tier`, `members`, `income`, `expenses`, `savings`,
`debt`, `poor`, `funeral_cover`, `life_cover`, `medical_aid`.

**`experience()` rows:** `year`, `age` (the lower edge of the band), `age_width`, `sex`, `group` (or `null`),
`person_years`, `deaths`, `expected_deaths` and `qx_basis`, the true basis's q for the cell. Exposure counts every
day a person lived in the province, at their age that day; expected deaths are the basis's daily hazard summed over
the same days, without individual risk.

## The worker pool

These put a job on the engine's worker pool, which runs several provinces at once. The Console follows each job's
progress, and **Stop** cancels any job the script started.

### `experiment(spec)`

```ts
experiment(spec: ExperimentSpec): Promise<ExperimentResult>
```

A paired experiment: the baseline and every arm on the same seeds. `spec` has the shape of an
[experiment file](experiment-files.md) (`title`, `question`, `audience`, `base`, `baseMortality`, `baseShocks`,
`arms`, `seeds`, `years`) and the same limits: at most six arms, 2 to 64 seeds, 1 to 40 years, and 800
province-years in all. The result:

| Field | What it is |
|---|---|
| `arms` | `arms[0]` is the baseline. Each arm has `id`, `label`, `metrics` (each indicator's distribution over the seeds: `mean`, `sd`, `p5`, `p50`, `p95`, `n`) and `effects` (each indicator's paired effect: `mean`, `lo`, `hi` (the 95% interval), `n`, and `better`, the seeds in which it moved the better way). The baseline's `effects` is `null`. |
| `rows` | Every run: one row per seed and arm, with every indicator. |
| `metrics` | The indicators' definitions. |
| `spec`, `id`, `elapsedMs` | What was run, its id, and how long it took. |

### `template(id, years)`

```ts
template(id: string, years?: number): ExperimentSpec   // years defaults to 10
```

One of the lab's [ready-made experiments](../reference/templates.md) as a spec on 8 seeds, ready to change and pass
to `experiment()`:

```js
const spec = template('premium-adequacy', 10);
spec.seeds = 16;                     // more seeds, a narrower interval
const r = await experiment(spec);
```

### `monteCarlo(options)`

```ts
monteCarlo(options: { basis?: Basis; seeds?: number; years?: number }): Promise<BatchSummary>
```

Seeds of one basis: 20 seeds by default (1 to 200) and 10 years (1 to 60). The result has `rows` (one per seed),
`percentiles` (5th, 25th, 50th, 75th and 95th, and the mean, of each outcome), `ruinProbability` (the share of seeds
in which the burial society's reserve went below zero), `pooledAe` and `pooledFertilityAe` (deaths and births
against the basis, pooled over the seeds), and `years`, `seeds` and `basisHash`.

### `pooledExperience(options)`

```ts
pooledExperience(options: {
  basis?: Basis; seeds?: number; years?: number;
  ageWidth?: 1 | 5; group?: 'none' | 'city' | 'settlement' | 'tier';
}): Promise<PooledExperience>
```

Mortality experience pooled over seeds of one basis: 16 seeds by default (at most 64), 10 years (at most 40),
five-year age bands unless `ageWidth` is 1, within 800 province-years. The result has `rows` (calendar year, age,
sex, person-years, deaths, expected deaths, the basis q), `headline` (person-years, deaths, A/E with its interval,
the calendar years), `truth` (the true basis it was generated on, by single age and sex: the answer key for a
fitted table) and `provenance`. Calendar years observed for less than half their days are left out.

## Output

| Function | What it does |
|---|---|
| `print(...values)` | A line in the Console. Objects are shown as JSON (cut at 20,000 characters). |
| `table(rows, columns)` | A table in the Console; `columns` defaults to the rows' keys. The first 2,000 rows are shown, with a note of how many there were. |
| `plot({ x, series, title, xLabel, yLabel, log })` | A line chart in the Console. `x` may be numbers or labels; each series is an array of numbers, and a `null` is a gap. `log: true` makes the y axis logarithmic. |
| `console.log`, `info`, `warn`, `error` | Also reach the Console. |

## Files

| Function | What it does |
|---|---|
| `csv(rows, columns)` | The rows as RFC 4180 CSV text, every row. |
| `await readFile(path)` | A text file of the workspace. |
| `await writeFile(path, text)` | Writes a text file into the workspace, making folders as needed; the explorer shows it at once. `text` must be a string: `csv()` makes one from rows. |

Paths are relative to the workspace and cannot leave it.

## Constants

| Name | What it is |
|---|---|
| `METRICS` | The [indicators](../reference/indicators.md): `id`, `label`, `unit`, `better`, `group`, `description`. |
| `DEFAULT_BASIS` | The default basis, every parameter. |
| `TEMPLATES` | The lab's ready-made experiments: `id`, `audience`, `title`, `question`. |

## Types

```ts
type Basis = Record<string, number | string | boolean | Record<string, unknown>>;

interface MortalityTable {
  label: string; source: string;
  ages: number[];                                   // ascending
  qx: { M: number[]; F: number[] } | { pooled: number[] };
  year?: number;                                    // the year the table is stated for
}

type Shock =
  | { kind: 'mortality'; label?: string; fromMonth: number; months: number; factor: number; minAge?: number; maxAge?: number }
  | { kind: 'repo'; label?: string; fromMonth: number; months: number; bp: number }
  | { kind: 'oil'; label?: string; fromMonth: number; months: number; factor: number };
```

## Errors

An error stops the script and is reported in the Console and in **Problems**, with the line of the script where it
happened. A rejected job (a spec over the limits, a table that does not parse) is an error with the engine's reason.
