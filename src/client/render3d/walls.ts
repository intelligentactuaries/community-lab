// Walls from room rectangles: every room edge, merged along each line; where a
// line has a room on both sides it is a partition, where on one side an outside
// wall (and which side tells the back wall from the front). Pure geometry, no
// three.js, so it can be tested on its own.
import type { Room } from '../../sim/types';

export interface WallLine {
  horiz: boolean;
  /** The fixed coordinate (y of a horizontal wall, x of a vertical one). */
  c: number;
  a: number;
  b: number;
  /** A partition between two rooms. */
  inner: boolean;
  /** +1: the room lies on the + side (south of a horizontal line, east of a vertical one). */
  side: number;
}

/** Every stretch of wall in a set of rooms, merged along each line, classed as outside or partition. */
export function wallLines(rooms: Array<Pick<Room, 'x' | 'y' | 'w' | 'h'>>): WallLine[] {
  const snap = (v: number) => Math.round(v * 10) / 10;
  const lines = new Map<string, Array<{ a: number; b: number; side: number }>>();
  const put = (horiz: boolean, c: number, a: number, b: number, side: number) => {
    const k = `${horiz ? 'h' : 'v'}|${snap(c)}`;
    let arr = lines.get(k);
    if (!arr) lines.set(k, (arr = []));
    arr.push({ a: snap(a), b: snap(b), side });
  };
  for (const r of rooms) {
    put(true, r.y, r.x, r.x + r.w, 1);
    put(true, r.y + r.h, r.x, r.x + r.w, -1);
    put(false, r.x, r.y, r.y + r.h, 1);
    put(false, r.x + r.w, r.y, r.y + r.h, -1);
  }
  const out: WallLine[] = [];
  for (const [k, segs] of lines) {
    const horiz = k[0] === 'h';
    const c = Number(k.slice(2));
    const cuts = [...new Set(segs.flatMap((s) => [s.a, s.b]))].sort((p, q) => p - q);
    let cur: WallLine | null = null;
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1];
      const b = cuts[i];
      const mid = (a + b) / 2;
      const sides = new Set(segs.filter((s) => s.a <= mid && s.b >= mid).map((s) => s.side));
      if (!sides.size) {
        if (cur) out.push(cur);
        cur = null;
        continue;
      }
      const inner = sides.size > 1;
      const side = inner ? 0 : [...sides][0];
      if (cur && cur.inner === inner && cur.side === side && Math.abs(cur.b - a) < 0.01) cur.b = b;
      else {
        if (cur) out.push(cur);
        cur = { horiz, c, a, b, inner, side };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Windows along an outside wall: 1.2 m wide every 3.2 m, clear of the ends and the doors. */
export function windowSpans(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = a + 1.4; x + 1.2 < b - 1.0; x += 3.2) {
    const s = x;
    const e = x + 1.2;
    if (gaps.some(([g0, g1]) => e > g0 - 0.4 && s < g1 + 0.4)) continue;
    out.push([s, e]);
  }
  return out;
}

