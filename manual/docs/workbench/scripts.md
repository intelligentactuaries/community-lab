# Scripts

A script (`*.js`) is JavaScript that runs beside the editor with the engine at hand. It can build provinces of its
own and live them for decades, put experiments and Monte Carlo runs on the worker pool, pool experience over many
seeds, and read and write the workspace's files. Its tables and plots land in the Console.

```js title="scripts/ae-by-age.js"
--8<-- "manual/generated/sample/scripts/ae-by-age.js"
```

## How a script runs

- **In a worker.** A script runs in a worker of its own, beside the editor, so a long run never freezes the IDE.
  The province on screen is untouched: `province()` builds one of the script's own.
- **As an async function.** The file is the body of an async function, so `await` works at the top level, and
  `return` ends it early.
- **Saved first.** **Ctrl+Enter** (or **Run**) saves the file and runs it.
- **Stoppable.** **Stop** (**Ctrl+Shift+Enter**) ends it, and cancels any job it started on the worker pool.

An error is reported with its line, in the Console and in **Problems**.

## What a script can do

| To | Use |
|---|---|
| Build a province and live it | `const p = await province({ seed, basis, mortality, shocks })`, then `p.run({ years })` |
| Read its state | `p.indicators()`, `p.people()`, `p.households()`, `p.events(kind)`, `p.date`, `p.basisHash` |
| Measure its experience | `p.experience({ ageWidth, group })`: deaths, person-years and expected deaths by year, age and sex |
| Compare policies | `await experiment(spec)`, or `await experiment(template('premium-adequacy', 10))` |
| Run many seeds of one basis | `await monteCarlo({ basis, seeds, years })` |
| Pool experience over seeds | `await pooledExperience({ basis, seeds, years, ageWidth })` |
| Show results | `print(...)`, `table(rows)`, `plot({ x, series, title })` |
| Read and write files | `await readFile(path)`, `await writeFile(path, csv(rows))` |

The [Script API](script-api.md) documents every function, its options and what it returns. The editor completes
and checks all of it as you type.

## How long things take

A province lives a simulated year in about three to four seconds in a script's worker; `p.run({ years: 30 })` is a
couple of minutes. Work that needs many seeds belongs on the worker pool, which runs several provinces at once:
`experiment()`, `monteCarlo()` and `pooledExperience()` all go there. An experiment and pooled experience may ask
for at most 800 province-years, as an experiment file may; a Monte Carlo run takes up to 200 seeds of up to 60
years.

## Examples

**The indicators after two years**, as the sample's `first-look.js` begins:

```js
const p = await province({ seed: 'first-look' });
p.run({ years: 2 });
table(METRICS.map((m) => ({ indicator: m.label, value: p.indicators()[m.id] })));
```

**Who lives where:**

```js
const p = await province({});
const people = p.people();
const byCity = {};
for (const r of people) byCity[r.city] = (byCity[r.city] ?? 0) + 1;
table(Object.entries(byCity).map(([city, n]) => ({ city, residents: n })));
```

**A Monte Carlo of the burial society:**

```js
const mc = await monteCarlo({ seeds: 16, years: 10 });
print(`Probability of ruin: ${mc.ruinProbability}`);
```

The [sample workspace](sample.md) has four complete scripts to start from.
