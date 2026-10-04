// Indoors, for the weather. A room with walls is under a roof, though both
// views look into it with the roof taken away (the flat plan from house zoom,
// the 3D view's doll's house), so rain and snow never fall in it and are never
// drawn over it. Yards, fields, pitches, graves, pens, platforms and stands are
// open ground. Shared by the flat map and the 3D view.
import type { Building, Room, World } from '../../sim/types';

/** Rooms that are open ground, not enclosed by walls (the 3D view builds no walls round them). */
export const OPEN_ROOMS: ReadonlySet<Room['kind']> = new Set<Room['kind']>(['yard', 'field', 'pitch', 'graves', 'pen', 'stop', 'stand']);

/** Buildings whose rooms are never walled: the runway, the stadium's bowl, a bus shelter. */
const UNWALLED: ReadonlySet<Building['kind']> = new Set<Building['kind']>(['runway', 'stadium', 'busstop']);

export interface IndoorRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A house's room (lower walls than a civic building's in the 3D view). */
  house: boolean;
}

/** Grid cell (metres) for finding the rooms near a point. */
const CELL = 5;
/** How far past its walls a room is found, for the soft edge where outdoors meets indoors. */
export const REACH = 0.5;

/**
 * The rooms, in a grid over the map (asked about for every raindrop in view,
 * every frame, so kept in flat arrays).
 */
export class Indoors {
  readonly rooms: IndoorRect[] = [];
  private x0: Float64Array;
  private y0: Float64Array;
  private x1: Float64Array;
  private y1: Float64Array;
  private house: Uint8Array;
  /** Grid origin and size; each cell's rooms are list[start[c] .. start[c + 1]). */
  private ox = 0;
  private oy = 0;
  private gw = 0;
  private gh = 0;
  private start: Int32Array;
  private list: Int32Array;

  constructor(buildings: Record<string, Building>) {
    for (const b of Object.values(buildings)) {
      if (UNWALLED.has(b.kind)) continue;
      for (const r of b.rooms) if (!OPEN_ROOMS.has(r.kind)) this.rooms.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, house: b.kind === 'house' });
    }
    const n = this.rooms.length;
    this.x0 = new Float64Array(n);
    this.y0 = new Float64Array(n);
    this.x1 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.house = new Uint8Array(n);
    this.rooms.forEach((r, i) => {
      this.x0[i] = r.x0;
      this.y0[i] = r.y0;
      this.x1[i] = r.x1;
      this.y1[i] = r.y1;
      this.house[i] = r.house ? 1 : 0;
    });
    if (n) {
      this.ox = Math.min(...this.x0) - REACH - 1;
      this.oy = Math.min(...this.y0) - REACH - 1;
      this.gw = Math.ceil((Math.max(...this.x1) + REACH + 1 - this.ox) / CELL) + 1;
      this.gh = Math.ceil((Math.max(...this.y1) + REACH + 1 - this.oy) / CELL) + 1;
    }
    // Each room goes in every cell it reaches (with its margin): count, then fill.
    const counts = new Int32Array(this.gw * this.gh + 1);
    const cells = (i: number, f: (c: number) => void) => {
      for (let cy = this.cell(this.y0[i] - REACH, this.oy); cy <= this.cell(this.y1[i] + REACH, this.oy); cy++) {
        for (let cx = this.cell(this.x0[i] - REACH, this.ox); cx <= this.cell(this.x1[i] + REACH, this.ox); cx++) f(cy * this.gw + cx);
      }
    };
    for (let i = 0; i < n; i++) cells(i, (c) => counts[c + 1]++);
    for (let c = 0; c < this.gw * this.gh; c++) counts[c + 1] += counts[c];
    this.start = counts;
    this.list = new Int32Array(counts[this.gw * this.gh]);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) cells(i, (c) => (this.list[fill[c]++] = i));
  }

  private cell(v: number, o: number): number {
    return Math.floor((v - o) / CELL);
  }

  /** The grid cell a point falls in, or -1 off the grid. */
  private at(x: number, y: number): number {
    const cx = Math.floor((x - this.ox) / CELL);
    const cy = Math.floor((y - this.oy) / CELL);
    return cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh ? -1 : cy * this.gw + cx;
  }

  /** The room with walls a point on the map is in, if any. */
  roomAt(x: number, y: number): IndoorRect | null {
    const c = this.at(x, y);
    if (c < 0) return null;
    for (let j = this.start[c], e = this.start[c + 1]; j < e; j++) {
      const i = this.list[j];
      if (x >= this.x0[i] && x <= this.x1[i] && y >= this.y0[i] && y <= this.y1[i]) return this.rooms[i];
    }
    return null;
  }

  /** Whether a point on the map is indoors. */
  inside(x: number, y: number): boolean {
    return this.roomAt(x, y) !== null;
  }

  /**
   * How far a point is from the nearest room (metres): 0 inside one, rising
   * outside it, and `REACH` once no room is that near. With `civic`, only the
   * rooms of civic buildings count (their walls stand higher than a house's).
   */
  clearance(x: number, y: number, civic = false): number {
    const c = this.at(x, y);
    if (c < 0) return REACH;
    let best = REACH;
    for (let j = this.start[c], e = this.start[c + 1]; j < e; j++) {
      const i = this.list[j];
      if (civic && this.house[i]) continue;
      const dx = Math.max(this.x0[i] - x, 0, x - this.x1[i]);
      const dy = Math.max(this.y0[i] - y, 0, y - this.y1[i]);
      if (dx === 0 && dy === 0) return 0;
      const d = dx === 0 ? dy : dy === 0 ? dx : Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return best;
  }
}

const cache = new WeakMap<Record<string, Building>, Indoors>();

/** The indoor rooms of a world's buildings (built once per layout). */
export function indoorsOf(world: World): Indoors {
  let d = cache.get(world.buildings);
  if (!d) {
    d = new Indoors(world.buildings);
    cache.set(world.buildings, d);
  }
  return d;
}
