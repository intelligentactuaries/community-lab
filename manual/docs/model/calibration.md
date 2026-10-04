# Calibration and limits

What the province can be read for, what it cannot, and how close it comes to its own basis. Every figure on this
page was measured on Community Lab IDE 0.1.0 on 4 October 2026, and the last section shows how to measure it
yourself.

## How the province's deaths are made

The province's residents die through three channels: the **table** (the basis's q, applied to each person with
their own risk factors, normalised within each age band so that the factors move risk between people without
changing the band's level), **illness episodes** (heart attacks, strokes, pneumonia, cancer, falls and the rest,
each with its own case fatality, care and referral), and **accidents, violence and childbirth**. The table channel
applies only a share of the basis at each age, falling from 90% in adulthood to 45% at 85 and over, to leave room
for the illness deaths, which rise with age as real cause-of-death mixes do. Together they are meant to make the
province die on its basis in expectation: a pooled A/E of 1, flat by age.

## What it does today

On the default basis, pooled over many seeds, the province dies on its basis below middle age and **more slowly than
its basis from middle age on**:

| Pooled run | Person-years | Deaths | Expected | A/E (95%) | Men | Women |
|---|---|---|---|---|---|---|
| 24 seeds × 20 years | 192,091 | 1,661 | 1,944.3 | **0.854** (0.81–0.90) | 0.837 | 0.875 |
| 16 seeds × 30 years | 192,869 | 1,787 | 2,130.8 | **0.839** (0.80–0.88) | 0.869 | 0.808 |

By age, over the 16 seeds of 30 years:

| Age | 0–14 | 15–34 | 35–44 | 45–54 | 55–64 | 65–74 | 75–84 | 85+ |
|---|---|---|---|---|---|---|---|---|
| A/E | 1.20 | 1.06 | 0.99 | 0.88 | 0.89 | 0.85 | 0.67 | 0.70 |
| 95% interval | 0.96–1.45 | 0.90–1.23 | 0.84–1.13 | 0.76–1.00 | 0.79–0.99 | 0.76–0.94 | 0.59–0.74 | 0.60–0.79 |

And by period: 0.86 in years 1 to 5, 0.89 in years 6 to 10, 0.86 in years 11 to 20 and 0.80 in years 21 to 30. The
shortfall is not a start-up effect that wears off.

The calibration recorded in [Assumptions and provenance](assumptions.md) (a pooled A/E of 1.00, flat from 35 to 85+)
was made on an earlier engine, when the community was a single village of about fifty people. The province is about
eight times larger and has grown new institutions since (the central hospital and its referrals among them), and its
calibration has not been redone.
Until it is, **read the province's mortality as running about 15% below its basis overall, and about a third below it
from 75**.

## What that means for your work

- **A/E below 1 is expected.** An A/E of 0.85 in a run of yours is the province, not an error in your analysis.
  Compare runs **with each other**, as the [lab](../analytics/lab.md) does, rather than with 1.
- **The exported truth is the basis.** Experience exports carry the basis the province was generated on, as the answer
  key for a fitted table. A table fitted to the province's experience will sit below that basis at older ages, and
  scoring it against the truth will show it; that gap is the province's, not the model's.
- **Experience-adjusted life expectancy** is above the basis's, because experience runs below it.
- **The burial society** is priced in the actuarial workbench on the basis, while its claims follow the province's
  experience; so its claims come in below its pure premium, and its surplus grows faster than the basis implies.

## What else to keep in mind

- **A small province.** About four hundred people give three or four deaths a year. One province's experience over a
  few years moves a long way by chance, and most of its cells are empty. Pool seeds before fitting a model: Monte
  Carlo, pooled exports, or `pooledExperience()` in a script.
- **Synthetic intervals.** The intervals measure the simulation's own randomness, not doubt about its assumptions.
  The A/E intervals are the normal approximation, (A ± 1.96√A)/E: rough when deaths are few.
- **Proxies.** Many rates are reasoned placeholders awaiting a better source, and say so in
  [Assumptions and provenance](assumptions.md). The engine treats them as it treats a published number, so they can be
  replaced without code changes.
- **Road deaths are traffic.** A supplied mortality table and mortality shocks scale every death channel except road
  accidents.
- **Covariates as at exit.** The person-year panel describes each person as they were at the end of observation (or
  at death or departure): the engine keeps no history of a job or an income.
- **The economy moves on its own.** Rates, prices and fares come from the model. A rate or an oil shock sits on top of
  the path the economy would have taken; it does not replace it.
- **Some outputs are descriptive.** The actuarial workbench describes IFRS 17's liabilities rather than computing them,
  and values the old-age grant for everyone of pensionable age, not only those who would qualify.

## Measuring it yourself

The figures above are two pooled exports on the worker pool, on the seeds `pool-1`, `pool-2` and so on. A script
reproduces them:

```js title="scripts/calibration-check.js"
// Pooled A/E on the default basis, by age: 16 seeds × 30 years on the worker pool.
const x = await pooledExperience({ seeds: 16, years: 30, ageWidth: 5 });
const bandOf = (age) =>
  age < 15 ? '0-14' : age < 35 ? '15-34' : age >= 85 ? '85+' : `${35 + 10 * Math.floor((age - 35) / 10)}-${44 + 10 * Math.floor((age - 35) / 10)}`;
const bands = {};
for (const r of x.rows) {
  const b = (bands[bandOf(r.age)] ??= { band: bandOf(r.age), deaths: 0, expected: 0 });
  b.deaths += r.deaths;
  b.expected += r.expected_deaths;
}
table(Object.values(bands).map((b) => ({ ...b, ae: b.deaths / b.expected })));
print(x.headline.map((h) => `${h.label}: ${h.value}`).join(' · '));
```

It takes about a quarter of an hour on an eight-worker machine. From a checkout of the source, two diagnostic scripts
run the same checks without the app: `bun scripts/diag.ts 24 20 x` (overall) and `bun scripts/diag-bands.ts 16 30 x`
(by band). Both accept the environment variables `COMMUNITY_MORT_NORM` (the table share's normaliser, 0.9) and
`COMMUNITY_ILLNESS_SCALE` (the illness episodes' case fatality scale, 0.78), for trying a recalibration; they reach
the engine's worker runs, not the province on screen.
