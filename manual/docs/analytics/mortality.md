# Mortality and experience

The **Mortality A/E** tile opens the experience analysis an actuary would run on a real portfolio: deaths against
the deaths expected on the basis, by age band and sex, with intervals, beside the survival curves and the table
itself.

## How exposure and expected deaths are counted

Every day, for every resident, the engine adds a day of **exposure** to their age band and sex, and adds the
basis's **expected deaths** for that day: the table's q at their age, with mortality improvement to date, turned
into a daily hazard,

```text
p(day) = 1 − (1 − qₓ)^(1/365.25)
```

with the first year of life front-loaded so that about 55% of infant deaths fall in the first 28 days. Expected
deaths carry **no individual risk**: they are what the table says for a person of that age and sex. Actual deaths
are the deaths that happened, from every cause.

**A/E** is actual over expected. Above 1, the province dies faster than its basis; below 1, slower.

## The cards

**Actual vs expected deaths.** A/E for everyone, for men and for women, each with its 95% interval, against a line
at 1. The full card adds the table by age band (0, 1-4, 5-14, 15-24, …, 75-84, 85+) and sex: exposure in
person-years, actual, expected, A/E and its interval.

**A/E by age band (both sexes).** One bar a band, against 1. A band with no expected deaths yet has no ratio.

**Survival curve l(x)/1000: basis vs experience-adjusted.** The basis table's survival curve for each sex and,
once a sex has three deaths or more, the curve with that sex's q multiplied by its A/E.

**Basis qx (log scale).** The table the province lives on, per mille, by sex.

**Deaths by cause** and **Deaths by age band.** What the province has died of, and at what ages.

## The interval

The 95% interval on an A/E is computed as

```text
(A ± 1.96 √A) / E
```

floored at zero: the normal approximation to a Poisson count of deaths. It is a fair guide once there are a few
dozen deaths and a rough one below that; with fewer than about ten deaths, read the interval as "wide". When
expected deaths are below 0.1, no ratio is shown.

## Reading it honestly

- **One province is small.** Four hundred people give three or four deaths a year. A/E from one province over a
  few years moves a long way by chance, which is what the interval says.
- **Pool before you fit.** To measure the province's mortality properly, pool seeds:
  [`pooledExperience()`](../workbench/script-api.md#pooledexperienceoptions) in a script, or **Exports › Mortality
  experience › Pool on the worker pool**, or a [Monte Carlo](monte-carlo.md) run.
- **The province need not die on its basis.** The basis is what the table says; the province's deaths come from
  its people's own risks and its illness episodes. On the current version the province's pooled A/E on the default
  basis is below 1, most of all at older ages: see [Calibration and limits](../model/calibration.md) for the
  measured figures.

## Fertility, the same way

Births are measured against the fertility basis the same way: every woman's day of exposure adds her age-specific
rate to the expected births, and the **Fertility** tile's *births A/E* is births over expected births. See
[Fertility](population.md#fertility).
