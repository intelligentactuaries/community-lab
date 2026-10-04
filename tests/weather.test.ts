// Rain and snow stay outdoors. A room with walls is under its roof, though both
// views look into it with the roof taken away: the flat plan draws no rain over
// it, and in the 3D view what falls lands on the ground, on a shelter's roof,
// on the Hyperline's deck or at the top of a room's walls, never inside.
import { describe, expect, test } from 'bun:test';
import { OPEN_ROOMS, REACH, indoorsOf } from '../src/client/render/indoors';
import { catchAt, fixedCoversOf, onCover } from '../src/client/render3d/weather3d';
import { FLOOR_Y, GROUND_Y, TRACK_Y, WALL_CIVIC, WALL_FULL } from '../src/client/render3d/world3d';
import { Simulation } from '../src/sim/engine';
import { TRACK } from '../src/sim/world';

const sim = new Simulation({ seed: 'weather' });
const world = sim.world;
const indoors = indoorsOf(world);
const buildings = Object.values(world.buildings);

describe('indoors, for the weather', () => {
  test('every room with walls is indoors, and a house yard is not', () => {
    let walled = 0;
    let yards = 0;
    for (const b of buildings) {
      const unwalled = b.kind === 'runway' || b.kind === 'stadium' || b.kind === 'busstop';
      for (const r of b.rooms) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        if (!unwalled && !OPEN_ROOMS.has(r.kind)) {
          walled++;
          expect(indoors.inside(cx, cy), `${b.name} ${r.name}`).toBe(true);
          expect(indoors.roomAt(cx, cy)?.house).toBe(b.kind === 'house');
        }
        if (b.kind === 'house' && r.kind === 'yard') {
          yards++;
          expect(indoors.inside(cx, cy), `${b.name} ${r.name}`).toBe(false);
        }
      }
    }
    expect(walled).toBe(indoors.rooms.length);
    expect(yards).toBeGreaterThan(20);
  });

  test('how far a point is from the rooms: nothing inside, rising outside, up to a reach', () => {
    const house = buildings.find((b) => b.kind === 'house')!;
    const room = house.rooms.find((r) => r.kind === 'bedroom')!;
    expect(indoors.clearance(room.x + 1, room.y + 1)).toBe(0);
    // A wall's outside face stands 0.1 m beyond the room: outdoors, just.
    const beside = indoors.clearance(room.x - 0.1, room.y + room.h / 2);
    if (!indoors.inside(room.x - 0.1, room.y + room.h / 2)) expect(beside).toBeCloseTo(0.1, 5);
    expect(indoors.clearance(-500, -500)).toBe(REACH);
    // Civic walls stand higher: a house room does not count when only those are asked about.
    expect(indoors.clearance(room.x + 1, room.y + 1, true)).toBe(REACH);
  });
});

describe('what falls in the 3D view', () => {
  const covers = fixedCoversOf(world);

  test('over a room it stops at the top of the walls; over open ground, at the ground', () => {
    const house = buildings.find((b) => b.kind === 'house')!;
    const bedroom = house.rooms.find((r) => r.kind === 'bedroom')!;
    const yard = house.rooms.find((r) => r.kind === 'yard')!;
    expect(catchAt(indoors, covers, bedroom.x + bedroom.w / 2, bedroom.y + bedroom.h / 2)).toBeCloseTo(FLOOR_Y + WALL_FULL, 5);
    expect(catchAt(indoors, covers, yard.x + yard.w / 2, yard.y + yard.h / 2)).toBe(GROUND_Y);
    const civic = buildings.find((b) => b.kind === 'church')!;
    const nave = civic.rooms.find((r) => !OPEN_ROOMS.has(r.kind))!;
    expect(catchAt(indoors, covers, nave.x + nave.w / 2, nave.y + nave.h / 2)).toBeCloseTo(FLOOR_Y + WALL_CIVIC, 5);
  });

  test('a bus shelter and the Hyperline keep the rain off whoever is under them', () => {
    const stop = buildings.find((b) => b.kind === 'busstop')!;
    const under = catchAt(indoors, covers, stop.x + stop.w / 2, stop.y + 1.2);
    expect(under).toBeGreaterThan(2.5);
    expect(under).toBeLessThan(3);
    // In the open part of the stop, it reaches the ground.
    expect(catchAt(indoors, covers, stop.x + stop.w / 2, stop.y + stop.h - 1)).toBe(GROUND_Y);
    // Anywhere along the guideway, the deck (or a station's canopy above it) catches it.
    for (let i = 1; i < TRACK.length; i++) {
      const a = TRACK[i - 1];
      const b = TRACK[i];
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      expect(catchAt(indoors, covers, x, y)).toBeGreaterThanOrEqual(TRACK_Y);
      // ...and 5 m to the side of it, open ground again (unless a building or platform stands there).
      const side = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x, y: y + 5 } : { x: x + 5, y };
      if (!indoors.inside(side.x, side.y) && !covers.some((c) => c.top !== TRACK_Y && onCover(c, side.x, side.y))) expect(catchAt(indoors, covers, side.x, side.y)).toBe(GROUND_Y);
    }
  });
});
