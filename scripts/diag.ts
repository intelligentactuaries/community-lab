// Pooled experience diagnostics: bun scripts/diag.ts <seeds> <years> [prefix]
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
const seeds = Number(process.argv[2] ?? 10);
const years = Number(process.argv[3] ?? 20);
const prefix = process.argv[4] ?? 'diag';
let A = 0, E = 0, B = 0, EB = 0, py = 0, age0 = 0, pop0 = 0;
const src = { table: 0, illness: 0, accident: 0, maternal: 0 };
const perSeed: string[] = [];
for (let i = 0; i < seeds; i++) {
  const sim = new Simulation({ seed: `${prefix}-${i}` });
  const p0 = alivePeople(sim.world);
  pop0 += p0.length;
  age0 += p0.reduce((s, p) => s + p.age, 0);
  sim.runDays(Math.round(years * 365.25));
  const st = sim.world.stats;
  const e = st.exposures.reduce((s, r) => s + r.expectedM + r.expectedF, 0);
  A += st.deaths; E += e; B += st.births; EB += st.expectedBirths;
  py += st.exposures.reduce((s, r) => s + r.exposureM + r.exposureF, 0);
  for (const k of Object.keys(src) as Array<keyof typeof src>) src[k] += st.deathsBySource[k];
  perSeed.push(`${(st.deaths / e).toFixed(2)}`);
}
console.log({ prefix, seeds, years, meanAge0: (age0 / pop0).toFixed(1), personYears: py.toFixed(0), deaths: A, expected: E.toFixed(1), ae: (A / E).toFixed(3), hazardPerPy: ((E / py) * 1000).toFixed(2) + '‰', bySource: src, tableAe: (src.table / E).toFixed(3), illnessShare: (src.illness / A).toFixed(2), births: B, expectedBirths: EB.toFixed(1), birthsAe: (B / EB).toFixed(3) });
console.log('per-seed A/E:', perSeed.join(' '));
