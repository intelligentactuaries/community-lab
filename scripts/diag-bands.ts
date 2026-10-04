// Pooled A/E by age band across seeds: bun scripts/diag-bands.ts <seeds> <years> [prefix]
import { Simulation } from '../src/sim/engine';
import { AGE_BANDS } from '../src/sim/mortality';
const seeds = Number(process.argv[2] ?? 12);
const years = Number(process.argv[3] ?? 30);
const prefix = process.argv[4] ?? 'band';
const acc = AGE_BANDS.map((b) => ({ band: b.band, py: 0, a: 0, e: 0, table: 0 }));
const bySrc = { table: 0, illness: 0, accident: 0, maternal: 0 };
for (let i = 0; i < seeds; i++) {
  const sim = new Simulation({ seed: `${prefix}-${i}` });
  sim.runDays(Math.round(years * 365.25));
  const st = sim.world.stats;
  st.exposures.forEach((r, k) => {
    acc[k].py += r.exposureM + r.exposureF;
    acc[k].a += r.deathsM + r.deathsF;
    acc[k].e += r.expectedM + r.expectedF;
    acc[k].table += st.tableDeathsByBand[r.band] ?? 0;
  });
  for (const k of Object.keys(bySrc) as Array<keyof typeof bySrc>) bySrc[k] += st.deathsBySource[k];
}
let A = 0, E = 0;
for (const r of acc) {
  A += r.a; E += r.e;
  const half = 1.96 * Math.sqrt(Math.max(r.a, 0.5));
  console.log(`${r.band.padEnd(6)} py ${r.py.toFixed(0).padStart(6)}  A ${String(r.a).padStart(4)}  E ${r.e.toFixed(1).padStart(7)}  A/E ${r.e > 0 ? (r.a / r.e).toFixed(2) : '   -'}  table-only ${r.e > 0 ? (r.table / r.e).toFixed(2) : '-'}  [${r.e > 0 ? Math.max(0, (r.a - half) / r.e).toFixed(2) : '-'}, ${r.e > 0 ? ((r.a + half) / r.e).toFixed(2) : '-'}]`);
}
console.log(`ALL    A ${A}  E ${E.toFixed(1)}  A/E ${(A / E).toFixed(3)}  sources`, bySrc);
