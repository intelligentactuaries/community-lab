// Furniture that belongs together: every house's kitchen chairs sit round one
// table, a lounge's easy chairs round a coffee table, the same in every house;
// and chairs set far apart (a café, a food court) keep their own small tables.
import { describe, expect, test } from 'bun:test';
import { furnitureOf, isLounge } from '../src/client/render/furniture';
import { Simulation } from '../src/sim/engine';
import { dining, lounge } from '../src/sim/layout/builders';
import type { Room } from '../src/sim/types';

const roomWith = (name: string, kind: Room['kind'], spots: Room['spots']): Room => ({ id: `r-${name}`, name, kind, x: 0, y: 0, w: 20, h: 20, spots });

describe('a table for the chairs round it', () => {
  test('four chairs set for dinner share one table between two rows, a place apart', () => {
    const spots = dining(10, 10, 4);
    expect(spots).toHaveLength(4);
    const f = furnitureOf(roomWith('Kitchen', 'kitchen', spots));
    expect(f.tables).toHaveLength(1);
    const t = f.tables[0];
    expect(t.ids).toHaveLength(4);
    expect(t.x).toBeCloseTo(10, 5);
    expect(t.y).toBeCloseTo(10, 5);
    expect(t.acrossY).toBe(true);
    // A family table: about 1.2 by 0.9 m.
    expect(t.w).toBeGreaterThan(1.0);
    expect(t.w).toBeLessThan(1.5);
    expect(t.d).toBeGreaterThan(0.7);
    expect(t.d).toBeLessThan(1.1);
    for (const s of spots) expect(f.byId.get(s.id)).toBe(t);
  });

  test('six chairs make a longer table; chairs far apart keep their own', () => {
    const six = furnitureOf(roomWith('Kitchen & dining', 'kitchen', dining(5, 5, 6)));
    expect(six.tables).toHaveLength(1);
    expect(six.tables[0].w).toBeGreaterThan(1.6);
    const apart = furnitureOf(roomWith('Food court', 'hall', [{ id: 'a', kind: 'table', x: 2, y: 2 }, { id: 'b', kind: 'table', x: 8, y: 2 }]));
    expect(apart.tables).toHaveLength(0);
  });

  test('easy chairs in a lounge face a coffee table in their midst', () => {
    const r = roomWith('Living room & kitchen', 'kitchen', lounge(9, 9, 4));
    expect(isLounge(r)).toBe(true);
    const c = furnitureOf(r).coffee!;
    expect(c).not.toBeNull();
    expect(c.x).toBeCloseTo(9, 5);
    expect(c.y).toBeCloseTo(9, 5);
    // a row of armchairs gets its table in front, toward the middle of the room
    const row = furnitureOf(roomWith('Living room', 'living', [{ id: 'a', kind: 'seat', x: 5, y: 4 }, { id: 'b', kind: 'seat', x: 9, y: 4 }, { id: 'c', kind: 'seat', x: 13, y: 4 }])).coffee!;
    expect(row.y).toBeGreaterThan(4);
    expect(row.x).toBeCloseTo(9, 5);
  });
});

describe('the same in every house', () => {
  test('each house kitchen has one table for all its chairs, and each lounge a coffee table', () => {
    const sim = new Simulation({ seed: 'furniture' });
    let kitchens = 0;
    let lounges = 0;
    for (const b of Object.values(sim.world.buildings)) {
      if (b.kind !== 'house') continue;
      for (const r of b.rooms) {
        const chairs = r.spots.filter((s) => s.kind === 'table');
        const f = furnitureOf(r);
        if (r.kind === 'kitchen' && chairs.length >= 2) {
          kitchens++;
          expect(f.tables, `${b.name} ${r.name}`).toHaveLength(1);
          expect(f.tables[0].ids.length).toBe(chairs.length);
        }
        if (isLounge(r) && r.spots.filter((s) => s.kind === 'seat').length >= 2) {
          lounges++;
          expect(f.coffee, `${b.name} ${r.name}`).not.toBeNull();
        }
      }
    }
    expect(kitchens).toBeGreaterThan(20);
    expect(lounges).toBeGreaterThan(20);
  });
});
