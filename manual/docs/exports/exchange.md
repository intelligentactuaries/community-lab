# The exchange format

Every export, and every experiment result, is a JSON document in the **`scelo.exchange/1`** layout: plain tables
with a data dictionary, the provenance, and (where there is one) the true basis. It is the same layout Scelo IDE
reads, so Community Lab's data opens there as it is, and it is simple enough to read in anything else.

## An export

```json
{
  "schema": "scelo.exchange/1",
  "kind": "community.export",
  "id": "experience-…",
  "exportKind": "experience",
  "title": "Unity Province · mortality experience",
  "summary": "Deaths and person-years by calendar year, …",
  "provenance": { … },
  "tables": [
    {
      "name": "unity_mortality_experience",
      "title": "Mortality experience",
      "description": "One row per calendar year × age × sex cell with exposure.",
      "columns": [ { "name": "person_years", "description": "Central exposure: …", "unit": "years" }, … ],
      "rows": [ { "year": 2026, "age": 40, "age_width": 5, "sex": "M", "person_years": 81.4, … }, … ]
    }
  ],
  "truth": { … },
  "headline": [ { "label": "A/E on the true basis", "value": "0.874 (95% 0.80–0.95)" }, … ]
}
```

| Field | What it is |
|---|---|
| `schema`, `kind` | Always `scelo.exchange/1` and `community.export`. |
| `exportKind` | `experience`, `person-years`, `model-points`, `macro` or `experiment`. |
| `title`, `summary` | What it is, in words, including how to use it. |
| `tables` | One or more tables, each with a `name`, `title`, `description`, `columns` (each with a `name`, a `description` and, where it has one, a `unit`) and `rows` (objects keyed by column name). |
| `provenance` | Where it came from (below). |
| `truth` | The true basis, for experience and person-year exports (below). |
| `headline` | A few figures in words, for a person reading it. |

## Provenance

| Field | What it is |
|---|---|
| `app`, `appVersion`, `createdAt` | `community-lab`, the version, and when the export was made. |
| `span` | The simulated dates the data covers. |
| `seed` or `seeds` | The seed of the province on screen, or how many seeds a pooled export or experiment ran. |
| `basisHash` | The fingerprint of the whole basis, seed included. |
| `assumptionsHash` | The fingerprint of the assumptions alone: every seed of one basis shares it, so runs that may be pooled can be told apart from runs that may not. |
| `scenario` | What it was, in words. |
| `changed` | Every parameter that differed from the defaults, a supplied table (its label and source) and any shocks. |
| `notes` | Anything else worth knowing: the seeds pooled, parameters that were left out. |

## The true basis

The `truth` of an experience or person-year export is the basis the province was generated on, the answer key for
anything fitted to the data:

| Field | What it is |
|---|---|
| `label`, `source` | The table's name and where it comes from. |
| `baseYear`, `improvement` | The year the table describes and the annual improvement applied to it. |
| `qx` | `ages` (0 to 110), and q by single age for men (`M`) and women (`F`). |
| `individualRisk` | In words, how one person's risk is spread around the basis: the poverty, bereavement, chronic-condition and vitality multipliers, and the illness episodes that supply part of each age's deaths. |

The province does not die on its basis exactly: its deaths come from its people's own risks and its illness
episodes, and the basis is the expected side of A/E. Measuring that gap is the point of exporting the truth.

## An experiment result

An experiment's result is `kind: "community.experiment"`: the `spec` it was run from, the indicators' definitions
(`metrics`), the `arms` (the baseline first) with each indicator's distribution over the seeds (`mean`, `sd`, `p5`,
`p50`, `p95`, `n`) and paired effect (`mean`, `lo`, `hi`, `n`, `better`), the `rows` of every run, the provenance and
the time it took. Exported as tables, it is `unity_experiment_runs` (one row per seed and arm, with every indicator)
and `unity_experiment_effects` (one row per arm and indicator: the baseline mean, the effect, its interval, the seeds
and the share of them better).

## Reading it elsewhere

=== "R"

    ```r
    library(jsonlite)
    x <- fromJSON("export.json")
    experience <- x$tables$rows[[1]]
    sum(experience$deaths) / sum(experience$expected_deaths)   # A/E on the true basis
    ```

=== "Python"

    ```python
    import json, pandas as pd
    x = json.load(open("export.json"))
    experience = pd.DataFrame(x["tables"][0]["rows"])
    experience.deaths.sum() / experience.expected_deaths.sum()   # A/E on the true basis
    ```

=== "A spreadsheet"

    Save the export to the workspace and open the table's CSV; the folder's `README.md` is its data dictionary.
