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

export interface StationSpec {
  /** Building id. */
  id: string;
  name: string;
  /** Where the train draws up, on the guideway beside the platform. */
  x: number;
  y: number;
  /** Distance along the guideway from its western end (filled in below). */
  t: number;
}

/** Stations in line order, west to east to north. */
export const STATIONS: StationSpec[] = [
  { id: 'st-emmaus', name: 'Emmaus', x: 950, y: 690, t: 0 },
  { id: 'st-unity', name: 'Unity Central', x: 1676, y: 1650, t: 0 },
  { id: 'st-ithemba', name: 'Ithemba', x: 2030, y: 2880, t: 0 },
  { id: 'st-airport', name: 'Airport', x: 3720, y: 2110, t: 0 },
  { id: 'st-newhaven', name: 'Newhaven', x: 3330, y: 606, t: 0 },
];

/** Cumulative length at each vertex of the track. */
export const TRACK_CUM: number[] = TRACK.map((_, i) => {
  let l = 0;
  for (let k = 1; k <= i; k++) l += Math.hypot(TRACK[k].x - TRACK[k - 1].x, TRACK[k].y - TRACK[k - 1].y);
  return l;
});
export const TRACK_LENGTH = TRACK_CUM[TRACK_CUM.length - 1];

/** Distance along the track of a point that lies on it (the nearest point is used, so a metre off the rail is fine). */
export function trackDistanceOf(x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 1; i < TRACK.length; i++) {
    const a = TRACK[i - 1];
    const b = TRACK[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + u * dx;
    const py = a.y + u * dy;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) {
      bd = d;
      best = TRACK_CUM[i - 1] + u * Math.sqrt(len2);
    }
  }
  return best;
}

/** The point and heading on the track at distance `s` from its western end. */
export function trackPoint(s: number): { x: number; y: number; heading: number } {
  const t = Math.max(0, Math.min(TRACK_LENGTH, s));
  for (let i = 1; i < TRACK.length; i++) {
    if (t <= TRACK_CUM[i] || i === TRACK.length - 1) {
      const a = TRACK[i - 1];
      const b = TRACK[i];
      const seg = TRACK_CUM[i] - TRACK_CUM[i - 1];
      const u = seg > 0 ? (t - TRACK_CUM[i - 1]) / seg : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  }
  return { x: TRACK[0].x, y: TRACK[0].y, heading: 0 };
}

for (const s of STATIONS) s.t = trackDistanceOf(s.x, s.y);

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
