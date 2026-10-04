import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { CARE_AGE, SUPERVISOR_AGE } from '../src/sim/schedule';
import type { World } from '../src/sim/types';

/** Five-minute samples of a small child's day plan with nobody of supervising age planned to be in the same building. */
function unsupervisedSamples(w: World): number {
  const people = alivePeople(w).filter((p) => !p.away);
  const minders = people.filter((p) => p.age >= SUPERVISOR_AGE && p.health.hospitalDaysLeft === 0);
  let bad = 0;
  for (const kid of people) {
    if (kid.age >= CARE_AGE) continue;
    for (const a of kid.plan) {
      if (a.kind === 'school' || a.kind === 'homeschool') continue; // the teachers have them
      for (let m = a.start; m < a.end; m += 5) {
        if (!minders.some((q) => q.id !== kid.id && q.plan.some((b) => b.buildingId === a.buildingId && b.start <= m && m < b.end))) bad++;
      }
    }
  }
  return bad;
}

describe('childcare', () => {
  test('by the day plans, no child under ten is ever somewhere without someone of fourteen or more — weekdays, Saturday and Sunday alike', () => {
    const sim = new Simulation({ seed: 'care' });
    const w = sim.world;
    expect(alivePeople(w).filter((p) => p.age < CARE_AGE).length).toBeGreaterThan(10);
    for (let d = 0; d < 9; d++) {
      expect(unsupervisedSamples(w), `day ${d}`).toBe(0);
      sim.runDays(1);
    }
    // and somebody actually did the minding: neighbours came round, children went along
    const people = alivePeople(w);
    expect(people.some((p) => p.plan.some((a) => a.label.startsWith('minding ')))).toBe(true);
  }, 120_000);

  test('in the animated day a small child at home is (all but) never alone', () => {
    const sim = new Simulation({ seed: 'care' });
    const w = sim.world;
    while (sim.ctx.cal.weekday !== 2) sim.runDays(1);
    sim.setMicro(true);
    let alone = 0;
    let homeMinutes = 0;
    for (let m = 0; m < 16 * 60; m++) {
      sim.advance(1);
      const minders = new Set<string>();
      for (const q of alivePeople(w)) if (!q.away && !q.inVehicleId && q.loc.buildingId && q.age >= SUPERVISOR_AGE) minders.add(q.loc.buildingId);
      for (const kid of alivePeople(w)) {
        if (kid.age >= CARE_AGE || kid.away || kid.inVehicleId || kid.path.length || !kid.loc.buildingId) continue;
        if (w.buildings[kid.loc.buildingId]?.kind !== 'house') continue;
        homeMinutes++;
        if (!minders.has(kid.loc.buildingId)) alone++;
      }
    }
    expect(homeMinutes).toBeGreaterThan(1000);
    // walking speeds differ, so a minder can be a minute behind at a door; nothing more than that
    expect(alone / homeMinutes).toBeLessThan(0.01);
  }, 180_000);
});
