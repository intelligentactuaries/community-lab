// Editing a plan: every change the builder makes, as a pure function from one
// plan to the next. Nothing is mutated, so the builder keeps the old plans for
// undo and the parts that did not change are shared between them.

import type { Facing } from '../layout/builders';
import type { Tier } from '../types';
import { ASSET, assetSize, type AssetSpec } from './assets';
import { SETBACK } from './prefabs';
import type { PlanBuilding, PlanCity, PlanRoad, PlanSettlement, WorldPlan } from './types';

export type Selection = { kind: 'building'; id: string } | { kind: 'road'; index: number } | { kind: 'settlement'; id: string } | { kind: 'city'; id: string } | { kind: 'track'; index: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const touch = (plan: WorldPlan, patch: Partial<WorldPlan>): WorldPlan => ({ ...plan, ...patch, meta: { ...plan.meta, updatedAt: new Date().toISOString() } });

export const FACINGS: Facing[] = ['N', 'E', 'S', 'W'];

// ─── Lookups ────────────────────────────────────────────────────────────────

export function buildingById(plan: WorldPlan, id: string): PlanBuilding | undefined {
  return plan.buildings.find((b) => b.id === id);
}

/** The settlement whose zone holds a point (the smallest, where zones nest). */
export function settlementAt(plan: WorldPlan, x: number, y: number): PlanSettlement | null {
  let best: PlanSettlement | null = null;
  for (const s of plan.settlements) {
    if (x < s.x || y < s.y || x > s.x + s.w || y > s.y + s.h) continue;
    if (!best || s.w * s.h < best.w * best.h) best = s;
  }
  return best;
}

export function nearestSettlement(plan: WorldPlan, x: number, y: number): PlanSettlement | null {
  let best: PlanSettlement | null = null;
  let bd = Infinity;
  for (const s of plan.settlements) {
    const dx = Math.max(s.x - x, 0, x - (s.x + s.w));
    const dy = Math.max(s.y - y, 0, y - (s.y + s.h));
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export function cityAtPoint(plan: WorldPlan, x: number, y: number): PlanCity | null {
  let best: PlanCity | null = null;
  for (const c of plan.cities) {
    if (x < c.x || y < c.y || x > c.x + c.w || y > c.y + c.h) continue;
    if (!best || c.w * c.h < best.w * best.h) best = c;
  }
  return best;
}

/** The road nearest a point: its index, the nearest point on it and the distance. */
export function nearestRoad(plan: WorldPlan, x: number, y: number): { index: number; x: number; y: number; d: number } | null {
  let best: { index: number; x: number; y: number; d: number } | null = null;
  plan.roads.forEach((r, index) => {
    const dx = r.x2 - r.x1;
    const dy = r.y2 - r.y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - r.x1) * dx + (y - r.y1) * dy) / len2));
    const px = r.x1 + t * dx;
    const py = r.y1 + t * dy;
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { index, x: px, y: py, d };
  });
  return best;
}

/** The building under a point (the smallest footprint, so a kiosk inside a park can be picked). */
export function buildingAt(plan: WorldPlan, x: number, y: number, pad = 0): PlanBuilding | null {
  let best: PlanBuilding | null = null;
  for (const b of plan.buildings) {
    if (x < b.x - pad || y < b.y - pad || x > b.x + b.w + pad || y > b.y + b.h + pad) continue;
    if (!best || b.w * b.h < best.w * best.h) best = b;
  }
  return best;
}

/** The road whose carriageway a point is on (within `tol` metres of its centre line). */
export function roadAt(plan: WorldPlan, x: number, y: number, tol: number): number | null {
  const n = nearestRoad(plan, x, y);
  if (!n) return null;
  const w = (plan.roads[n.index].width ?? 7) / 2;
  return n.d <= Math.max(w, tol) ? n.index : null;
}

// ─── Defaults for a new building ────────────────────────────────────────────

/** Which side a door should face: toward the nearest road. */
export function facingTowardRoad(plan: WorldPlan, r: Rect, allowed: Facing[] = FACINGS): Facing {
  const n = nearestRoad(plan, r.x + r.w / 2, r.y + r.h / 2);
  if (!n) return allowed.includes('S') ? 'S' : allowed[0];
  const dx = n.x - (r.x + r.w / 2);
  const dy = n.y - (r.y + r.h / 2);
  const pref: Facing[] = Math.abs(dx) / r.w > Math.abs(dy) / r.h ? (dx > 0 ? ['E', 'W', 'S', 'N'] : ['W', 'E', 'S', 'N']) : dy > 0 ? ['S', 'N', 'E', 'W'] : ['N', 'S', 'E', 'W'];
  return pref.find((f) => allowed.includes(f)) ?? allowed[0];
}

export function nextPlot(plan: WorldPlan): number {
  let max = 0;
  for (const b of plan.buildings) if (b.plot && b.plot > max) max = b.plot;
  return max + 1;
}

export function freshBuildingId(plan: WorldPlan, prefix: string): string {
  const taken = new Set(plan.buildings.map((b) => b.id));
  let n = plan.buildings.length + 1;
  for (;;) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
    n++;
  }
}

/** A name for a new building: the settlement's name and what it is ("Thembisa Clinic"); a house is its plot. */
export function defaultName(plan: WorldPlan, a: AssetSpec, settlement: string, plot?: number | null): string {
  if (a.kind === 'house') return `Plot ${plot ?? nextPlot(plan)}`;
  const s = plan.settlements.find((x) => x.id === settlement);
  const where = s && s.tier !== 'civic' ? s.short || s.name : plan.cities.find((c) => c.id === s?.city)?.short ?? '';
  const base = a.id === 'bank' ? 'Mutual Bank branch' : a.id === 'busstop' ? 'bus stop' : a.label;
  return where ? `${where} ${base}` : base;
}

/** A new building of an asset at a point (its middle), facing the nearest road unless told otherwise. */
export function newBuilding(plan: WorldPlan, assetId: string, cx: number, cy: number, opts: { facing?: Facing; options?: Record<string, string | number | boolean>; name?: string } = {}): PlanBuilding {
  const a = ASSET[assetId];
  let facing = opts.facing ?? 'S';
  let size = assetSize(a, { ...a.options?.reduce((o, x) => ({ ...o, [x.key]: x.default }), {}), ...opts.options, facing });
  if (!opts.facing) {
    facing = facingTowardRoad(plan, { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h }, a.facings);
    size = assetSize(a, { ...opts.options, facing });
  }
  const x = Math.round(cx - size.w / 2);
  const y = Math.round(cy - size.h / 2);
  const s = settlementAt(plan, cx, cy) ?? nearestSettlement(plan, cx, cy);
  const settlement = s?.id ?? plan.settlements[0]?.id ?? 'settlement';
  const plot = a.kind === 'house' ? nextPlot(plan) : undefined;
  const options = a.options?.length ? Object.fromEntries(a.options.map((o) => [o.key, opts.options?.[o.key] ?? o.default])) : undefined;
  return {
    id: freshBuildingId(plan, a.kind === 'house' ? 'house' : a.id),
    asset: a.id,
    name: opts.name ?? defaultName(plan, a, settlement, plot),
    settlement,
    x,
    y,
    w: size.w,
    h: size.h,
    facing,
    ...(plot ? { plot } : {}),
    ...(options ? { options } : {}),
  };
}

/** Where a building would sit with its door on the nearest road, set back as the province sets its plots. */
export function snapToRoad(plan: WorldPlan, b: PlanBuilding, reach = 40): { x: number; y: number; facing: Facing } | null {
  const n = nearestRoad(plan, b.x + b.w / 2, b.y + b.h / 2);
  if (!n || n.d > reach + Math.max(b.w, b.h) / 2) return null;
  const r = plan.roads[n.index];
  const horizontal = r.y1 === r.y2;
  const a = ASSET[b.asset];
  const gap = a?.kind === 'house' ? SETBACK : (r.width ?? 7) / 2 + 4;
  if (horizontal) {
    const above = b.y + b.h / 2 < r.y1;
    const facing: Facing = above ? 'S' : 'N';
    if (a && !a.facings.includes(facing)) return null;
    const size = a ? assetSize(a, { ...b.options, facing }) : { w: b.w, h: b.h };
    return { x: b.x + (b.w - size.w) / 2, y: above ? r.y1 - gap - size.h : r.y1 + gap, facing };
  }
  const left = b.x + b.w / 2 < r.x1;
  const facing: Facing = left ? 'E' : 'W';
  if (a && !a.facings.includes(facing)) return null;
  const size = a ? assetSize(a, { ...b.options, facing }) : { w: b.w, h: b.h };
  return { x: left ? r.x1 - gap - size.w : r.x1 + gap, y: b.y + (b.h - size.h) / 2, facing };
}

// ─── Buildings ──────────────────────────────────────────────────────────────

export function addBuildings(plan: WorldPlan, bs: PlanBuilding[]): WorldPlan {
  return touch(plan, { buildings: [...plan.buildings, ...bs] });
}

export function updateBuilding(plan: WorldPlan, id: string, patch: Partial<PlanBuilding>): WorldPlan {
  return touch(plan, { buildings: plan.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
}

/** Move buildings by an offset; each keeps its settlement unless it lands in another's zone. */
export function moveBuildings(plan: WorldPlan, ids: string[], dx: number, dy: number): WorldPlan {
  if (!dx && !dy) return plan;
  const set = new Set(ids);
  return touch(plan, {
    buildings: plan.buildings.map((b) => {
      if (!set.has(b.id)) return b;
      const x = Math.round(b.x + dx);
      const y = Math.round(b.y + dy);
      const zone = settlementAt(plan, x + b.w / 2, y + b.h / 2);
      return { ...b, x, y, settlement: zone?.id ?? b.settlement };
    }),
  });
}

/** Without its hand-drawn interior: from now on its asset lays the rooms out (a raw building turned or resized). */
function redraw(b: PlanBuilding): PlanBuilding {
  if (!b.raw) return b;
  const { raw: _raw, ...rest } = b;
  void _raw;
  return rest;
}

/** Turn a building's door to the next allowed side (a house's plot turns with it). */
export function turnBuilding(plan: WorldPlan, id: string, to?: Facing): WorldPlan {
  const b = buildingById(plan, id);
  if (!b) return plan;
  const a = ASSET[b.asset];
  const allowed = a?.facings ?? FACINGS;
  const next = to ?? allowed[(allowed.indexOf(b.facing) + 1) % allowed.length] ?? b.facing;
  if (next === b.facing) return plan;
  const size = a?.fixedSize || a?.sizeFor ? assetSize(a, { ...b.options, facing: next }) : { w: b.w, h: b.h };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return updateBuilding(plan, id, { ...redraw(b), facing: next, w: size.w, h: size.h, x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2) });
}

/** Resize within the asset's bounds (a fixed footprint does not stretch). */
export function resizeBuilding(plan: WorldPlan, id: string, r: Rect): WorldPlan {
  const b = buildingById(plan, id);
  if (!b) return plan;
  const a = ASSET[b.asset];
  if (!a || a.fixedSize) return plan;
  const w = Math.round(Math.max(a.min.w, Math.min(a.max.w, r.w)));
  const h = Math.round(Math.max(a.min.h, Math.min(a.max.h, r.h)));
  const x = Math.round(r.x + (r.w - w) * (r.x !== b.x ? 1 : 0));
  const y = Math.round(r.y + (r.h - h) * (r.y !== b.y ? 1 : 0));
  return updateBuilding(plan, id, { ...redraw(b), x, y, w, h });
}

/** Change an asset option (a church's size resizes it about its middle). */
export function setOption(plan: WorldPlan, id: string, key: string, value: string | number | boolean): WorldPlan {
  const b = buildingById(plan, id);
  if (!b) return plan;
  const a = ASSET[b.asset];
  const options = { ...b.options, [key]: value };
  let patch: Partial<PlanBuilding> = { ...redraw(b), options };
  if (a?.options?.find((o) => o.key === key)?.resizes && a.sizeFor) {
    const sz = a.sizeFor({ ...options, facing: b.facing });
    patch = { ...patch, w: sz.w, h: sz.h, x: Math.round(b.x + (b.w - sz.w) / 2), y: Math.round(b.y + (b.h - sz.h) / 2) };
  }
  return updateBuilding(plan, id, patch);
}

/** Remove buildings, and every mention of them (bus lines, stated institutions are pruned when the plan is derived). */
export function removeBuildings(plan: WorldPlan, ids: string[]): WorldPlan {
  const set = new Set(ids);
  return touch(plan, {
    buildings: plan.buildings.filter((b) => !set.has(b.id)),
    ...(plan.busLines ? { busLines: plan.busLines.map((l) => ({ ...l, stops: l.stops.filter((s) => !set.has(s)) })).filter((l) => l.stops.length >= 2) } : {}),
  });
}

/** Copies of buildings, offset, with fresh ids and plots. */
export function duplicateBuildings(plan: WorldPlan, ids: string[], dx = 20, dy = 20): { plan: WorldPlan; ids: string[] } {
  let p = plan;
  const out: string[] = [];
  for (const id of ids) {
    const b = buildingById(plan, id);
    if (!b) continue;
    const a = ASSET[b.asset];
    const plot = a?.kind === 'house' ? nextPlot(p) : undefined;
    const nb: PlanBuilding = { ...redraw(b), id: freshBuildingId(p, a?.kind === 'house' ? 'house' : b.asset), x: b.x + dx, y: b.y + dy, ...(plot ? { plot, name: `Plot ${plot}` } : { name: `${b.name} (copy)` }) };
    p = addBuildings(p, [nb]);
    out.push(nb.id);
  }
  return { plan: p, ids: out };
}

// ─── Roads ──────────────────────────────────────────────────────────────────

/** Snap a road's free end to the axis of its start (roads run north–south or east–west). */
export function axisLock(x1: number, y1: number, x2: number, y2: number): { x2: number; y2: number } {
  return Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? { x2, y2: y1 } : { x2: x1, y2 };
}

/** A point snapped to the nearest road end or road line within `tol` metres (so new roads join the network). */
export function snapToNetwork(plan: WorldPlan, x: number, y: number, tol: number): { x: number; y: number; snapped: boolean } {
  let best: { x: number; y: number; d: number } | null = null;
  for (const r of plan.roads) {
    for (const [px, py] of [[r.x1, r.y1], [r.x2, r.y2]] as Array<[number, number]>) {
      const d = Math.hypot(px - x, py - y);
      if (d <= tol && (!best || d < best.d)) best = { x: px, y: py, d };
    }
  }
  if (best) return { x: best.x, y: best.y, snapped: true };
  const n = nearestRoad(plan, x, y);
  if (n && n.d <= tol) return { x: Math.round(n.x), y: Math.round(n.y), snapped: true };
  return { x, y, snapped: false };
}

export function addRoad(plan: WorldPlan, r: PlanRoad): WorldPlan {
  if (r.x1 === r.x2 && r.y1 === r.y2) return plan;
  return touch(plan, { roads: [...plan.roads, r] });
}

export function updateRoad(plan: WorldPlan, index: number, patch: Partial<PlanRoad>): WorldPlan {
  return touch(plan, { roads: plan.roads.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
}

export function removeRoads(plan: WorldPlan, indices: number[]): WorldPlan {
  const set = new Set(indices);
  return touch(plan, { roads: plan.roads.filter((_, i) => !set.has(i)) });
}

/** A name for a new road that no other road has. */
export function freshRoadName(plan: WorldPlan, horizontal: boolean): string {
  const streets = ['Acacia', 'Baobab', 'Cedar', 'Daisy', 'Erica', 'Fynbos', 'Gardenia', 'Hibiscus', 'Ironwood', 'Jacaranda', 'Kiaat', 'Lily', 'Marula', 'Nandi', 'Olive', 'Protea', 'Quince', 'Rooibos', 'Strelitzia', 'Tamboti', 'Umdoni', 'Vygie', 'Waterberry', 'Yellowwood', 'Zinnia'];
  const kinds = horizontal ? ['Street', 'Road', 'Avenue'] : ['Link', 'Lane', 'Drive'];
  const used = new Set(plan.roads.map((r) => r.name));
  for (const k of kinds) for (const s of streets) if (!used.has(`${s} ${k}`)) return `${s} ${k}`;
  return `Road ${plan.roads.length + 1}`;
}

// ─── Settlements and cities ─────────────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';

function freshPlaceId(taken: Set<string>, name: string): string {
  const base = slug(name);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function addSettlement(plan: WorldPlan, r: Rect, opts: { name?: string; tier?: Tier; city?: string } = {}): { plan: WorldPlan; id: string } {
  const taken = new Set([...plan.settlements.map((s) => s.id), ...plan.cities.map((c) => c.id)]);
  const n = plan.settlements.length + 1;
  const name = opts.name ?? `Settlement ${n}`;
  const id = freshPlaceId(taken, name);
  const city = opts.city ?? cityAtPoint(plan, r.x + r.w / 2, r.y + r.h / 2)?.id ?? plan.cities[0]?.id ?? 'town';
  const s: PlanSettlement = { id, city, name, short: name.split(' ')[0], tier: opts.tier ?? 'middle', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  // Buildings now inside the new zone move into it.
  const inside = (b: PlanBuilding) => b.x + b.w / 2 >= s.x && b.x + b.w / 2 <= s.x + s.w && b.y + b.h / 2 >= s.y && b.y + b.h / 2 <= s.y + s.h;
  return { plan: touch(plan, { settlements: [...plan.settlements, s], buildings: plan.buildings.map((b) => (inside(b) ? { ...b, settlement: smaller(plan, b, s) } : b)) }), id };
}

/** Of a building's current zone and a new one, the smaller holds it. */
function smaller(plan: WorldPlan, b: PlanBuilding, s: PlanSettlement): string {
  const cur = plan.settlements.find((x) => x.id === b.settlement);
  if (!cur) return s.id;
  const curHolds = b.x + b.w / 2 >= cur.x && b.x + b.w / 2 <= cur.x + cur.w && b.y + b.h / 2 >= cur.y && b.y + b.h / 2 <= cur.y + cur.h;
  return curHolds && cur.w * cur.h <= s.w * s.h ? cur.id : s.id;
}

export function updateSettlement(plan: WorldPlan, id: string, patch: Partial<PlanSettlement>): WorldPlan {
  return touch(plan, { settlements: plan.settlements.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

/** Remove a settlement: its buildings join whichever zone now holds them (or the nearest). */
export function removeSettlement(plan: WorldPlan, id: string): WorldPlan {
  const rest = plan.settlements.filter((s) => s.id !== id);
  if (!rest.length) return plan;
  const p2 = { ...plan, settlements: rest };
  return touch(plan, {
    settlements: rest,
    buildings: plan.buildings.map((b) => (b.settlement === id ? { ...b, settlement: (settlementAt(p2, b.x + b.w / 2, b.y + b.h / 2) ?? nearestSettlement(p2, b.x + b.w / 2, b.y + b.h / 2))!.id } : b)),
  });
}

export function addCity(plan: WorldPlan, r: Rect, opts: { name?: string; kind?: PlanCity['kind'] } = {}): { plan: WorldPlan; id: string } {
  const taken = new Set([...plan.settlements.map((s) => s.id), ...plan.cities.map((c) => c.id)]);
  const name = opts.name ?? `City ${plan.cities.length + 1}`;
  const id = freshPlaceId(taken, name);
  const c: PlanCity = { id, name, short: name.split(' ')[0], kind: opts.kind ?? 'city', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  // Settlements whose middle is inside the new city's box join it.
  return {
    plan: touch(plan, { cities: [...plan.cities, c], settlements: plan.settlements.map((s) => (s.x + s.w / 2 >= c.x && s.x + s.w / 2 <= c.x + c.w && s.y + s.h / 2 >= c.y && s.y + s.h / 2 <= c.y + c.h ? { ...s, city: id } : s)) }),
    id,
  };
}

export function updateCity(plan: WorldPlan, id: string, patch: Partial<PlanCity>): WorldPlan {
  return touch(plan, { cities: plan.cities.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

/** Remove a city: its settlements join the nearest other city. */
export function removeCity(plan: WorldPlan, id: string): WorldPlan {
  const rest = plan.cities.filter((c) => c.id !== id);
  if (!rest.length) return plan;
  const near = (s: PlanSettlement) => rest.reduce((a, c) => (Math.hypot(c.x + c.w / 2 - s.x - s.w / 2, c.y + c.h / 2 - s.y - s.h / 2) < Math.hypot(a.x + a.w / 2 - s.x - s.w / 2, a.y + a.h / 2 - s.y - s.h / 2) ? c : a), rest[0]);
  return touch(plan, { cities: rest, settlements: plan.settlements.map((s) => (s.city === id ? { ...s, city: near(s).id } : s)) });
}

// ─── The Hyperline ──────────────────────────────────────────────────────────

export function setTrack(plan: WorldPlan, pts: Array<{ x: number; y: number }>): WorldPlan {
  return touch(plan, { track: pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) });
}

// ─── The world ──────────────────────────────────────────────────────────────

export function updateWorld(plan: WorldPlan, patch: Partial<Pick<WorldPlan, 'name' | 'region' | 'description' | 'size' | 'baseline' | 'defaultSettlement'>>): WorldPlan {
  return touch(plan, patch);
}

/** Everything inside a rectangle (for a marquee selection). */
export function buildingsIn(plan: WorldPlan, r: Rect): string[] {
  return plan.buildings.filter((b) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h).map((b) => b.id);
}
