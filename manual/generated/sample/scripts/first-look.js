// A first look: build the province, live two years, and read it.
// Run it with Ctrl+Enter (Cmd+Enter on a Mac). Two simulated years take about ten seconds.

const p = await province({ seed: 'first-look' });
print(`${p.basis.regionName} Province on ${p.date}: ${p.people().length} residents in ${p.households().length} households. Basis ${p.basisHash}.`);

p.run({ years: 2 });
print(`Two years on, ${p.date}:`);

const ind = p.indicators();
const show = ['population', 'deaths_per_1000', 'ae', 'e0', 'scheme_reserve', 'poverty', 'unemployment', 'gini'];
table(METRICS.filter((m) => show.includes(m.id)).map((m) => ({ indicator: m.label, value: ind[m.id], unit: m.unit })));

// Who lives where
const byCity = {};
for (const person of p.people()) byCity[person.city] = (byCity[person.city] ?? 0) + 1;
table(Object.entries(byCity).map(([city, residents]) => ({ city, residents })));

// What happened: the last few births and deaths in the ledger
table(p.events().filter((e) => e.kind === 'birth' || e.kind === 'death').slice(-8));
