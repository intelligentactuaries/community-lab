// Prints the implied e0, IMR, U5MR and e65 for every mortality preset and,
// with --fit, calibrates the single-year presets to their published targets:
//   A  ← infant mortality (q0 = A^(B^C))
//   G  ← e65 (senescent level, hump negligible there)
//   D  ← e0 (the young-adult hump absorbs the remaining gap)
// Run: bun scripts/calibrate.ts [--fit]
import { MORTALITY_PRESETS, buildQxTable, lifeExpectancy, u5mr, singleYearQx, type HPParams, type MortalityPreset } from '../src/sim/mortality';

function table(p: HPParams, form: MortalityPreset['form']): number[] {
  const qx: number[] = [];
  for (let x = 0; x <= 110; x++) qx.push(x === 110 ? 1 : singleYearQx(p, x, form));
  return qx;
}
function summary(p: HPParams, form: MortalityPreset['form']) {
  const qx = table(p, form);
  return { e0: lifeExpectancy(qx), imr: qx[0] * 1000, u5: u5mr(qx), e65: lifeExpectancy(qx, 65), q30: qx[30], q45: qx[45] };
}
function bisect(fn: (v: number) => number, lo: number, hi: number, target: number, log = true): number {
  for (let i = 0; i < 70; i++) {
    const mid = log ? Math.sqrt(lo * hi) : (lo + hi) / 2;
    if (fn(mid) > target) lo = mid;
    else hi = mid;
  }
  return log ? Math.sqrt(lo * hi) : (lo + hi) / 2;
}
function fit(base: HPParams, t: { e0: number; imr: number; e65: number; u5: number }): HPParams {
  const p = { ...base };
  const solveA = () => { p.A = Math.pow(t.imr / 1000, 1 / Math.pow(p.B, p.C)); };
  solveA();
  // C controls how fast child mortality falls after infancy → U5MR (A re-solved each step)
  p.C = bisect((c) => { p.C = c; solveA(); return summary(p, 'single').u5; }, 0.03, 3, t.u5, false);
  solveA();
  p.G = bisect((g) => summary({ ...p, G: g }, 'single').e65, 1e-7, 0.05, t.e65);
  p.D = bisect((d) => summary({ ...p, D: d }, 'single').e0, 1e-6, 0.5, t.e0);
  return p;
}
const doFit = process.argv.includes('--fit');
for (const preset of MORTALITY_PRESETS) {
  const m = summary(preset.male, preset.form);
  const f = summary(preset.female, preset.form);
  const fmt = (s: ReturnType<typeof summary>) => `e0=${s.e0.toFixed(1)} IMR=${s.imr.toFixed(1)} U5=${s.u5.toFixed(1)} e65=${s.e65.toFixed(1)} q30=${(s.q30 * 1000).toFixed(1)}‰ q45=${(s.q45 * 1000).toFixed(1)}‰`;
  console.log(`${preset.id.padEnd(20)} [${preset.form}]\n   M: ${fmt(m)}\n   F: ${fmt(f)}`);
}
if (doFit) {
  const targets: Record<string, { m: { e0: number; imr: number; e65: number; u5: number }; f: { e0: number; imr: number; e65: number; u5: number } }> = {
    'sa-2024': { m: { e0: 63.6, imr: 24.5, e65: 13.0, u5: 30.5 }, f: { e0: 69.2, imr: 21.3, e65: 16.2, u5: 26.6 } },
    'developed-2020': { m: { e0: 79.0, imr: 4.4, e65: 18.5, u5: 5.3 }, f: { e0: 84.0, imr: 3.6, e65: 21.5, u5: 4.4 } },
  };
  for (const preset of MORTALITY_PRESETS) {
    const t = targets[preset.id];
    if (!t) continue;
    const m = fit(preset.male, t.m);
    const f = fit(preset.female, t.f);
    const fmt = (p: HPParams) => `{ A: ${p.A.toPrecision(4)}, B: ${p.B}, C: ${p.C}, D: ${p.D.toPrecision(4)}, E: ${p.E}, F: ${p.F}, G: ${p.G.toPrecision(4)}, H: ${p.H} }`;
    console.log(`\n${preset.id} fitted:\n  male:   ${fmt(m)}\n     →`, summary(m, 'single'), `\n  female: ${fmt(f)}\n     →`, summary(f, 'single'));
  }
}
