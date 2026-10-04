// Who sleeps where: a husband and wife in one bed (the head of the house and
// their spouse in the main bedroom's double bed), everyone else a bed of their
// own for as long as the house has beds to go round.
import { describe, expect, test } from 'bun:test';
import { berths } from '../src/sim/beds';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import type { Person } from '../src/sim/types';

describe('beds', () => {
  const sim = new Simulation({ seed: 'beds' });
  const world = sim.world;
  const houses = Object.values(world.buildings).filter((b) => b.kind === 'house');
  const households = Object.values(world.households);
  const spouseAtHome = (p: Person) => {
    const q = p.marital === 'married' && p.partnerId ? world.people[p.partnerId] : undefined;
    return q?.alive && q.householdId === p.householdId ? q : undefined;
  };

  test('the main bedroom has one double bed; the other bedrooms have single beds', () => {
    for (const h of houses) {
      for (const r of h.rooms.filter((r) => r.kind === 'bedroom')) {
        const beds = r.spots.filter((s) => s.kind === 'bed');
        if (r.id.endsWith('-bed1')) {
          expect(beds.length).toBe(1);
          expect(beds[0].double).toBe(true);
        } else {
          expect(beds.length).toBe(2);
          for (const s of beds) expect(s.double).toBeFalsy();
        }
      }
    }
  });

  test('husband and wife share a bed, on either side of it; the head of the house has the double bed', () => {
    let couples = 0;
    for (const hh of households) {
      const plan = berths(world, hh);
      const members = hh.memberIds.map((id) => world.people[id]).filter((p) => p?.alive);
      for (const p of members) expect(plan.has(p.id)).toBe(true);
      const head = hh.headId ? world.people[hh.headId] : undefined;
      if (head?.alive) {
        const house = world.buildings[hh.houseId];
        const bed = house.rooms.flatMap((r) => r.spots).find((s) => s.id === plan.get(head.id)!.spotId)!;
        expect(bed.double).toBe(true);
      }
      for (const p of members) {
        const q = spouseAtHome(p);
        if (!q || p.sex !== 'M') continue;
        couples++;
        const a = plan.get(p.id)!;
        const b = plan.get(q.id)!;
        expect(a.spotId).toBe(b.spotId);
        expect(Math.sign(a.side) * Math.sign(b.side)).toBe(-1);
      }
      // Nobody else doubles up while a bed in the house stands empty.
      const house = world.buildings[hh.houseId];
      const beds = house.rooms.filter((r) => r.kind === 'bedroom').flatMap((r) => r.spots.filter((s) => s.kind === 'bed'));
      const used = new Set([...plan.values()].map((b) => b.spotId));
      if (used.size < beds.length) {
        for (const s of used) {
          const inIt = members.filter((p) => plan.get(p.id)!.spotId === s);
          expect(inIt.length === 1 || (inIt.length === 2 && spouseAtHome(inIt[0])?.id === inIt[1].id)).toBe(true);
        }
      }
    }
    expect(couples).toBeGreaterThan(40);
  });

  test('at night the couples at home lie in one bed, side by side', () => {
    sim.jumpToMinute(world.day * 1440 + 1440 + 2 * 60);
    for (let k = 0; k < 6; k++) sim.advance(0.5);
    let together = 0;
    for (const p of alivePeople(world)) {
      const q = spouseAtHome(p);
      if (!q || p.sex !== 'M') continue;
      const home = world.households[p.householdId].houseId;
      if (p.loc.buildingId !== home || q.loc.buildingId !== home || p.plan[p.planIdx]?.kind !== 'sleep' || q.plan[q.planIdx]?.kind !== 'sleep') continue;
      expect(p.loc.spotId).toBe(q.loc.spotId);
      expect(Math.abs(p.loc.x - q.loc.x)).toBeGreaterThan(0.5);
      expect(p.loc.y).toBe(q.loc.y);
      together++;
    }
    expect(together).toBeGreaterThan(30);
  }, 60_000);
});
