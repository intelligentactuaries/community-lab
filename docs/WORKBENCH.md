# The workbench

The workbench is Community Lab IDE's second view (**Ctrl+2**, or the *Workbench* switch in the top bar; **Ctrl+1**
goes back to the province). It is a folder of ordinary files, an editor that knows their shapes, a run for each
kind of file, and a Console and a Problems list below. The province keeps its own clock while you are here: the
play button in the top bar still runs it.

## The workspace

A workspace is any folder. *File › Open Folder* opens one; *File › New Workspace* writes the sample (below) into a
new folder, by default in your Documents. The IDE remembers the folder and the files you had open, and the
recently used folders are under *File › Open Recent*.

The explorer on the left shows the folder (folders first, then files; `node_modules`, `.git` and hidden files are
left out). Hover over a file for its tools: run it, rename it, or move it to the trash (the system's trash in the
desktop app; in a browser, the IDE's own trash folder in its data folder). The **+** button makes a new province,
experiment, script or note in the folder for its kind, or saves the province on screen as a province file.

Everything is a plain text file, so a workspace can be versioned with git, diffed, reviewed and shared like any
other project. The IDE writes a file by writing a temporary copy and renaming it over the original, so a crash
never leaves half a file, and it will not save over a file that changed on disk after you opened it (another
editor, a sync folder): the tab says so and offers to reload it or to keep yours.

Paths never leave the workspace: the server that reads and writes the files resolves every path inside the
folder and refuses `..`, absolute paths, and links that point somewhere else.

## Files that run

**Ctrl+Enter** (or the Run button above the editor, or the ▶ on a file in the explorer) runs the file in front. A
file is saved before it runs, so what runs is what is on disk. Anything wrong is listed in **Problems** against the
file, with its line where there is one, and nothing is half-applied.

### `*.province.json`: a province

```json
{
  "$schema": "https://intelligentactuaries.com/schemas/community-lab/province.json",
  "title": "An ageing province",
  "notes": "An older age profile, fertility well below replacement and faster mortality improvement.",
  "seed": "ageing-1",
  "basis": { "ageProfile": "ageing", "tfr": 1.6, "mortalityImprovement": 0.015 },
  "mortality": "bases/stressed-sa-2024.csv",
  "shocks": [
    { "kind": "mortality", "label": "Pandemic: all ages ×1.25", "fromMonth": 12, "months": 12, "factor": 1.25 }
  ]
}
```

| Field | What it is |
|---|---|
| `seed` | Same seed and basis, same province: the households, the weather and every draw the basis does not change. |
| `basis` | The scenario parameters that differ from the defaults, by their names in `src/sim/params.ts`. The editor completes them and shows each one's meaning, range and default. Values outside the range the engine accepts are left out and named in Problems. |
| `mortality` | Optional. A mortality table to live on instead of the preset: a CSV in the workspace (see below) or a table inline (`{ "label", "source", "ages", "qx": { "M": [...], "F": [...] } }`). Every death channel follows it, and A/E is measured against it. |
| `shocks` | Optional. Timed shocks, months from the start: `mortality` (multiplies every death hazard, optionally only between `minAge` and `maxAge`), `repo` (basis points on the rate the MPC sets), `oil` (multiplies the Brent price). |
| `title`, `notes` | For people. |

Running it rebuilds the province on screen and switches to it, paused at its first morning. The province's own
*Scenario & basis* panel shows what it was built on; *File › New › The Province on Screen, as a File* writes the
province you have back out as a province file.

### `*.experiment.json`: a paired experiment

```json
{
  "$schema": "https://intelligentactuaries.com/schemas/community-lab/experiment.json",
  "title": "Is the funeral premium adequate?",
  "question": "How do the society's reserve and its chance of ruin move if the premium is cut or raised by a fifth?",
  "audience": "actuarial",
  "base": { "careQuality": 0.6 },
  "arms": [
    { "id": "premium-down", "label": "Premium −20%", "params": { "funeralPremium": 96 } },
    { "id": "premium-up", "label": "Premium +20%", "params": { "funeralPremium": 144 } }
  ],
  "seeds": 8,
  "years": 10
}
```

Every arm runs on the same seeds as the baseline (`base`, or the defaults without it): common random numbers, so
the difference between an arm and the baseline on one seed is the change's doing, and the spread of those paired
differences over the seeds is what is left. Each of the 21 indicators (deaths per 1,000, A/E, life expectancy,
under-five mortality, admissions, the burial society's reserve, ruin and loss ratio, cover, poverty, Gini,
unemployment, GDP per resident, inflation, household debt and savings, tax, grants, the fiscal balance, incidents)
gets a distribution per arm and a paired effect with a 95% Student-t interval.

Arms can change parameters (`params`), live on their own mortality table (`mortality`), or add shocks (`shocks`);
the base can do the same (`base`, `baseMortality`, `baseShocks`). Up to six arms, 2 to 64 seeds, 1 to 40 years, and
at most 800 province-years in all (seeds × years × runs), about ten minutes on a laptop's worker pool. The toolbar
says what a file will cost before you run it.

Running it puts it on the worker pool (half the machine's cores, at most eight; `COMMUNITY_WORKERS` changes it),
follows its progress in the Console, prints the effects of the indicators it leads with, and keeps the result in
`results/<title>-<date>/`: the runs and the effects as CSV, the whole result as JSON, a README with its
provenance, and the experiment file it was run from. It also opens in the policy and stress lab (*Run › Policy
and Stress Lab*), with every indicator and the forest of effects.

### `*.js`: a script

A script is JavaScript, run as the body of an async function in a worker beside the editor, so `await` works at
the top level and a long run never freezes the IDE. **Stop** (Ctrl+Shift+Enter) ends it, and cancels any job it
started on the pool.

| | |
|---|---|
| `await province({ seed, basis, mortality, shocks })` | A province of the script's own, built in the worker (the province on screen is untouched). `mortality` may name a CSV in the workspace. |
| `p.run({ years })`, `p.run({ days })` | Lives whole days, with the same day-step pipeline as the IDE's province: about three to four seconds a simulated year. |
| `p.date`, `p.years`, `p.basis`, `p.basisHash` | Where it has got to and what it was built on. |
| `p.indicators()` | The lab's 21 indicators for the run so far (`METRICS` says how each is defined). |
| `p.people()` | Residents: id, name, sex, age, city, settlement, tier, household, education, job, income, marital status, health, conditions, heritage, born here. |
| `p.households()` | Households: id, name, city, settlement, tier, members, income, expenses, savings, debt, poor, cover. |
| `p.experience({ ageWidth, group })` | Deaths, person-years and expected deaths by calendar year, age and sex (by city, settlement or tier with `group`), rebuilt person by person, with the true basis's q beside them. |
| `p.events(kind)` | The event ledger: births, deaths, weddings, incidents, the economy, the weather. |
| `p.world` | The engine's own state; read it, do not change it. |
| `await experiment(spec)` | A paired experiment on the worker pool (the format above); `template(id, years)` gives one of the lab's. |
| `await monteCarlo({ basis, seeds, years })` | Seeds of one basis on the pool: every run, percentiles, the probability of the society's ruin, pooled A/E. |
| `await pooledExperience({ basis, seeds, years, ageWidth })` | Experience pooled over seeds, with the true basis it was generated on: enough deaths to fit a period table. |
| `print(...)`, `table(rows, columns)`, `plot({ x, series, title, yLabel, log })` | Output in the Console. |
| `csv(rows, columns)`, `await readFile(path)`, `await writeFile(path, text)` | The workspace's files. |
| `METRICS`, `DEFAULT_BASIS`, `TEMPLATES` | The indicators, the default basis, the lab's experiments. |

The editor completes and checks all of it as you type. An error in a script is reported with its line, in the
Console and in Problems.

### Mortality tables (`*.csv`)

A table to live on is a CSV with an `age` column and the one-year death probabilities by sex (`qx_m` and `qx_f`, or
`m`/`f`, `male`/`female`) or pooled (`qx`). Rates may be probabilities or per mille (say so with `‰` in the header,
or give values above 1). Commas, semicolons and tabs all work. *Exports › Import a mortality table* lives the
province on one directly.

### Everything else

CSV opens as a table (with *Edit as text* beside it), Markdown as a preview (with *Edit as text*), JSON and any
other text in the editor.

## The sample workspace

| | |
|---|---|
| `scenarios/baseline.province.json` | The default province. |
| `scenarios/ageing.province.json` | An older age profile, a TFR of 1.6 and faster mortality improvement. |
| `scenarios/pandemic.province.json` | The default province living through a year of pandemic mortality from its second year. |
| `scenarios/stressed-basis.province.json` | The default province living on `bases/stressed-sa-2024.csv`. |
| `experiments/sam-life-stresses.experiment.json` | SAM's life underwriting stresses on the burial society, lived through: mortality +15% at every age, and a catastrophe month. |
| `experiments/old-age-grant.experiment.json` | A 20% higher older persons grant: what it costs and what it buys. |
| `scripts/first-look.js` | Two simulated years and a look round: the indicators, who lives where, the last births and deaths. |
| `scripts/ae-by-age.js` | A/E by ten-year band over five years, a plot, and the table saved as CSV. |
| `scripts/pooled-experience.js` | Sixteen seeds pooled on the worker pool: crude rates against the basis. |
| `scripts/premium-check.js` | The funeral premium cut and raised by a fifth, on six seeds. |
| `bases/stressed-sa-2024.csv` | The sa-2024 preset, 15% heavier at every age. |

Every file in it is generated from the engine's own templates, presets and defaults, and the test suite checks that
each one runs as written (`tests/workspace.test.ts`).

## Shortcuts

| | |
|---|---|
| Run the file / Stop | Ctrl+Enter / Ctrl+Shift+Enter |
| Save / Save all | Ctrl+S / Ctrl+Shift+S |
| Close the file | Ctrl+W |
| Explorer / Console and Problems | Ctrl+B / Ctrl+J |
| Province / Workbench | Ctrl+1 / Ctrl+2 |
| New province file | Ctrl+N |
| Open a folder | Ctrl+O |

On a Mac, Cmd in place of Ctrl.
