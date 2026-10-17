// The world the engine runs in, read from the installed atlas (atlas.ts): its
// cities and settlements, the road network and shortest-path routing over it,
// the landmarks each settlement uses, the public transport. All coordinates
// are metres.
//
// The exports keep the shape they had when the province was the only world:
// the lists and maps below are filled in place whenever a different atlas is
// installed, and the names that hold a single value are live bindings. The
// built-in Unity Province (layout/province.ts) is installed at load, so code
// that never builds a Simulation (tests, the renderer before a run) sees it.

import { activeAtlas, installAtlas, landmarkForHouseIn, landmarkIn, onAtlas, type Atlas, type BusLine, type CitySpec, type CommunitySpec, type ExitSpec, type LandmarkKind, type RunwaySpec, type StationSpec } from './atlas';
import { provinceAtlas } from './layout/province';
import type { PlotSpec, Segment } from './layout/plots';
import { cumulative, distanceAlong, pointAlong } from './track';
import type { Building, CityId, CommunityId, Room, RoadEdge, RoadNode, Tier } from './types';

export { PLOT_H, PLOT_W, houseRooms } from './layout/plots';
export type { PlotSpec } from './layout/plots';
export { TRACK_WIDTH } from './layout/hyperline';
export type { BusLine, CitySpec, CommunitySpec, ExitSpec, LandmarkKind, RunwaySpec, StationSpec } from './atlas';
export { activeAtlas, atlasEpoch, installAtlas } from './atlas';

// ─── The registries (filled from the installed atlas) ───────────────────────

export let WORLD_W = 0;
export let WORLD_H = 0;

export const CITIES: CitySpec[] = [];
export const CITY: Record<CityId, CitySpec> = {};
export const COMMUNITIES: CommunitySpec[] = [];
export const COMMUNITY: Record<CommunityId, CommunitySpec> = {};
/** The settlements with households, in seating order. */
export const RESIDENTIAL: CommunityId[] = [];

/** The Hyperline's guideway and stations (empty where the world has none). */
export const TRACK: Array<{ x: number; y: number }> = [];
export const TRACK_CUM: number[] = [];
export let TRACK_LENGTH = 0;
export const STATIONS: StationSpec[] = [];
export const STATION_IDS: string[] = [];

/** The runway centreline and thresholds (meaningful only where the world has an airport). */
export const RUNWAY: RunwaySpec = { x: 0, north: 0, south: 0, taxiwayX: 0, taxiwayY: 0 };

/** Exit / entry points at the edge of the map (migrants, intruders, the long-distance taxis) with their road nodes. */
export const EXITS: ExitSpec[] = [];

/** Every church (by settlement), every clinic with a ward, every court, police station and taxi rank. */
export const CHURCH_IDS: string[] = [];
export const CLINIC_IDS: string[] = [];
export const COURT_IDS: string[] = [];
export const POLICE_IDS: string[] = [];
export const COUNCIL_IDS: Record<CityId, string | null> = {};
export const TAXI_RANK_IDS: string[] = [];
/** Where ambulances stand. */
export const AMBULANCE_BASES: Array<{ id: string; n: number }> = [];
export let CENTRAL_HOSPITAL: string | null = null;
export let AIRPORT_TERMINAL: string | null = null;
export let BUS_HUB: string | null = null;

export const BUS_LINES: BusLine[] = [];
export const BUS_LINE: Record<string, BusLine> = {};

function refill<T>(arr: T[], items: readonly T[]): void {
  arr.length = 0;
  for (const x of items) arr.push(x);
}
function refillMap<T>(map: Record<string, T>, entries: Array<[string, T]>): void {
  for (const k of Object.keys(map)) delete map[k];
  for (const [k, v] of entries) map[k] = v;
}

onAtlas((a: Atlas) => {
  WORLD_W = a.width;
  WORLD_H = a.height;
  refill(CITIES, a.cities);
  refillMap(CITY, a.cities.map((c) => [c.id, c]));
  refill(COMMUNITIES, a.communities);
  refillMap(COMMUNITY, a.communities.map((c) => [c.id, c]));
  refill(RESIDENTIAL, a.communities.filter((c) => c.tier !== 'civic').map((c) => c.id));
  refill(TRACK, a.track);
  refill(TRACK_CUM, cumulative(a.track));
  TRACK_LENGTH = TRACK_CUM[TRACK_CUM.length - 1] ?? 0;
  refill(STATIONS, a.stations);
  refill(STATION_IDS, a.stations.map((s) => s.id));
  Object.assign(RUNWAY, a.runway ?? { x: 0, north: 0, south: 0, taxiwayX: 0, taxiwayY: 0 });
  refill(EXITS, a.exits);
  refill(CHURCH_IDS, a.churchIds);
  refill(CLINIC_IDS, a.clinicIds);
  refill(COURT_IDS, a.courtIds);
  refill(POLICE_IDS, a.policeIds);
  refillMap(COUNCIL_IDS, Object.entries(a.councilIds));
  refill(TAXI_RANK_IDS, a.taxiRankIds);
  refill(AMBULANCE_BASES, a.ambulanceBases);
  CENTRAL_HOSPITAL = a.centralHospital;
  AIRPORT_TERMINAL = a.airportTerminal;
  BUS_HUB = a.busHub;
  refill(BUS_LINES, a.busLines);
  refillMap(BUS_LINE, a.busLines.map((l) => [l.id, l]));
  pathCache.clear();
});

/** Whether the installed world has an airport (the planes, the flights and the pilots). */
export function hasAirport(): boolean {
  return !!AIRPORT_TERMINAL && !!activeAtlas().runway;
}

/** Whether the installed world has a Hyperline with at least two stations. */
export function hasHyperline(): boolean {
  return STATIONS.length >= 2 && TRACK.length >= 2;
}

// ─── Cities and settlements ─────────────────────────────────────────────────

export function residentialOf(city: CityId): CommunityId[] {
  return COMMUNITIES.filter((c) => c.city === city && c.tier !== 'civic').map((c) => c.id);
}

export function communityAt(x: number, y: number): CommunityId | null {
  for (const c of COMMUNITIES) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.id;
  return null;
}

/** The settlement an unknown place defaults to (the original village). */
export function defaultCommunity(): CommunityId {
  return activeAtlas().defaultCommunity;
}

export function cityOf(community: CommunityId | null | undefined): CityId {
  return community ? COMMUNITY[community]?.city ?? activeAtlas().defaultCity : activeAtlas().defaultCity;
}

export function tierOf(community: CommunityId | null | undefined): Tier {
  return COMMUNITY[community ?? activeAtlas().defaultCommunity]?.tier ?? 'middle';
}

/** The city a point falls in: its settlement's, else the nearest city box, else the centre. */
export function cityAt(x: number, y: number): CityId | null {
  const com = communityAt(x, y);
  if (com) return cityOf(com);
  for (const c of CITIES) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.id;
  return null;
}

// ─── Roads ──────────────────────────────────────────────────────────────────

/** Every road segment in the world (centre lines and widths). */
export function roadSegments(): readonly Segment[] {
  return activeAtlas().segments;
}

export const ROAD_WIDTH = 7;

/** Every plot in the world, in plot-number order. */
export function plotSpecs(): PlotSpec[] {
  return activeAtlas().plots;
}

export function buildBuildings(): Record<string, Building> {
  return activeAtlas().buildings();
}

// ─── Road graph ───────────────────────────────────────────────────────────

export interface RoadGraph {
  nodes: Record<string, RoadNode>;
  edges: RoadEdge[];
  adj: Record<string, Array<{ to: string; length: number }>>;
}

export function nodeId(x: number, y: number): string {
  return `n${Math.round(x)}_${Math.round(y)}`;
}

/** Project a point onto the nearest road segment of a list; returns the point, the segment and distance. */
export function nearestPointOn(segments: readonly Segment[], px: number, py: number): { x: number; y: number; seg: Segment; d: number } | null {
  let best: { x: number; y: number; seg: Segment; d: number } | null = null;
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = s.x1 + t * dx;
    const y = s.y1 + t * dy;
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { x, y, seg: s, d };
  }
  return best;
}

/** Project a point onto the nearest road segment; returns the point, the segment and distance. */
export function nearestRoadPoint(px: number, py: number): { x: number; y: number; seg: Segment; d: number } {
  return nearestPointOn(roadSegments(), px, py)!;
}

/**
 * The road network as a graph: stations on every segment at its ends, where it
 * meets another segment, and where a building's entrance projects onto it. The
 * buildings' `roadNode` is set on the way.
 */
export function buildRoadGraphOn(segments: readonly Segment[], buildings: Record<string, Building>): RoadGraph {
  // Stations per segment: endpoints, intersections, entrance projections.
  const stations = new Map<Segment, Array<{ t: number; x: number; y: number }>>();
  for (const s of segments) stations.set(s, [{ t: 0, x: s.x1, y: s.y1 }, { t: 1, x: s.x2, y: s.y2 }]);
  const addStation = (s: Segment, x: number, y: number) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const t = Math.abs(dx) > Math.abs(dy) ? (x - s.x1) / dx : (y - s.y1) / dy;
    const arr = stations.get(s)!;
    if (!arr.some((st) => Math.abs(st.t - t) < 1e-6)) arr.push({ t, x, y });
  };
  // intersections (and touching endpoints) between horizontal and vertical segments
  for (const a of segments) {
    for (const b of segments) {
      if (a === b) continue;
      const aH = a.y1 === a.y2;
      const bH = b.y1 === b.y2;
      if (aH === bH) continue;
      const h = aH ? a : b;
      const v = aH ? b : a;
      const x = v.x1;
      const y = h.y1;
      if (x >= Math.min(h.x1, h.x2) && x <= Math.max(h.x1, h.x2) && y >= Math.min(v.y1, v.y2) && y <= Math.max(v.y1, v.y2)) {
        addStation(h, x, y);
        addStation(v, x, y);
      }
    }
  }
  // collinear touching segments (e.g. the Unity Road pieces) share endpoints already by construction
  // entrances
  for (const id in buildings) {
    const b = buildings[id];
    const np = nearestPointOn(segments, b.entrance.x, b.entrance.y);
    if (!np) continue;
    addStation(np.seg, np.x, np.y);
    b.roadNode = nodeId(np.x, np.y);
  }
  const nodes: Record<string, RoadNode> = {};
  const edges: RoadEdge[] = [];
  const adj: Record<string, Array<{ to: string; length: number }>> = {};
  for (const [s, arr] of stations) {
    arr.sort((p, q) => p.t - q.t);
    for (const st of arr) {
      const id = nodeId(st.x, st.y);
      nodes[id] = { id, x: st.x, y: st.y };
      adj[id] ??= [];
    }
    for (let i = 1; i < arr.length; i++) {
      const a = nodeId(arr[i - 1].x, arr[i - 1].y);
      const b = nodeId(arr[i].x, arr[i].y);
      if (a === b) continue;
      const length = Math.hypot(arr[i].x - arr[i - 1].x, arr[i].y - arr[i - 1].y);
      edges.push({ a, b, length, name: s.name, width: s.width ?? ROAD_WIDTH });
      adj[a].push({ to: b, length });
      adj[b].push({ to: a, length });
    }
  }
  return { nodes, edges, adj };
}

export function buildRoadGraph(buildings: Record<string, Building>): RoadGraph {
  return buildRoadGraphOn(roadSegments(), buildings);
}

const pathCache = new Map<string, string[] | null>();

/** Dijkstra over the road graph; returns node ids from → to inclusive. */
export function roadPath(g: RoadGraph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const key = `${from}>${to}`;
  const cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  const distMap = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  distMap.set(from, 0);
  // A few hundred nodes: O(n²) selection is still fine, and every route is cached.
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of distMap) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null) break;
    if (u === to) break;
    visited.add(u);
    for (const e of g.adj[u] ?? []) {
      const nd = best + e.length;
      if (nd < (distMap.get(e.to) ?? Infinity)) {
        distMap.set(e.to, nd);
        prev.set(e.to, u);
      }
    }
  }
  if (!distMap.has(to)) {
    pathCache.set(key, null);
    return null;
  }
  const out: string[] = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    out.push(p);
    cur = p;
  }
  out.reverse();
  pathCache.set(key, out);
  return out;
}

export function clearPathCache(): void {
  pathCache.clear();
}

/** Length in metres of a road path between two nodes (Infinity when unreachable). */
export function roadDistance(g: RoadGraph, from: string, to: string): number {
  const p = roadPath(g, from, to);
  if (!p) return Infinity;
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(g.nodes[p[i]].x - g.nodes[p[i - 1]].x, g.nodes[p[i]].y - g.nodes[p[i - 1]].y);
  return l;
}

/** Door of a building (houses have a door distinct from the gate). */
export function doorOf(b: Building): { x: number; y: number } {
  return b.door ?? b.entrance;
}

export function roomOf(b: Building, roomId: string | null | undefined): Room | null {
  if (!roomId) return null;
  return b.rooms.find((r) => r.id === roomId) ?? null;
}

export function roomByKind(b: Building | null | undefined, kind: Room['kind']): Room | null {
  return b?.rooms.find((r) => r.kind === kind) ?? null;
}

export function roomCentre(r: Room): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

/** The exit nearest a point (intruders come from, and flee to, the nearest edge of the map). */
export function nearestExit(x: number, y: number): ExitSpec {
  let best: ExitSpec = EXITS[0];
  let bd = Infinity;
  for (const e of EXITS) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// ─── The Hyperline ──────────────────────────────────────────────────────────

/** Distance along the guideway of a point that lies on it. */
export function trackDistanceOf(x: number, y: number): number {
  return distanceAlong(TRACK, TRACK_CUM, x, y);
}

/** The point and heading on the guideway at distance `s` from its first end. */
export function trackPoint(s: number): { x: number; y: number; heading: number } {
  return pointAlong(TRACK, TRACK_CUM, s);
}

// ─── Landmarks: what each settlement and city calls its own ─────────────────

/** The community a person belongs to is the community of their house. */
export function communityOfBuilding(buildings: Record<string, Building>, buildingId: string | null | undefined): CommunityId | null {
  if (!buildingId) return null;
  return buildings[buildingId]?.community ?? null;
}

/**
 * The building a community uses for a purpose: its own where it has one,
 * else its city's, else the region's. `church` is null where there is none
 * to go to (Newhaven); any other purpose is null only in a world without one.
 */
export function landmark(community: CommunityId | null | undefined, kind: LandmarkKind): string | null {
  return landmarkIn(activeAtlas(), community, kind);
}

/** The building a household uses for a purpose (its house's nearest where its settlement has several). */
export function landmarkOfHouse(house: Building | null | undefined, kind: LandmarkKind): string | null {
  return landmarkForHouseIn(activeAtlas(), house?.id, house?.community, kind);
}

/** The buildings of one landmark kind across the world, in settlement order. */
export function landmarksOfKind(kind: LandmarkKind): string[] {
  const out: string[] = [];
  for (const c of COMMUNITIES) {
    const id = landmark(c.id, kind);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The city whose institutions a building serves. */
export function cityOfBuilding(b: Building | null | undefined): CityId {
  return b ? cityOf(b.community) : activeAtlas().defaultCity;
}

// The built-in province until a Simulation installs its own world.
installAtlas(provinceAtlas());
