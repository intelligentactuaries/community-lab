// Furniture that belongs together, shared by the flat map and the 3D view:
// chairs set close round one table share it (a household's dining table, a café
// table for four), and a living room's easy chairs face a low coffee table.
import type { Room } from '../../sim/types';

export interface TableTop {
  /** Centre and size (w along x, d along y), metres on the map. */
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface TableGroup extends TableTop {
  /** The chairs round it (spot ids); the first draws the table. */
  ids: string[];
  /** The chairs face each other across y (rows north and south of the table) or across x. */
  acrossY: boolean;
}

export interface RoomFurniture {
  tables: TableGroup[];
  /** Which table each grouped chair sits at. */
  byId: Map<string, TableGroup>;
  /** A coffee table among the easy chairs, if the room is a lounge. */
  coffee: TableTop | null;
}

/** Chairs this close (metres) sit at the same table. */
const LINK = 2.0;

const cache = new WeakMap<Room, RoomFurniture>();

/** A room where the 'seat' spots are easy chairs round a coffee table. */
export function isLounge(r: Room): boolean {
  return r.kind === 'living' || (r.kind === 'kitchen' && /living/i.test(r.name));
}

export function furnitureOf(r: Room): RoomFurniture {
  let f = cache.get(r);
  if (f) return f;
  const tables: TableGroup[] = [];
  const byId = new Map<string, TableGroup>();
  // Chairs at tables, linked when within reach of each other.
  const chairs = r.spots.filter((s) => s.kind === 'table');
  const seen = new Set<string>();
  for (const s of chairs) {
    if (seen.has(s.id)) continue;
    const group = [s];
    seen.add(s.id);
    for (let i = 0; i < group.length; i++) {
      for (const q of chairs) {
        if (seen.has(q.id)) continue;
        if (Math.hypot(q.x - group[i].x, q.y - group[i].y) <= LINK) {
          seen.add(q.id);
          group.push(q);
        }
      }
    }
    if (group.length < 2) continue;
    const xs = group.map((q) => q.x);
    const ys = group.map((q) => q.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const acrossY = y1 - y0 >= x1 - x0;
    // The table fills the space between the rows of chairs, a place's width per chair along it.
    const w = acrossY ? Math.max(0.9, x1 - x0 + 0.62) : Math.max(0.75, x1 - x0 - 0.9);
    const d = acrossY ? Math.max(0.75, y1 - y0 - 0.9) : Math.max(0.9, y1 - y0 + 0.62);
    const t: TableGroup = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w, d, ids: group.map((q) => q.id), acrossY };
    tables.push(t);
    for (const q of group) byId.set(q.id, t);
  }
  // A coffee table: in the middle of chairs set round it, or in front of a row of them.
  let coffee: TableTop | null = null;
  if (isLounge(r)) {
    const seats = r.spots.filter((s) => s.kind === 'seat');
    if (seats.length >= 2) {
      const xs = seats.map((q) => q.x);
      const ys = seats.map((q) => q.y);
      const sx = Math.max(...xs) - Math.min(...xs);
      const sy = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      if (sx > 0.8 && sy > 0.8) coffee = sy >= sx ? { x: cx, y: cy, w: Math.min(1.3, sx + 0.5), d: 0.55 } : { x: cx, y: cy, w: 0.55, d: Math.min(1.3, sy + 0.5) };
      else if (sy <= 0.8) {
        // A row along x: the table stands in front of it, toward the middle of the room.
        const dir = r.y + r.h / 2 >= cy ? 1 : -1;
        coffee = { x: cx, y: cy + dir * 1.25, w: Math.min(1.4, Math.max(0.9, sx * 0.45)), d: 0.55 };
      } else {
        const dir = r.x + r.w / 2 >= cx ? 1 : -1;
        coffee = { x: cx + dir * 1.25, y: cy, w: 0.55, d: Math.min(1.4, Math.max(0.9, sy * 0.45)) };
      }
    }
  }
  f = { tables, byId, coffee };
  cache.set(r, f);
  return f;
}
