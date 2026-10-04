# Province files

A province file (`*.province.json`) is a scenario you can keep: a seed, the basis, and optionally a mortality table
to live on and timed shocks. Running it rebuilds the province on screen on it.

```json title="scenarios/pandemic.province.json"
--8<-- "manual/generated/sample/scenarios/pandemic.province.json"
```

## Fields

| Field | What it is |
|---|---|
| `seed` | The province's seed. The same seed and basis give the same province: the households, the weather and every draw the basis does not change. Without one, the default seed, `"agincourt-12"`. |
| `basis` | The [basis parameters](../reference/basis.md) that differ from the defaults: whatever the file does not name takes its default. `{}` is the default province. |
| `mortality` | Optional. A [mortality table](mortality-tables.md) to live on instead of the preset: the path of a CSV in the workspace, or a table inline. |
| `shocks` | Optional. Timed shocks, below. |
| `title`, `notes` | For people. |
| `$schema` | Tells the editor which schema to check the file against. The **+** menu and the sample write it for you. |

A province file says everything about the province it builds: running the same file always builds the same
province, whatever was on screen before.

The editor completes every field and every parameter as you type, shows each parameter's meaning, range and default
on hover, and marks a wrong value before anything runs. When you run it, a file that is not valid JSON, or has a
field of the wrong kind, is not run, and the reasons are listed in **Problems**. A basis value the engine does not
take (an unknown name, a value outside its range) is left out with a warning, and the rest of the file is applied.

## Shocks

A shock changes something for a span of months, counted from the start of the simulation (month 0 is the first).
A file may carry up to twelve.

| `kind` | Fields | Effect |
|---|---|---|
| `mortality` | `factor` (0 to 20), optional `minAge`, `maxAge` | Multiplies every death hazard in the window, at the ages given (every age without them). Shocks that overlap multiply. |
| `repo` | `bp` (−2,000 to 2,000) | Adds basis points to the repo rate the Monetary Policy Committee sets, for the window. The committee's own decisions are unchanged: the shock sits on top. |
| `oil` | `factor` (above 0, at most 10) | Multiplies the Brent price over the path it would otherwise have taken. |

Every shock also has `fromMonth` and `months`, and may have a `label`, which is what the event ledger shows when it
starts and lifts.

```json
"shocks": [
  { "kind": "repo", "label": "Rate stress +300 bp", "fromMonth": 12, "months": 24, "bp": 300 },
  { "kind": "oil", "label": "Oil shock ×1.8", "fromMonth": 6, "months": 12, "factor": 1.8 }
]
```

A supplied mortality table and mortality shocks scale every death channel (the table, illness episodes, maternal
deaths) except road accidents, which are a traffic process.

## Running it

**Ctrl+Enter** (or **Run**) saves the file, rebuilds the province on it and switches to the province view, paused at
its first morning. The Console says what it was built on (the seed, the parameters changed, the table, the shocks,
the basis hash and the residents on the first day), and the province's own *Scenario & basis* panel shows it too.

To go the other way, **File › New › The Province on Screen, as a File** (or the **+** menu in the explorer) writes
the province you have built in the panel out as a province file.
