// Plots, houses and road segments: the pieces every city is laid out from.

import type { Building, CommunityId, Room } from '../types';
import { dining, double, grid, lounge, mkBuilding, room, spot } from './builders';

export interface Segment {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Carriageway width in metres; streets default to 7, the highways are wider. */
  width?: number;
}

export interface PlotSpec {
  plot: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which side the front door faces. */
  facing: 'north' | 'south';
  community: CommunityId;
  tier: 'standard' | 'large' | 'small';
}

export const PLOT_W = 52;
export const PLOT_H = 90;

/** A row of plots along a street: `facing` 'south' puts the gate on the bottom edge. */
export function plotRow(firstPlot: number, n: number, x0: number, step: number, y: number, facing: 'north' | 'south', community: CommunityId, tier: PlotSpec['tier']): PlotSpec[] {
  const w = tier === 'large' ? 72 : tier === 'small' ? 46 : PLOT_W;
  const h = tier === 'large' ? 92 : tier === 'small' ? 82 : PLOT_H;
  const out: PlotSpec[] = [];
  for (let i = 0; i < n; i++) out.push({ plot: firstPlot + i, x: x0 + i * step, y, w, h, facing, community, tier });
  return out;
}

export function houseRooms(id: string, plot: PlotSpec): { rooms: Room[]; door: { x: number; y: number }; gate: { x: number; y: number } } {
  if (plot.tier === 'large') return largeHouseRooms(id, plot);
  if (plot.tier === 'small') return smallHouseRooms(id, plot);
  const hx = plot.x + 12;
  const hw = 28;
  const hh = 24;
  const hy = plot.facing === 'south' ? plot.y + 26 : plot.y + plot.h - 26 - hh;
  // Two rows of rooms. Front row (living + kitchen) is on the door side.
  const frontY = plot.facing === 'south' ? hy + 12 : hy;
  const backY = plot.facing === 'south' ? hy : hy + 12;
  const rooms: Room[] = [
    room(`${id}-living`, 'Living room', 'living', hx, frontY, 14, 12, [
      ...grid('seat', hx + 2, frontY + 3, 10, 3, 3, 1),
      spot('table', hx + 7, frontY + 8.5),
    ]),
    room(`${id}-kitchen`, 'Kitchen', 'kitchen', hx + 14, frontY, 14, 12, [
      spot('stove', hx + 26, frontY + 2.5),
      // The family's table, four chairs round it.
      ...dining(hx + 21, frontY + 7.5, 4),
    ]),
    // The couple's double bed (and a pot plant in the corner).
    room(`${id}-bed1`, 'Main bedroom', 'bedroom', hx, backY, 9, 12, [double(hx + 4.5, backY + 5), spot('generic', hx + 1, backY + 1)]),
    room(`${id}-bed2`, 'Bedroom 2', 'bedroom', hx + 9, backY, 9, 12, [spot('bed', hx + 11.5, backY + 5), spot('bed', hx + 15.5, backY + 5)]),
    room(`${id}-bed3`, 'Bedroom 3', 'bedroom', hx + 18, backY, 6, 12, [spot('bed', hx + 20, backY + 4), spot('bed', hx + 22, backY + 8)]),
    room(`${id}-bath`, 'Bathroom', 'bathroom', hx + 24, backY, 4, 12, [spot('generic', hx + 26, backY + 6)]),
  ];
  const doorY = plot.facing === 'south' ? hy + hh : hy;
  const door = { x: hx + 14, y: doorY };
  const gateY = plot.facing === 'south' ? plot.y + plot.h : plot.y;
  const gate = { x: hx + 14, y: gateY };
  const yardY = plot.facing === 'south' ? hy + hh : plot.y;
  const yardH = plot.facing === 'south' ? plot.y + plot.h - (hy + hh) : hy - plot.y;
  rooms.push(
    room(`${id}-yard`, 'Yard', 'yard', plot.x, yardY, plot.w, yardH, [
      spot('bench-out', plot.x + 6, yardY + yardH / 2),
      spot('bench-out', plot.x + plot.w - 6, yardY + yardH / 2),
      spot('generic', plot.x + plot.w / 2 + 10, yardY + yardH / 2 + (plot.facing === 'south' ? 3 : -3)),
    ]),
  );
  return { rooms, door, gate };
}

/** Hebron: a five-bedroom-scale home with a study, on a garden plot. */
function largeHouseRooms(id: string, plot: PlotSpec): { rooms: Room[]; door: { x: number; y: number }; gate: { x: number; y: number } } {
  const hw = 48;
  const hh = 30;
  const hx = plot.x + (plot.w - hw) / 2;
  const hy = plot.facing === 'south' ? plot.y + 22 : plot.y + plot.h - 22 - hh;
  const frontY = plot.facing === 'south' ? hy + 15 : hy;
  const backY = plot.facing === 'south' ? hy : hy + 15;
  const rooms: Room[] = [
    room(`${id}-living`, 'Living room', 'living', hx, frontY, 18, 15, [...grid('seat', hx + 2, frontY + 4, 13, 4, 4, 1), spot('table', hx + 9, frontY + 10)]),
    room(`${id}-kitchen`, 'Kitchen & dining', 'kitchen', hx + 18, frontY, 16, 15, [spot('stove', hx + 32, frontY + 3), ...dining(hx + 26, frontY + 9.5, 6)]),
    room(`${id}-study`, 'Study', 'living', hx + 34, frontY, 14, 15, [spot('desk', hx + 41, frontY + 5), spot('seat', hx + 38, frontY + 10)]),
    room(`${id}-bed1`, 'Main suite', 'bedroom', hx, backY, 14, 15, [double(hx + 7, backY + 7), spot('generic', hx + 1, backY + 1)]),
    room(`${id}-bed2`, 'Bedroom 2', 'bedroom', hx + 14, backY, 11, 15, [spot('bed', hx + 17, backY + 7), spot('bed', hx + 22, backY + 7)]),
    room(`${id}-bed3`, 'Bedroom 3', 'bedroom', hx + 25, backY, 11, 15, [spot('bed', hx + 28, backY + 7), spot('bed', hx + 33, backY + 7)]),
    room(`${id}-bath`, 'Bathrooms', 'bathroom', hx + 36, backY, 12, 15, [spot('generic', hx + 40, backY + 7), spot('generic', hx + 45, backY + 7)]),
  ];
  const doorY = plot.facing === 'south' ? hy + hh : hy;
  const door = { x: hx + 22, y: doorY };
  const gateY = plot.facing === 'south' ? plot.y + plot.h : plot.y;
  const gate = { x: hx + 22, y: gateY };
  const yardY = plot.facing === 'south' ? hy + hh : plot.y;
  const yardH = plot.facing === 'south' ? plot.y + plot.h - (hy + hh) : hy - plot.y;
  rooms.push(room(`${id}-yard`, 'Garden', 'yard', plot.x, yardY, plot.w, yardH, [spot('bench-out', plot.x + 8, yardY + yardH / 2), spot('bench-out', plot.x + plot.w - 8, yardY + yardH / 2), spot('generic', plot.x + plot.w / 2, yardY + yardH / 2)]));
  return { rooms, door, gate };
}

/** Kanana: a compact three-room home. */
function smallHouseRooms(id: string, plot: PlotSpec): { rooms: Room[]; door: { x: number; y: number }; gate: { x: number; y: number } } {
  const hw = 30;
  const hh = 18;
  const hx = plot.x + (plot.w - hw) / 2;
  const hy = plot.facing === 'south' ? plot.y + 20 : plot.y + plot.h - 20 - hh;
  const frontY = plot.facing === 'south' ? hy + 9 : hy;
  const backY = plot.facing === 'south' ? hy : hy + 9;
  const rooms: Room[] = [
    room(`${id}-living`, 'Living room & kitchen', 'kitchen', hx, frontY, 18, 9, [spot('stove', hx + 2, frontY + 2), ...lounge(hx + 9.5, frontY + 4.5, 4), spot('table', hx + 15.5, frontY + 4.5)]),
    room(`${id}-bed2`, 'Bedroom 2', 'bedroom', hx + 18, frontY, 12, 9, [spot('bed', hx + 21, frontY + 4.5), spot('bed', hx + 26, frontY + 4.5)]),
    room(`${id}-bed1`, 'Main bedroom', 'bedroom', hx, backY, 15, 9, [double(hx + 6.5, backY + 4.5), spot('generic', hx + 1, backY + 1)]),
    room(`${id}-bath`, 'Washroom', 'bathroom', hx + 15, backY, 15, 9, [spot('generic', hx + 22, backY + 4.5)]),
  ];
  const doorY = plot.facing === 'south' ? hy + hh : hy;
  const door = { x: hx + 12, y: doorY };
  const gateY = plot.facing === 'south' ? plot.y + plot.h : plot.y;
  const gate = { x: hx + 12, y: gateY };
  const yardY = plot.facing === 'south' ? hy + hh : plot.y;
  const yardH = plot.facing === 'south' ? plot.y + plot.h - (hy + hh) : hy - plot.y;
  rooms.push(room(`${id}-yard`, 'Yard', 'yard', plot.x, yardY, plot.w, yardH, [spot('bench-out', plot.x + 5, yardY + yardH / 2), spot('generic', plot.x + plot.w - 8, yardY + yardH / 2)]));
  return { rooms, door, gate };
}

/** A house on its plot: the gate is the road-side entrance, the door the room-side one. */
export function houseBuilding(p: PlotSpec): Building {
  const id = `house${p.plot}`;
  const hr = houseRooms(id, p);
  const hb = mkBuilding(id, 'house', `Plot ${p.plot}`, p.community, p.x, p.y, p.w, p.h, hr.gate, hr.rooms, p.plot);
  hb.door = hr.door;
  return hb;
}

