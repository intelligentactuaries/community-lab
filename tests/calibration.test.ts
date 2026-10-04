import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';

// Pooled experience across a few seeds should sit near the basis. Bounds are
// deliberately loose (Poisson noise on a few dozen deaths); the tight
// calibration is done with scripts/diag.ts on hundreds of deaths.
describe('calibration (pooled, 5 seeds × 10 years)', () => {
  let A = 0;
  let E = 0;
  let B = 0;
  let EB = 0;
  for (let i = 0; i < 5; i++) {
    const sim = new Simulation({ seed: `cal-${i}` });
    sim.runDays(3652);
    const st = sim.world.stats;
    A += st.deaths;
    E += st.exposures.reduce((s, r) => s + r.expectedM + r.expectedF, 0);
    B += st.births;
    EB += st.expectedBirths;
  }
  test('mortality A/E is in a plausible band', () => {
    expect(E).toBeGreaterThan(10);
    expect(A / E).toBeGreaterThan(0.4);
    expect(A / E).toBeLessThan(2.0);
  });
  test('births A/E is in a plausible band', () => {
    expect(EB).toBeGreaterThan(10);
    expect(B / EB).toBeGreaterThan(0.5);
    expect(B / EB).toBeLessThan(1.6);
  });
});
