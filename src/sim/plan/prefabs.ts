// Sets and generators for the builder: a street lined with houses, a civic
// centre, a village core, the airfield. Each returns plain plan pieces (roads
// and buildings) laid out as the province lays out its own, so a set dropped
// into a world reads as if it had always been there.

import type { Facing } from '../layout/builders';
import { ASSET, HOUSE_PLOTS, assetSize } from './assets';
import type { PlanBuilding, PlanRoad } from './types';

export interface Pieces {
  roads: PlanRoad[];
  buildings: PlanBuilding[];
}

/** Distance from a street's centre line to the gate edge of the plots along it (the province's 15 m: a verge and a pavement). */
export const SETBACK = 15;

type HouseTier = keyof typeof HOUSE_PLOTS;
const HOUSE_ASSET: Record<HouseTier, string> = { small: 'house-small', standard: 'house', large: 'house-large' };

/** Spacing between neighbouring plots along a street (the province's: 3 m standard, 6 m estates, wider in the townships). */
export function plotPitch(tier: HouseTier): number {
  return HOUSE_PLOTS[tier].w + (tier === 'large' ? 6 : tier === 'small' ? 14 : 3);
}

/** A fresh id for a new piece: the asset's name and the lowest number not yet taken (so a template always comes out the same). */
export function freshId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The next unused plot numbers. */
export function nextPlots(used: ReadonlySet<number>, n: number): number[] {
  const out: number[] = [];
  let p = 1;
  while (out.length < n) {
    if (!used.has(p)) out.push(p);
    p++;
  }
  return out;
}

/**
 * Houses along a straight, axis-aligned street, on one side or both, their
 * gates facing it. The street itself is included when `withRoad` is set.
 */
export function street(o: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  name: string;
  tier: HouseTier;
  sides: 'both' | 'left' | 'right';
  settlement: string;
  taken: ReadonlySet<string>;
  plotsUsed: ReadonlySet<number>;
  withRoad?: boolean;
  /** Leave this much free at each end (for the junctions). */
  margin?: number;
}): Pieces {
  const horizontal = o.y1 === o.y2;
  const lo = horizontal ? Math.min(o.x1, o.x2) : Math.min(o.y1, o.y2);
  const hi = horizontal ? Math.max(o.x1, o.x2) : Math.max(o.y1, o.y2);
  const along = o.y1 === o.y2 ? o.y1 : o.x1;
  const plot = HOUSE_PLOTS[o.tier];
  const pitch = plotPitch(o.tier);
  const margin = o.margin ?? 12;
  const n = Math.max(0, Math.floor((hi - lo - 2 * margin + (pitch - plot.w)) / pitch));
  const start = lo + (hi - lo - (n * pitch - (pitch - plot.w))) / 2;
  const sides: Array<'left' | 'right'> = o.sides === 'both' ? ['left', 'right'] : [o.sides];
  const taken = new Set(o.taken);
  const plots = nextPlots(o.plotsUsed, n * sides.length);
  const buildings: PlanBuilding[] = [];
  let k = 0;
  for (const side of sides) {
    for (let i = 0; i < n; i++) {
      const s = start + i * pitch;
      let x: number;
      let y: number;
      let w: number;
      let h: number;
      let facing: Facing;
      if (horizontal) {
        // left = north of the street (gates face south), right = south (gates face north)
        w = plot.w;
        h = plot.h;
        x = s;
        y = side === 'left' ? along - SETBACK - h : along + SETBACK;
        facing = side === 'left' ? 'S' : 'N';
      } else {
        // left = west of the street (gates face east), right = east (gates face west)
        w = plot.h;
        h = plot.w;
        y = s;
        x = side === 'left' ? along - SETBACK - w : along + SETBACK;
        facing = side === 'left' ? 'E' : 'W';
      }
      const id = freshId('house', taken);
      taken.add(id);
      const pn = plots[k++];
      buildings.push({ id, asset: HOUSE_ASSET[o.tier], name: `Plot ${pn}`, settlement: o.settlement, x: Math.round(x), y: Math.round(y), w, h, facing, plot: pn });
    }
  }
  const roads: PlanRoad[] = o.withRoad ? [{ name: o.name, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 }] : [];
  return { roads, buildings };
}

/** One building of an asset, its door to the given side, its id fresh. */
export function place(asset: string, x: number, y: number, facing: Facing, settlement: string, taken: Set<string>, name?: string, options?: Record<string, string | number | boolean>): PlanBuilding {
  const a = ASSET[asset];
  const sz = assetSize(a, { ...options, facing });
  const id = freshId(asset, taken);
  taken.add(id);
  return { id, asset, name: name ?? a.label, settlement, x: Math.round(x), y: Math.round(y), w: sz.w, h: sz.h, facing, ...(options ? { options } : {}) };
}

/**
 * A civic centre on a north–south street at x: the council chamber, the
 * medical centre, the magistrate's court, a commercial bank and a square,
 * two by two either side (Emmaus Crossing's plan).
 */
export function civicCentre(x: number, y: number, settlement: string, taken: Set<string>, town: string): Pieces {
  return {
    roads: [{ name: `${town} Way`, x1: x, y1: y - 10, x2: x, y2: y + 210 }],
    buildings: [
      place('council', x - 110, y + 6, 'E', settlement, taken, `${town} Council`),
      place('combank', x + 16, y + 6, 'W', settlement, taken, `${town} Commercial Bank`),
      place('medical', x - 110, y + 90, 'E', settlement, taken, `${town} Medical Centre`),
      place('court', x + 12, y + 86, 'W', settlement, taken, `${town} Magistrate's Court`),
      place('plaza', x - 114, y + 162, 'E', settlement, taken, `${town} Square`),
    ],
  };
}

/**
 * A village core along an east–west street at y: church, school, clinic,
 * police, a general dealer and a Mutual Bank branch on one side; a park, a
 * hall, a cemetery, a workshop and a bus stop on the other.
 */
export function villageCore(x: number, y: number, settlement: string, taken: Set<string>, town: string): Pieces {
  const n = 'S';
  const s = 'N';
  return {
    roads: [{ name: `${town} High Street`, x1: x, y1: y, x2: x + 640, y2: y }],
    buildings: [
      place('church', x + 10, y - SETBACK - 84, n, settlement, taken, `${town} Community Church`, { size: 'large' }),
      place('school', x + 140, y - SETBACK - 76, n, settlement, taken, `${town} School`),
      place('clinic', x + 266, y - SETBACK - 76, n, settlement, taken, `${town} Clinic`),
      place('police', x + 364, y - SETBACK - 76, n, settlement, taken, `SAPS ${town}`),
      place('market', x + 442, y - SETBACK - 76, n, settlement, taken, `${town} Market`, { front: false }),
      place('bank', x + 540, y - SETBACK - 50, n, settlement, taken, `${town} Mutual Bank`, { hq: true }),
      place('park', x + 10, y + SETBACK, s, settlement, taken, `${town} Sports Field`),
      place('hall', x + 90, y + SETBACK, s, settlement, taken, `${town} Community Hall`),
      place('cemetery', x + 184, y + SETBACK, s, settlement, taken, `${town} Cemetery`),
      place('workshop', x + 276, y + SETBACK, s, settlement, taken, 'Workshop'),
      place('farm', x + 352, y + SETBACK, s, settlement, taken, 'Farm'),
      place('office', x + 428, y + SETBACK, s, settlement, taken, `${town} Co-op Offices`),
      place('taxi', x + 504, y + SETBACK, s, settlement, taken, `${town} Taxi Association`),
      place('busstop', x + 580, y + 6, s, settlement, taken, `${town} bus stop`),
    ],
  };
}

/**
 * The airfield: Terminal Drive off an access road from the west, the terminal
 * and its apron, the control tower, the hangar and the fire station on the
 * airside road, and a 1.6 km runway along the east (the province's layout).
 * (x, y) is the north-west corner, where the access road comes in.
 */
export function airfield(x: number, y: number, settlement: string, taken: Set<string>, name: string): Pieces {
  return {
    roads: [
      { name: 'Airport Road', x1: x, y1: y + 700, x2: x + 110, y2: y + 700, width: 9 },
      { name: 'Terminal Drive', x1: x + 110, y1: y + 660, x2: x + 110, y2: y + 820 },
      { name: 'Airside Road', x1: x + 110, y1: y + 820, x2: x + 480, y2: y + 820 },
    ],
    buildings: [
      place('airport-terminal', x + 130, y + 640, 'W', settlement, taken, `${name} Terminal`),
      place('busstop', x + 116, y + 780, 'W', settlement, taken, 'Airport bus stop'),
      place('tower', x + 150, y + 840, 'N', settlement, taken, 'Control tower'),
      place('hangar', x + 210, y + 850, 'N', settlement, taken, 'Hangar'),
      place('airport-fire', x + 370, y + 850, 'N', settlement, taken, 'Fire & Rescue'),
      place('runway', x + 510, y, 'W', settlement, taken, 'Runway 18/36'),
    ],
  };
}

/** The airfield's footprint, for placing it. */
export const AIRFIELD_SIZE = { w: 560, h: 1600 };
