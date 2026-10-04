// Where vehicles stop. Every building has a row of kerbside bays along the
// road in front of it, on the verge (at a bus stop, a lay-by off the
// carriageway, so a bus at the stop never stands in the traffic's way). A
// vehicle arriving takes the free bay nearest the entrance, parked parallel to
// the road on the left-hand side as South Africans drive. A bay is free when
// no other vehicle stands there or is on its way to it, so no two vehicles
// stand in one place. At home, a household's cars stand side by side in the
// yard, and a rank's taxis in rows; where a house's fence runs along the kerb,
// with no verge to park on, a visitor draws into the yard beside the family's
// cars. Nobody parks across a gate: whoever lives or works there drives in and
// out by it.
import type { Segment } from './layout/plots';
import type { Building, Vehicle, World } from './types';
import { doorOf, nearestRoadPoint, roadSegments, roomByKind } from './world';

/** Length and width of each kind (the 3D models' own: see vehicles3d.ts kindModel). */
export const VEHICLE_SIZE: Record<Vehicle['kind'], [number, number]> = {
  car: [4.5, 1.78],
  ride: [4.5, 1.78],
  police: [4.5, 1.78],
  taxi: [5.38, 1.88],
  bus: [11.8, 2.5],
  bakkie: [5.3, 1.85],
  ambulance: [6.1, 2.0],
  train: [42, 3.3],
  plane: [30, 4],
};

/** Room left between parked vehicles: nose to tail, and side to side. */
const GAP_LONG = 1.2;
const GAP_SIDE = 0.6;

export interface Bay {
  x: number;
  y: number;
  heading: number;
}

/** A building's row: in front of the entrance, along and out from the road, how far it may run. */
interface Row {
  /** The road point in front of the entrance, the road, its width, and the entrance's distance from it. */
  rx: number;
  ry: number;
  seg: Segment;
  w: number;
  d: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  lo: number;
  hi: number;
  /** Facing along the road with the bay on the vehicle's left. */
  heading: number;
}

const rows = new WeakMap<Building, Row>();

function rowOf(b: Building): Row {
  let r = rows.get(b);
  if (r) return r;
  const np = nearestRoadPoint(b.entrance.x, b.entrance.y);
  const s = np.seg;
  const w = s.width ?? 7;
  const horiz = Math.abs(s.y1 - s.y2) < Math.abs(s.x1 - s.x2);
  const tx = horiz ? 1 : 0;
  const ty = horiz ? 0 : 1;
  const nx = horiz ? 0 : Math.sign(b.entrance.x - np.x) || 1;
  const ny = horiz ? Math.sign(b.entrance.y - np.y) || 1 : 0;
  // Along the segment from the entrance's projection, short of its ends (the junctions).
  const a0 = horiz ? Math.min(s.x1, s.x2) - np.x : Math.min(s.y1, s.y2) - np.y;
  const a1 = horiz ? Math.max(s.x1, s.x2) - np.x : Math.max(s.y1, s.y2) - np.y;
  const margin = w / 2 + 6;
  let lo = a0 + margin;
  let hi = a1 - margin;
  if (lo > 0) lo = Math.min(0, a0 + 2);
  if (hi < 0) hi = Math.max(0, a1 - 2);
  r = { rx: np.x, ry: np.y, seg: s, w, d: np.d, tx, ty, nx, ny, lo, hi, heading: Math.atan2(nx, -ny) };
  rows.set(b, r);
  return r;
}

/** From the road's centre line to the middle of a bay: just clear of the carriageway, or further out on a wide verge. */
function offset(r: Row, kind: Vehicle['kind']): number {
  return Math.max(r.w / 2 + Math.max(1.4, VEHICLE_SIZE[kind][1] / 2 + 0.2), Math.min(9, r.d - 3));
}

/** Where a vehicle stands or is bound: its parked place, or the end of its way with the heading it will park at. */
function standings(world: World, selfId: string | null): Array<{ x: number; y: number; h: number; l: number; w: number }> {
  const out: Array<{ x: number; y: number; h: number; l: number; w: number }> = [];
  for (const id in world.vehicles) {
    if (id === selfId) continue;
    const u = world.vehicles[id];
    if (u.kind === 'train' || u.kind === 'plane' || u.airborne) continue;
    const [l, w] = VEHICLE_SIZE[u.kind];
    // Where it stands (a vehicle pulling out may be held in its bay a while), and where it is bound.
    out.push({ x: u.x, y: u.y, h: u.heading, l, w });
    if (u.moving && u.path.length) {
      const e = u.path[u.path.length - 1];
      out.push({ x: e.x, y: e.y, h: u.parkHeading ?? u.heading, l, w });
    }
  }
  return out;
}

/** Two rectangles (centre, heading, length, width) overlap: separating axes. */
export function rectsOverlap(ax: number, ay: number, ah: number, al: number, aw: number, bx: number, by: number, bh: number, bl: number, bw: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx * dx + dy * dy > ((al + bl) / 2 + (aw + bw) / 2) ** 2) return false;
  const axes = [
    [Math.cos(ah), Math.sin(ah)],
    [-Math.sin(ah), Math.cos(ah)],
    [Math.cos(bh), Math.sin(bh)],
    [-Math.sin(bh), Math.cos(bh)],
  ];
  for (const [ux, uy] of axes) {
    const ra = (al / 2) * Math.abs(Math.cos(ah) * ux + Math.sin(ah) * uy) + (aw / 2) * Math.abs(-Math.sin(ah) * ux + Math.cos(ah) * uy);
    const rb = (bl / 2) * Math.abs(Math.cos(bh) * ux + Math.sin(bh) * uy) + (bw / 2) * Math.abs(-Math.sin(bh) * ux + Math.cos(bh) * uy);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}

/** A bay (centre, and its half-extents east-west and north-south) clear of every road but its own (at a corner the row would run out into the crossing street). */
function offRoads(x: number, y: number, hx: number, hy: number, own: Segment): boolean {
  for (const s of roadSegments()) {
    if (s === own) continue;
    const half = (s.width ?? 7) / 2 + 0.3;
    const minX = Math.min(s.x1, s.x2) - half;
    const maxX = Math.max(s.x1, s.x2) + half;
    const minY = Math.min(s.y1, s.y2) - half;
    const maxY = Math.max(s.y1, s.y2) + half;
    if (x + hx > minX && x - hx < maxX && y + hy > minY && y - hy < maxY) return false;
  }
  return true;
}

/** Where a household's cars stand in the yard (the family car here, the others beside it: see yardSlot). */
export function parkingSpot(house: Building): { x: number; y: number } {
  const yard = roomByKind(house, 'yard');
  const g = yard?.spots.find((s) => s.kind === 'generic');
  return g ? { x: g.x, y: g.y } : doorOf(house);
}

/**
 * Bays inside a yard, nearest the gate first: the terminus's bus bays; and at a house with no verge to park on, the
 * family's row of places in the yard (a visitor takes one the family's own cars do not come home to).
 */
const yards = new WeakMap<Building, Bay[]>();
function yardBays(b: Building, kind: Vehicle['kind']): Bay[] | null {
  const depot = kind === 'bus' && b.kind === 'terminus';
  if (!depot && !(b.kind === 'house' && kind !== 'bus' && fenced(b, kind))) return null;
  let out = yards.get(b);
  if (out) return out;
  out = [];
  if (depot) {
    // One row along the middle of the depot, so a bus pulls out without passing through another's bay.
    const yard = b.rooms.find((r) => r.kind === 'garage');
    if (!yard) return null;
    const [l] = VEHICLE_SIZE[kind];
    for (let x = yard.x + l / 2 + 3; x + l / 2 + 3 <= yard.x + yard.w; x += l + 3) out.push({ x, y: yard.y + yard.h / 2, heading: 0 });
  } else {
    const yard = b.rooms.find((r) => r.kind === 'yard');
    if (!yard) return null;
    const spot = parkingSpot(b);
    const g = b.entrance;
    const inward = Math.sign(b.y + b.h / 2 - g.y) || 1;
    // Facing east like the family's cars, clear of the fence and the house, and of the way in from the gate.
    for (let k = 0; k <= 16; k++) {
      const p = yardSlot(spot, k);
      if (p.x - 3 < yard.x || p.x + 3 > yard.x + yard.w || p.y - 1.5 < yard.y || p.y + 1.5 > yard.y + yard.h) continue;
      if (Math.abs(p.x - g.x) < 5 && (p.y - g.y) * inward < 12) continue;
      out.push({ x: p.x, y: p.y, heading: 0 });
    }
  }
  const g = b.entrance;
  out.sort((p, q) => Math.hypot(p.x - g.x, p.y - g.y) - Math.hypot(q.x - g.x, q.y - g.y));
  yards.set(b, out);
  return out;
}

/** A house whose fence runs along the kerb: no verge wide enough for a car between the road and the plot. */
function fenced(b: Building, kind: Vehicle['kind']): boolean {
  const r = rowOf(b);
  return r.d - r.w / 2 < VEHICLE_SIZE[kind][1] + 0.6;
}

/** The house whose yard (x, y) is in, if any. */
function yardHouse(world: World, x: number, y: number): Building | null {
  for (const id in world.buildings) {
    const b = world.buildings[id];
    if (b.kind !== 'house' || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    const yard = roomByKind(b, 'yard');
    return yard && x >= yard.x && x <= yard.x + yard.w && y >= yard.y && y <= yard.y + yard.h ? b : null;
  }
  return null;
}

/**
 * From a house's gate to a place in its yard: in through the gate, round the west end of the row of parked cars,
 * then in beside them facing east, so no car drives through another.
 */
export function yardWayIn(b: Building, to: { x: number; y: number }): Array<{ x: number; y: number }> {
  const g = b.entrance;
  const inward = Math.sign(b.y + b.h / 2 - g.y) || 1;
  return [{ x: g.x, y: g.y }, { x: g.x, y: g.y + inward * 6 }, { x: to.x - 8, y: to.y }, { x: to.x, y: to.y }];
}

/** Out of a house's yard from a place in it, the same way back to the gate (nothing if (x, y) is not in a yard). */
export function yardWayOut(world: World, x: number, y: number): Array<{ x: number; y: number }> {
  const b = yardHouse(world, x, y);
  return b ? yardWayIn(b, { x, y }).slice(0, -1).reverse() : [];
}

/** The first place in a house's yard that no vehicle stands in or comes home to (for a car new to the household). */
export function freeYardSlot(world: World, house: Building, selfId: string | null = null): { x: number; y: number } {
  const spot = parkingSpot(house);
  for (let k = 0; ; k++) {
    const p = yardSlot(spot, k);
    let taken = false;
    for (const id in world.vehicles) {
      const u = world.vehicles[id];
      if (id === selfId || u.kind === 'train' || u.kind === 'plane') continue;
      if (Math.hypot(u.homeX - p.x, u.homeY - p.y) < 1 || Math.hypot(u.x - p.x, u.y - p.y) < 2) {
        taken = true;
        break;
      }
    }
    if (!taken || k >= 24) return p;
  }
}

/** The free bay at a building nearest its entrance, for a vehicle of this kind (selfId: the vehicle itself, if it exists). */
export function bayFor(world: World, b: Building, kind: Vehicle['kind'], selfId: string | null): Bay {
  const r = rowOf(b);
  const off = offset(r, kind);
  const [l, w] = VEHICLE_SIZE[kind];
  const others = standings(world, selfId);
  const yard = yardBays(b, kind);
  if (yard) {
    // Nor where another vehicle comes home to (a family's car away for the day, the terminus's taxis).
    const homes = Object.values(world.vehicles).filter((u) => u.id !== selfId && u.kind !== 'train' && u.kind !== 'plane' && Math.abs(u.homeX - b.x - b.w / 2) < b.w && Math.abs(u.homeY - b.y - b.h / 2) < b.h);
    for (const p of yard) {
      if (homes.some((u) => rectsOverlap(p.x, p.y, p.heading, l + GAP_LONG, w + GAP_SIDE, u.homeX, u.homeY, u.homeHeading ?? 0, ...VEHICLE_SIZE[u.kind]))) continue;
      if (!others.some((o) => rectsOverlap(p.x, p.y, p.heading, l + GAP_LONG, w + GAP_SIDE, o.x, o.y, o.h, o.l, o.w))) return { ...p };
    }
  }
  // Along this building's stretch of road first; if that is full (or too short, beside a junction), further along
  // the verge, still clear of other roads.
  for (const within of [true, false]) {
    for (let k = 0; k <= 160; k++) {
      const a = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.75;
      if (within && (a < r.lo + l / 2 || a > r.hi - l / 2)) continue;
      // Not across the gate.
      if (Math.abs(a) < l / 2 + 2) continue;
      const x = r.rx + r.nx * off + r.tx * a;
      const y = r.ry + r.ny * off + r.ty * a;
      // (Not reaching onto another road.)
      if (!offRoads(x, y, r.tx ? l / 2 : w / 2, r.tx ? w / 2 : l / 2, r.seg)) continue;
      let clear = true;
      for (const o of others) {
        if (rectsOverlap(x, y, r.heading, l + GAP_LONG, w + GAP_SIDE, o.x, o.y, o.h, o.l, o.w)) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, y, heading: r.heading };
    }
  }
  return { x: r.rx + r.nx * off, y: r.ry + r.ny * off, heading: r.heading };
}

/**
 * The last stretch of a drive to a building: along the road to beside the bay, then into it. Sets the heading the
 * vehicle will stand at when it gets there: facing the way it came along the road (arrive: its direction on the
 * last stretch), or, not knowing, with the bay on its left.
 */
export function parkPath(world: World, v: Vehicle, b: Building, arrive: { x: number; y: number } | null = null): Array<{ x: number; y: number }> {
  const bay = bayFor(world, b, v.kind, v.id);
  const r = rowOf(b);
  if (yardBays(b, v.kind)?.some((p) => p.x === bay.x && p.y === bay.y)) {
    // Into the yard by its gate.
    v.parkHeading = bay.heading;
    return b.kind === 'house' ? yardWayIn(b, bay) : [{ x: b.entrance.x, y: b.entrance.y }, { x: bay.x, y: bay.y }];
  }
  const along = arrive ? arrive.x * r.tx + arrive.y * r.ty : 0;
  v.parkHeading = Math.abs(along) > 0.5 ? Math.atan2(r.ty * Math.sign(along), r.tx * Math.sign(along)) : bay.heading;
  const a = (bay.x - r.rx) * r.tx + (bay.y - r.ry) * r.ty;
  // Beside the bay in the lane it drives in (on its left; the far lane when the building is on its right), then in.
  let lx = r.nx;
  let ly = r.ny;
  if (Math.abs(along) > 0.5) {
    const dx = Math.sign(along) * r.tx;
    const dy = Math.sign(along) * r.ty;
    lx = dy;
    ly = -dx;
  }
  return [{ x: r.rx + r.tx * a + (lx * r.w) / 4, y: r.ry + r.ty * a + (ly * r.w) / 4 }, { x: bay.x, y: bay.y }];
}

/** A household's k-th car in its yard: facing along the plot (east), side by side 3.2 m apart from the parking spot. */
export function yardSlot(spot: { x: number; y: number }, k: number): { x: number; y: number } {
  return { x: spot.x, y: spot.y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3.2 };
}
