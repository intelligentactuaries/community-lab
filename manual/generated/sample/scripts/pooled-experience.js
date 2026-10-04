// Experience pooled over seeds: the same basis lived 16 times on the worker pool,
// enough deaths for a period table. About three minutes with eight workers.

const exp = await pooledExperience({ seeds: 16, years: 10, ageWidth: 5 });
print(exp.headline.map((h) => `${h.label}: ${h.value}`).join(' · '));

// Crude central rates against the true basis, men, by five-year band
const cells = {};
for (const r of exp.rows.filter((r) => r.sex === 'M')) {
  const c = (cells[r.age] ??= { age: r.age, deaths: 0, person_years: 0, expected: 0 });
  c.deaths += r.deaths;
  c.person_years += r.person_years;
  c.expected += r.expected_deaths;
}
const rows = Object.values(cells).filter((c) => c.person_years > 0).map((c) => ({
  age: c.age,
  m_actual: c.deaths / c.person_years,
  m_basis: c.expected / c.person_years,
  deaths: c.deaths,
}));
plot({ x: rows.map((r) => r.age), series: { experience: rows.map((r) => r.m_actual || null), basis: rows.map((r) => r.m_basis) }, title: 'Men: crude death rates against the basis', yLabel: 'deaths per person-year', log: true });
await writeFile('results/pooled-experience.csv', csv(exp.rows));
print(`Saved ${exp.rows.length} cells to results/pooled-experience.csv, with the true basis in the export's provenance.`);
