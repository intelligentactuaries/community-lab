# Monte Carlo

One province is one draw from its basis. **Monte Carlo** lives the same basis on many seeds and reports what came
out across them: percentiles of every outcome, the burial society's probability of ruin, and deaths and births
against the basis pooled over all the seeds. Open it from the **Monte Carlo** tile, **Run › Monte Carlo**, or
**Monte Carlo…** in the Scenario panel.

## Running it

The card **Replications of this basis** takes **Years** (30 by default, up to 60) and **Seeds** (20 by default, up
to 200). **Run on the server** puts one run per seed on the worker pool, on the seeds `mc-1`, `mc-2` and so on; the
basis is the province's as you have built it, with any table it lives on and its shocks, on those seeds rather than
the province's own. Progress shows as runs done out of the total.

A Monte Carlo run is not limited to 800 province-years as experiments are, so a large one takes a while. A
province-year takes one worker ten seconds or more, so 20 seeds of 30 years (600 province-years) keep eight workers
busy for a quarter of an hour or so, and longer on a machine with fewer cores. There is no cancel button: leave it
to finish.

## What it reports

A table of every outcome across the seeds, with its 5th, 25th, 50th, 75th and 95th percentiles and its mean:
population, births, deaths, A/E, births A/E, TFR, e₀ for men and women, marriages, divorces, emigrants and
immigrants, incidents, arrests, illnesses, hospital admissions, the society's reserve and claims, and the share of
households in poverty at the end. Then:

| Figure | How it is computed |
|---|---|
| **Pooled mortality A/E** | All the seeds' deaths over all their expected deaths |
| **Pooled births A/E** | All the seeds' births over all their expected births |
| **P(scheme ruin within Y years)** | The share of seeds in which the burial society's reserve went below zero |

and histograms of the final population, the A/E and the society's final reserve across the seeds.

**download CSV** saves every seed's run, one row each, with every outcome.

## From a script or a terminal

`monteCarlo({ basis, seeds, years })` in a [script](../workbench/script-api.md#montecarlooptions) runs the same job
and returns the same summary. From a checkout of the source, `bun scripts/batch.ts --seeds 20 --years 30 --out
data/batch.csv` runs it without the app.
