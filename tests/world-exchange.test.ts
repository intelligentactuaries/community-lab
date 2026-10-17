// Built worlds through the exchange: a lab experiment and a pooled export run
// in the world they were given (the province without one), runs pool only
// within one world, and provenance names a world without carrying its plan.
import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { armParams, runArm } from '../src/sim/experiment';
import { assumptionsHash } from '../src/sim/params';
import { changedFromDefaults, provenanceChanges } from '../src/sim/patch';
import { planHash } from '../src/sim/plan/hash';
import { masakhanePlan } from '../src/sim/plan/templates';

describe('built worlds through the exchange', () => {
  const world = masakhanePlan();

  test('every arm runs in the world it is given; without one, in the province', () => {
    expect(armParams({ world }, null, 's').params.plan).toBe(world);
    expect(armParams({}, null, 's').params.plan).toBeUndefined();
    const inWorld = runArm({ world, years: 0.1 }, null, 'exp-1');
    const inProvince = runArm({ years: 0.1 }, null, 'exp-1');
    expect(inWorld.basisHash).not.toBe(inProvince.basisHash);
    // Seeds of one world pool; two worlds never do.
    expect(runArm({ world, years: 0.05 }, null, 'exp-2').assumptionsHash).toBe(inWorld.assumptionsHash);
    expect(inWorld.assumptionsHash).not.toBe(inProvince.assumptionsHash);
  });

  test('assumptionsHash tells worlds apart, and leaves the province as it was', () => {
    const a = new Simulation({ seed: 'a', plan: world });
    const b = new Simulation({ seed: 'b', plan: world });
    const p = new Simulation({ seed: 'a' });
    expect(assumptionsHash(a.params, a.atlas.hash)).toBe(assumptionsHash(b.params, b.atlas.hash));
    expect(assumptionsHash(a.params, a.atlas.hash)).not.toBe(assumptionsHash(p.params, p.atlas.hash));
    expect(assumptionsHash(p.params, p.atlas.hash)).toBe(assumptionsHash(p.params));
  });

  test("provenance names a built world by its name and fingerprint, not its plan", () => {
    const params = { ...new Simulation({ seed: 's', plan: world }).params };
    expect(changedFromDefaults(params).plan).toBeDefined();
    const changed = provenanceChanges(params);
    expect(changed.plan).toBeUndefined();
    expect(changed.world).toBe(`Masakhane (${planHash(world)})`);
    expect(JSON.stringify(changed).length).toBeLessThan(2000);
  });
});
