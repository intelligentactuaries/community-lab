# A Community Lab workspace

This folder is a project for Community Lab IDE. Everything in it is an ordinary
file: version it with git, share it, edit it in any editor.

| File | What running it does (Ctrl+Enter, or the Run button) |
|---|---|
| `*.province.json` | Rebuilds the province on it: a seed, the basis (only what differs from the defaults), and optionally a mortality table and timed shocks. |
| `*.experiment.json` | Runs a paired experiment on the worker pool: the baseline and each arm on the same seeds, effects with 95% intervals. The result is saved beside it under `results/`. |
| `*.js` | Runs a script beside the editor, with the engine and the worker pool at hand. Its output lands in the Console. |

Anything else (CSV, Markdown, JSON) opens as text.

## What is here

- `scenarios/`: the default province, an ageing one, and one that lives through a pandemic year.
- `experiments/`: the SAM life stresses on the burial society, and a higher old-age grant.
- `scripts/`: a first look at the province, A/E by age band, pooled experience over many seeds, and the funeral premium tested on the worker pool.
- `bases/stressed-sa-2024.csv`: a mortality table (the sa-2024 preset, 15% heavier at every age) for a province to live on. `scenarios/stressed-basis.province.json` uses it.

## The script API

A script is JavaScript, run as the body of an async function, so `await` works at the top level.

| | |
|---|---|
| `await province({ seed, basis, mortality, shocks })` | A province of its own, built in the script's worker. `mortality` may name a CSV in this workspace. |
| `p.run({ years })` / `p.run({ days })` | Lives whole days, as the IDE's province does (about four seconds a simulated year). |
| `p.date`, `p.years`, `p.basis`, `p.basisHash` | Where it has got to, and what it was built on. |
| `p.indicators()` | The lab's indicators (deaths per 1,000, A/E, e0, the society's reserve, poverty, Gini, ...): `METRICS` says how each is defined. |
| `p.people()`, `p.households()` | The residents and households as plain rows. |
| `p.experience({ ageWidth })` | Deaths, person-years and expected deaths by year, age and sex, on the true basis. |
| `p.events(kind?)` | The event ledger: births, deaths, weddings, incidents, the economy. |
| `p.world` | The engine's own state, read-only by convention. |
| `await experiment(spec)` | A paired experiment on the worker pool. `template(id, years)` gives one of the lab's. |
| `await monteCarlo({ basis, seeds, years })` | Seeds of one basis on the worker pool: percentiles, the probability of ruin, pooled A/E. |
| `await pooledExperience({ basis, seeds, years, ageWidth })` | Experience pooled over seeds, for a period table with enough deaths to fit. |
| `print(...)`, `table(rows)`, `plot({ x, series })` | Output in the Console. |
| `await readFile(path)`, `await writeFile(path, text)`, `csv(rows)` | This workspace's files. |

Every province and every run carries its basis hash: the same seed and the same basis give the same province, on any machine.
