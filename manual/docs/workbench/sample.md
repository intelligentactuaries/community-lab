# The sample workspace

**Create the sample workspace**, on the workbench's welcome screen (**File › New Workspace** brings it up), writes a
sample into a new folder, `Community Lab` in your Documents folder unless you choose another place: four provinces,
two experiments, four scripts and a mortality table, every one of them runnable as it stands. Every file is
generated from the engine's own templates, presets and defaults, so the sample cannot describe a parameter, a
template or a table the engine does not have, and the test suite checks every province and experiment file against
the engine and compiles every script.

| File | What it is |
|---|---|
| `README.md` | What is in the workspace and how to run it. |
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

The files follow, exactly as the sample writes them.

## The provinces

=== "baseline"

    ```json title="scenarios/baseline.province.json"
    --8<-- "manual/generated/sample/scenarios/baseline.province.json"
    ```

=== "ageing"

    ```json title="scenarios/ageing.province.json"
    --8<-- "manual/generated/sample/scenarios/ageing.province.json"
    ```

=== "pandemic"

    ```json title="scenarios/pandemic.province.json"
    --8<-- "manual/generated/sample/scenarios/pandemic.province.json"
    ```

=== "stressed-basis"

    ```json title="scenarios/stressed-basis.province.json"
    --8<-- "manual/generated/sample/scenarios/stressed-basis.province.json"
    ```

See [Province files](province-files.md) for every field.

## The experiments

=== "sam-life-stresses"

    ```json title="experiments/sam-life-stresses.experiment.json"
    --8<-- "manual/generated/sample/experiments/sam-life-stresses.experiment.json"
    ```

=== "old-age-grant"

    ```json title="experiments/old-age-grant.experiment.json"
    --8<-- "manual/generated/sample/experiments/old-age-grant.experiment.json"
    ```

See [Experiment files](experiment-files.md) for every field and how the result is read.

## The scripts

=== "first-look.js"

    ```js title="scripts/first-look.js"
    --8<-- "manual/generated/sample/scripts/first-look.js"
    ```

=== "ae-by-age.js"

    ```js title="scripts/ae-by-age.js"
    --8<-- "manual/generated/sample/scripts/ae-by-age.js"
    ```

=== "pooled-experience.js"

    ```js title="scripts/pooled-experience.js"
    --8<-- "manual/generated/sample/scripts/pooled-experience.js"
    ```

=== "premium-check.js"

    ```js title="scripts/premium-check.js"
    --8<-- "manual/generated/sample/scripts/premium-check.js"
    ```

See the [Script API](script-api.md) for every function they use.

## The mortality table

`bases/stressed-sa-2024.csv` is the `sa-2024` preset with every q multiplied by 1.15, by single age and sex. Its
first rows:

```text title="bases/stressed-sa-2024.csv"
--8<-- "manual/generated/sample/bases/stressed-sa-2024.csv:1:8"
```

See [Mortality tables](mortality-tables.md) for the format.
