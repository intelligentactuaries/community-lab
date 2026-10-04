// CLI Monte Carlo: bun scripts/batch.ts --seeds 20 --years 30 [--out data/batch.csv] [--param key=value ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { batchCsv, runBatch } from '../src/sim/batch';
import type { ScenarioParams } from '../src/sim/params';

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const seeds = Number(get('seeds', '10'));
const years = Number(get('years', '30'));
const out = get('out', '');
const overrides: Partial<ScenarioParams> = {};
args.forEach((a, i) => {
  if (a === '--param') {
    const [k, v] = args[i + 1].split('=');
    (overrides as Record<string, unknown>)[k] = Number.isFinite(Number(v)) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
  }
});
const t0 = performance.now();
const summary = runBatch(overrides, years, Array.from({ length: seeds }, (_, i) => `mc-${i + 1}`), (row, i) => {
  process.stdout.write(`seed ${row.seed.padEnd(6)} pop ${String(row.population0).padStart(3)}→${String(row.population).padStart(3)}  b ${String(row.births).padStart(3)}  d ${String(row.deaths).padStart(3)} (E ${row.expectedDeaths.toFixed(1)}, A/E ${row.ae?.toFixed(2) ?? '-'})  births A/E ${row.fertilityAe?.toFixed(2) ?? '-'}  tfr ${row.tfr.toFixed(2)}  mar ${row.marriages}  inc ${row.incidents}  reserve ${row.reserve}  ${row.ruined ? 'RUIN' : ''}  ${row.ms.toFixed(0)}ms\n`);
});
console.log(`\n${seeds} seeds × ${years} years in ${((performance.now() - t0) / 1000).toFixed(1)}s — basis ${summary.basisHash}`);
console.log(`pooled mortality A/E = ${summary.pooledAe?.toFixed(3)}   pooled births A/E = ${summary.pooledFertilityAe?.toFixed(3)}   P(ruin) = ${(summary.ruinProbability * 100).toFixed(0)}%`);
for (const [k, p] of Object.entries(summary.percentiles)) console.log(`${k.padEnd(18)} p5 ${p.p5.toFixed(2).padStart(9)}  p50 ${p.p50.toFixed(2).padStart(9)}  p95 ${p.p95.toFixed(2).padStart(9)}  mean ${p.mean.toFixed(2).padStart(9)}`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, batchCsv(summary));
  writeFileSync(out.replace(/\.csv$/, '') + '.json', JSON.stringify(summary, null, 2));
  console.log(`wrote ${out}`);
}
