# Experiment files

An experiment file (`*.experiment.json`) asks a question by comparison: a baseline province and up to six
**arms**, each a change to it, all lived on the same seeds. Running it puts the whole job on the worker pool and
keeps the result in the workspace.

```json title="experiments/old-age-grant.experiment.json"
--8<-- "manual/generated/sample/experiments/old-age-grant.experiment.json"
```

## Why paired

Every arm runs on **the same seeds** as the baseline. Because each process in the engine draws from a random-number
stream of its own, an arm and the baseline on one seed share their households, their weather and every draw the
arm's change does not touch: **common random numbers**. So the difference between an arm and the baseline on one
seed is the change's doing, and the spread of those paired differences over the seeds is what is left of chance.
A paired comparison needs far fewer seeds than comparing two independent sets of runs would.

## Fields

| Field | What it is |
|---|---|
| `title`, `question` | What the experiment is and the question it answers, in your words. Both travel with the result. |
| `audience` | `actuarial`, `government` or `social`: which of the lab's audiences it is written for. |
| `base` | The [basis parameters](../reference/basis.md) every run starts from. Without it, the defaults. |
| `baseMortality`, `baseShocks` | A [mortality table](mortality-tables.md) and [shocks](province-files.md#shocks) for the baseline and every arm. |
| `arms` | One to six arms. Each has an `id` (lower-case words joined by hyphens, unique, not `baseline`), a `label`, and at least one of `params` (basis parameters on top of `base`), `mortality` (a table of its own) and `shocks` (shocks of its own): an arm that changes nothing is refused. |
| `seeds` | How many seeds every run lives on: 2 to 64. |
| `years` | How long each run lives: 1 to 40 years. |
| `notes` | For people. |

## What it costs

A job may ask for at most **800 province-years**: seeds × years × runs per seed, where the runs are the baseline and
every arm. The sample's grant experiment (8 seeds, 10 years, one arm) is 160 province-years. The toolbar above the
editor says what a file will cost before you run it ("4 runs × 10 years · 320 province-years · about 7 min", for
instance), and a file over the limit is refused with the reason in **Problems**.

The worker pool runs one province per worker at a time, on half the machine's threads and at most eight (the
`COMMUNITY_WORKERS` environment variable changes that). The estimate assumes eight workers and about ten seconds a
province-year, so on a smaller machine a job takes longer than it says.

## Running it

**Ctrl+Enter** (or **Run**) saves the file and starts the job; the experiment also opens in the
[policy and stress lab](../analytics/lab.md), following the same job. The Console shows the progress, then a table
of the effects on the indicators the experiment leads with: for each arm and indicator, the baseline, the effect
and its 95% interval. **Stop** (**Ctrl+Shift+Enter**) cancels the job: queued runs are dropped, and running workers
stop at the end of the simulated day they are on. **Open in the lab** shows a file in the lab without running it.

Every arm runs on the seeds `exp-1`, `exp-2` and so on, never on a province file's own seed. For each indicator and
arm, the result holds:

- its **distribution** over the seeds (mean, standard deviation, 5th, 50th and 95th percentiles);
- a **paired effect**: the mean of the seed-by-seed differences from the baseline, with a **95% Student-t
  interval** (mean ± t × sd ÷ √n, on n − 1 degrees of freedom);
- **better in k of n**: the number of seeds in which the arm moved the indicator in its better direction (ties do
  not count).

An interval that crosses zero is an effect these seeds cannot tell from the province's own randomness; more seeds
narrow every interval. The [indicators](../reference/indicators.md) page defines all 21 and their better directions.

## Where the result goes

A run from a file saves its result into the workspace by itself, in `results/<title>-<date>/` (with " 2", " 3" and
so on if that folder exists):

| File | What it holds |
|---|---|
| `unity_experiment_runs.csv` | Every run: one row per seed and arm, with all 21 indicators. |
| `unity_experiment_effects.csv` | Every effect: arm, indicator, baseline mean, effect, the 95% interval, seeds and the share of seeds better. |
| `result.json` | The whole result, distributions included. |
| `README.md` | What was run, on what, and when: the provenance, and the file it was run from. |
| `<title>.experiment.json` | The experiment as it was run, so it can be run again. |

## Starting from a template

The lab's ready-made experiments are [templates](../reference/templates.md). **File › New › Experiment File** writes
`experiments/untitled.experiment.json` from the first of them, on 8 seeds and 10 years, and a script can build any of
them with `template(id, years)`.
