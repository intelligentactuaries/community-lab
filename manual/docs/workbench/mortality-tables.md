# Mortality tables

The province lives on a mortality preset unless you give it a table of your own. A supplied table becomes the
basis: the province dies on it, and A/E is measured against it.

## The CSV format

A table is a CSV with an `age` column and one-year death probabilities:

- by sex, as `qx_m` and `qx_f` (or `m` and `f`, or `male` and `female`); or
- pooled, as `qx`.

Rates may be probabilities (0.0124) or per mille (12.4): say so with `‰` in the header, or give values above 1.
Commas, semicolons and tabs all work as separators.

```text title="bases/stressed-sa-2024.csv"
--8<-- "manual/generated/sample/bases/stressed-sa-2024.csv:1:6"
...
```

## Living on one

There are three ways:

- in a [province file](province-files.md): `"mortality": "bases/your-table.csv"`, a path in the workspace;
- in an [experiment file](experiment-files.md): `baseMortality` for every run, or `mortality` for one arm (as a
  table inline);
- from the province view: **Exports › Import a mortality table (CSV)** lives the province on one directly.

A table can also be written inline, in JSON:

```json
"mortality": {
  "label": "My table",
  "source": "Where it comes from",
  "ages": [0, 1, 2, 3],
  "qx": { "M": [0.0283, 0.0019, 0.0003, 0.0002], "F": [0.0245, 0.0040, 0.0010, 0.0004] }
}
```

`qx` is `{ "M": [...], "F": [...] }` by sex or `{ "pooled": [...] }`, one value per age in `ages` (2 to 131 ages).
An optional `year` says which calendar year the table is stated for.

## What the engine does with it

- **Every age is filled.** Between the ages a table gives, q is interpolated log-linearly; beyond them, the
  preset's shape is scaled to meet the table at its nearest age.
- **A pooled table keeps a sex differential**: the preset's ratio between men and women is kept around it.
- **A table stated for another year** is carried to the start of the run with the basis's mortality improvement.
- **Every death channel follows it.** The table is read directly by the table channel; illness and maternal
  deaths, which are calibrated against the preset, are scaled age by age by the ratio of the forces of mortality,
  ln(1 − q<sub>table</sub>) / ln(1 − q<sub>preset</sub>), so total deaths follow the table in expectation. Road
  deaths are a traffic process and are not scaled.
- **It is part of the basis.** The table is hashed into the basis like any parameter, so every export says which
  table a run lived on.

Checked on twelve seeds over four years: tables at 1.3 and 0.75 times the preset moved deaths by 1.25 and 0.78
times, and A/E against each run's own table matched the baseline's against the preset within its standard error
(see [Assumptions and provenance](../model/assumptions.md)).
