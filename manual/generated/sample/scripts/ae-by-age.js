// Actual against expected deaths by age band, on the basis the province was built on.
// Five simulated years, about twenty seconds. One province is about 400 people, so the
// bands are noisy: scripts/pooled-experience.js pools seeds on the worker pool instead.

const p = await province({ seed: 'ae-by-age' });
p.run({ years: 5 });

const bands = {};
for (const r of p.experience({ ageWidth: 10 })) {
  const b = (bands[r.age] ??= { band: `${r.age}-${r.age + 9}`, person_years: 0, deaths: 0, expected: 0 });
  b.person_years += r.person_years;
  b.deaths += r.deaths;
  b.expected += r.expected_deaths;
}
const rows = Object.values(bands).map((b) => ({ ...b, ae: b.expected > 0 ? b.deaths / b.expected : null }));
table(rows, ['band', 'person_years', 'deaths', 'expected', 'ae']);
plot({ x: rows.map((b) => b.band), series: { 'A/E': rows.map((b) => b.ae) }, title: 'Actual / expected deaths by age band', yLabel: 'A/E' });

const D = rows.reduce((a, b) => a + b.deaths, 0);
const E = rows.reduce((a, b) => a + b.expected, 0);
print(`Pooled A/E ${(D / E).toFixed(3)}: ${D} deaths against ${E.toFixed(1)} expected.`);

await writeFile('results/ae-by-age.csv', csv(rows));
print('Saved results/ae-by-age.csv');
