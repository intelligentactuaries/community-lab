// Mortality tables from CSV (src/shared/mortalityCsv.ts): the shapes people bring, and the ones refused.
import { describe, expect, test } from 'bun:test';
import { mortalityFromCsv } from '../src/shared/mortalityCsv';

describe('a mortality table from CSV', () => {
  test('by sex, as probabilities', () => {
    const r = mortalityFromCsv('age,qx_m,qx_f\n0,0.02,0.018\n1,0.002,0.0018\n2,0.001,0.0009\n', 't', 's');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ages).toEqual([0, 1, 2]);
      expect('M' in r.value.qx && r.value.qx.M[0]).toBe(0.02);
    }
  });
  test('per mille, said in the header or implied by the values', () => {
    const a = mortalityFromCsv('age;male (‰);female (‰)\n0;20;18\n1;2;1.8\n', 't', 's');
    const b = mortalityFromCsv('x,m,f\n0,20,18\n1,2,1.8\n', 't', 's');
    for (const r of [a, b]) {
      expect(r.ok).toBe(true);
      if (r.ok && 'M' in r.value.qx) expect(r.value.qx.M[0]).toBeCloseTo(0.02, 10);
    }
  });
  test('pooled, with a byte-order mark and Windows line endings', () => {
    const r = mortalityFromCsv('\uFEFFage,qx\r\n0,0.01\r\n1,0.001\r\n', 't', 's');
    expect(r.ok).toBe(true);
    if (r.ok) expect('pooled' in r.value.qx).toBe(true);
  });
  test('refused: no age, no rates, ages out of order, a rate that is not a number', () => {
    expect(mortalityFromCsv('year,qx\n2020,0.1\n2021,0.1\n', 't', 's').ok).toBe(false);
    expect(mortalityFromCsv('age,deaths\n0,3\n1,2\n', 't', 's').ok).toBe(false);
    expect(mortalityFromCsv('age,qx\n5,0.1\n1,0.1\n', 't', 's').ok).toBe(false);
    expect(mortalityFromCsv('age,qx\n0,abc\n1,0.1\n', 't', 's').ok).toBe(false);
  });
});
