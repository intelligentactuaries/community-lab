// The duvet draped over a bed's sleepers: a height field over their bodies' capsules.
import { describe, expect, test } from 'bun:test';
import { drape, type Capsule } from '../src/client/render3d/duvet';

const NX = 12;
const NZ = 20;
const W = NX + 1;
const H = NZ + 1;
const at = (out: Float32Array, i: number, j: number) => out[i * W + j];

describe('the duvet drapes over the bodies beneath it', () => {
  test('with nobody under it, it lies flat at its own thickness', () => {
    const out = new Float32Array(W * H);
    drape(NX, NZ, 1.6, 1.5, 0.08, 0.035, [], out);
    for (const v of out) expect(v).toBeCloseTo(0.08, 6);
  });

  test('a body lifts it to the body’s top plus the cloth, and never lets it sink into the body', () => {
    // A trunk lying along the bed, 12 cm thick, its axis 12 cm above the mattress.
    const trunk: Capsule = { ax: 0, ay: 0.12, az: -0.3, bx: 0, by: 0.12, bz: 0.4, r: 0.12 };
    const out = new Float32Array(W * H);
    drape(NX, NZ, 1.6, 1.5, 0.08, 0.035, [trunk], out);
    // Over the axis: the top of the capsule plus the cloth.
    expect(at(out, 10, 6)).toBeGreaterThanOrEqual(0.12 + 0.12 + 0.035 - 1e-9);
    // At the edge of the bed, far from the body: flat.
    expect(at(out, 10, 0)).toBeCloseTo(0.08, 6);
    // Everywhere the surface clears the capsule.
    for (let i = 0; i < H; i++) {
      for (let j = 0; j < W; j++) {
        const x = -0.8 + (1.6 * j) / NX;
        const z = -0.75 + (1.5 * i) / NZ;
        const t = Math.max(0, Math.min(1, (z + 0.3) / 0.7));
        const d2 = x * x + (z - (-0.3 + 0.7 * t)) ** 2;
        if (d2 < 0.12 * 0.12) expect(at(out, i, j)).toBeGreaterThanOrEqual(0.12 + Math.sqrt(0.0144 - d2) - 1e-9);
      }
    }
  });

  test('it spans a narrow gap between two legs rather than dipping into it, and stays smooth', () => {
    const legs: Capsule[] = [
      { ax: -0.09, ay: 0.07, az: 0.2, bx: -0.09, by: 0.07, bz: 0.7, r: 0.07 },
      { ax: 0.09, ay: 0.07, az: 0.2, bx: 0.09, by: 0.07, bz: 0.7, r: 0.07 },
    ];
    const out = new Float32Array(W * H);
    drape(NX, NZ, 1.6, 1.5, 0.08, 0.035, legs, out);
    const row = 16; // z ≈ 0.45, across the legs
    const over = at(out, row, 6); // x ≈ 0
    const onLeg = Math.max(at(out, row, 5), at(out, row, 7));
    // Between the legs the cloth hangs at most a little below the tops of the legs, not down to the mattress.
    expect(over).toBeGreaterThan(onLeg - 0.05);
    expect(over).toBeGreaterThan(0.08);
    // No sharp steps: neighbours differ by less than the cloth's height over the body.
    for (let i = 0; i < H; i++) for (let j = 1; j < W; j++) expect(Math.abs(at(out, i, j) - at(out, i, j - 1))).toBeLessThan(0.12);
  });
});
