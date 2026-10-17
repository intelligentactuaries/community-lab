// The Hyperline: the province's train, on an elevated guideway that skirts
// the settlements and calls at five stations — Emmaus, Unity Central,
// Ithemba, the Airport and Newhaven. The line runs east from Emmaus's civic
// centre, south along the western edge of Unity Centre, east below Ithemba
// Crossroads, north up the airfield's western boundary and west to
// Newhaven's civic centre. It crosses every road it meets on a viaduct.
//
// Each city's station stands at the edge of its civic centre so every
// settlement is a short walk from the line; the Airport station is across
// Terminal Drive from the terminal.

import type { StationSpec } from '../atlas';
import { cumulative, distanceAlong } from '../track';
import type { Building } from '../types';
import { station } from './builders';

export const TRACK_WIDTH = 6;

/** The guideway, as a polyline of axis-aligned runs (metres). */
export const TRACK: Array<{ x: number; y: number }> = [
  { x: 890, y: 690 }, // Emmaus terminus buffer
  { x: 1676, y: 690 },
  { x: 1676, y: 2880 },
  { x: 3720, y: 2880 },
  { x: 3720, y: 1160 },
  { x: 3330, y: 1160 },
  { x: 3330, y: 560 }, // Newhaven terminus buffer
];

/** Stations in line order, west to east to north. */
export const STATIONS: StationSpec[] = [
  { id: 'st-emmaus', name: 'Emmaus', x: 950, y: 690, t: 0 },
  { id: 'st-unity', name: 'Unity Central', x: 1676, y: 1650, t: 0 },
  { id: 'st-ithemba', name: 'Ithemba', x: 2030, y: 2880, t: 0 },
  { id: 'st-airport', name: 'Airport', x: 3720, y: 2110, t: 0 },
  { id: 'st-newhaven', name: 'Newhaven', x: 3330, y: 606, t: 0 },
];

{
  const cum = cumulative(TRACK);
  for (const s of STATIONS) s.t = distanceAlong(TRACK, cum, s.x, s.y);
}

/** The four stations in the cities and the centre (the Airport's is built with the airfield). */
export function hyperlineBuildings(): Record<string, Building> {
  const b: Record<string, Building> = {};
  const add = (x: Building) => (b[x.id] = x);
  add(station({ id: 'st-emmaus', name: 'Emmaus Hyperline Station', com: 'crossing', x: 910, y: 620, w: 80, h: 60, facing: 'W', platform: 'S' }));
  add(station({ id: 'st-unity', name: 'Unity Central Station', com: 'cbd', x: 1690, y: 1620, w: 80, h: 60, facing: 'S', platform: 'W' }));
  add(station({ id: 'st-ithemba', name: 'Ithemba Hyperline Station', com: 'crossroads', x: 1990, y: 2810, w: 80, h: 60, facing: 'E', platform: 'S' }));
  add(station({ id: 'st-newhaven', name: 'Newhaven Hyperline Station', com: 'central', x: 3340, y: 576, w: 80, h: 60, facing: 'N', platform: 'W' }));
  return b;
}
