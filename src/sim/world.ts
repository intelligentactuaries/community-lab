// Unity Province: three cities, the centre they share and the airport, the
// road network that joins them and shortest-path routing over it. All
// coordinates are metres.
//
//   Emmaus (0..1400 × 0..1120, NW)         the original district, now the rich city
//   Newhaven (3000..4400 × 0..1120, NE)    the secular city
//   Ithemba (1500..2900 × 2300..3420, S)   the poor, church-going city
//   Unity Centre (between them)            hospital campus · CBD & government · Unity Park
//   The airport (3725..4400 × 1200..3000)  terminal, tower, hangar and runway, SE
//
// Each city's own layout lives in layout/; this file assembles them, names
// the settlements and cities, and answers "where is this?" for the rest of
// the engine. The Hyperline (layout/hyperline.ts) and the bus lines below are
// the province's public transport.

import { AIRPORT_SEGMENTS, airportBuildings } from './layout/airport';
import { EMMAUS_SEGMENTS, emmausBuildings, emmausPlots } from './layout/emmaus';
import { STATIONS, hyperlineBuildings } from './layout/hyperline';
import { ITHEMBA_SEGMENTS, ithembaBuildings, ithembaPlots } from './layout/ithemba';
import { NEWHAVEN_SEGMENTS, newhavenBuildings, newhavenPlots } from './layout/newhaven';
import { CENTRAL_X, UNITY_SEGMENTS, unityBuildings } from './layout/unity';
import { resetSpots } from './layout/builders';
import type { PlotSpec, Segment } from './layout/plots';
import type { Building, CityId, CommunityId, Room, RoadEdge, RoadNode, Tier } from './types';

export { PLOT_H, PLOT_W, houseRooms } from './layout/plots';
export type { PlotSpec } from './layout/plots';
export { STATIONS, TRACK, TRACK_CUM, TRACK_LENGTH, TRACK_WIDTH, trackDistanceOf, trackPoint } from './layout/hyperline';
export type { StationSpec } from './layout/hyperline';
export { RUNWAY } from './layout/airport';

export const WORLD_W = 4400;
export const WORLD_H = 3420;

// ─── Cities and settlements ─────────────────────────────────────────────────

export interface CitySpec {
  id: CityId;
  name: string;
  short: string;
  /** A city of settlements, the shared centre, or the airport. */
  kind: 'city' | 'centre' | 'airport';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether the city has congregations at all; a secular city's residents keep a low faith. */
  religious: boolean;
  /** Mean church-attendance propensity of residents; null takes the scenario's `churchAttendance`. */
  faith: number | null;
  /** One line for the map and the prompts. */
  blurb: string;
}

export const CITIES: CitySpec[] = [
  { id: 'emmaus', name: 'Emmaus', short: 'Emmaus', kind: 'city', x: 0, y: 0, w: 1400, h: 1120, religious: true, faith: null, blurb: 'the rich city: three churchgoing settlements, from comfortable Kanana to the Hebron estates' },
  { id: 'newhaven', name: 'Newhaven', short: 'Newhaven', kind: 'city', x: 3000, y: 0, w: 1400, h: 1120, religious: false, faith: 0.06, blurb: 'the secular city: no church, mosque or temple; a library and a memorial hall instead' },
  { id: 'ithemba', name: 'Ithemba', short: 'Ithemba', kind: 'city', x: 1500, y: 2300, w: 1400, h: 1120, religious: true, faith: null, blurb: 'the poor city: three devout townships around a crossroads' },
  { id: 'unity', name: 'Unity Centre', short: 'Unity', kind: 'centre', x: 1640, y: 380, w: 1140, h: 1920, religious: false, faith: null, blurb: 'the shared centre: hospital campus, CBD and government, and Unity Park' },
  { id: 'airport', name: 'Unity Provincial Airport', short: 'Airport', kind: 'airport', x: 3725, y: 1200, w: 675, h: 1800, religious: false, faith: null, blurb: "the province's airport: terminal, control tower, hangar and a 1.6 km runway, at the end of the Hyperline" },
];

export const CITY: Record<CityId, CitySpec> = Object.fromEntries(CITIES.map((c) => [c.id, c])) as Record<CityId, CitySpec>;

export interface CommunitySpec {
  id: CommunityId;
  city: CityId;
  name: string;
  /** One-word tag used in labels and analytics. */
  short: string;
  tier: Tier;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Plots in the order households are seated at t0 (spread out, so vacancies interleave). */
  seedOrder: number[];
  /** Households seated at t0 (Ebenezer's count is the `households` parameter). */
  seedHouseholds: number;
}

export const COMMUNITIES: CommunitySpec[] = [
  // Emmaus
  { id: 'ebenezer', city: 'emmaus', name: 'Ebenezer', short: 'Ebenezer', tier: 'affluent', x: 20, y: 40, w: 640, h: 480, seedOrder: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 7, 15, 8, 16], seedHouseholds: 12 },
  { id: 'hebron', city: 'emmaus', name: 'Hebron Heights', short: 'Hebron', tier: 'ultra', x: 860, y: 60, w: 520, h: 410, seedOrder: [21, 23, 25, 28, 30, 22, 27, 26, 29, 24], seedHouseholds: 8 },
  { id: 'kanana', city: 'emmaus', name: 'Kanana', short: 'Kanana', tier: 'comfortable', x: 400, y: 760, w: 660, h: 340, seedOrder: [41, 44, 47, 50, 53, 42, 45, 48, 51, 54, 43, 46, 49, 52], seedHouseholds: 12 },
  { id: 'crossing', city: 'emmaus', name: 'Emmaus Crossing', short: 'Crossing', tier: 'civic', x: 640, y: 550, w: 360, h: 210, seedOrder: [], seedHouseholds: 0 },
  // Newhaven
  { id: 'bellevue', city: 'newhaven', name: 'Bellevue Heights', short: 'Bellevue', tier: 'affluent', x: 3020, y: 60, w: 520, h: 410, seedOrder: [101, 103, 105, 108, 110, 102, 107, 106, 109, 104], seedHouseholds: 8 },
  { id: 'oakdale', city: 'newhaven', name: 'Oakdale', short: 'Oakdale', tier: 'middle', x: 3740, y: 40, w: 640, h: 480, seedOrder: [111, 112, 113, 114, 115, 116, 119, 120, 121, 122, 123, 124, 117, 125, 118, 126], seedHouseholds: 12 },
  { id: 'westbrook', city: 'newhaven', name: 'Westbrook', short: 'Westbrook', tier: 'working', x: 3340, y: 760, w: 700, h: 340, seedOrder: [131, 134, 137, 140, 143, 132, 135, 138, 141, 144, 133, 136, 139, 142], seedHouseholds: 12 },
  { id: 'central', city: 'newhaven', name: 'Newhaven Central', short: 'Central', tier: 'civic', x: 3320, y: 550, w: 440, h: 210, seedOrder: [], seedHouseholds: 0 },
  // Ithemba
  { id: 'bethesda', city: 'ithemba', name: 'Bethesda', short: 'Bethesda', tier: 'working', x: 1520, y: 2900, w: 640, h: 480, seedOrder: [201, 202, 203, 204, 205, 206, 209, 210, 211, 212, 213, 214, 207, 215, 208, 216], seedHouseholds: 12 },
  { id: 'siyakha', city: 'ithemba', name: 'Siyakha', short: 'Siyakha', tier: 'low-income', x: 2360, y: 2950, w: 520, h: 410, seedOrder: [221, 224, 227, 230, 233, 222, 225, 228, 231, 234, 223, 226, 229, 232], seedHouseholds: 12 },
  { id: 'nazareth', city: 'ithemba', name: 'Nazareth', short: 'Nazareth', tier: 'low-income', x: 1900, y: 2320, w: 660, h: 340, seedOrder: [241, 244, 247, 250, 253, 242, 245, 248, 251, 254, 243, 246, 249, 252], seedHouseholds: 12 },
  { id: 'crossroads', city: 'ithemba', name: 'Ithemba Crossroads', short: 'Crossroads', tier: 'civic', x: 1980, y: 2662, w: 420, h: 218, seedOrder: [], seedHouseholds: 0 },
  // Unity Centre
  { id: 'campus', city: 'unity', name: 'Hospital campus', short: 'Campus', tier: 'civic', x: 1880, y: 400, w: 460, h: 320, seedOrder: [], seedHouseholds: 0 },
  { id: 'cbd', city: 'unity', name: 'Unity CBD', short: 'CBD', tier: 'civic', x: 1690, y: 1230, w: 1040, h: 490, seedOrder: [], seedHouseholds: 0 },
  { id: 'precinct', city: 'unity', name: 'Unity Park', short: 'Park', tier: 'civic', x: 1650, y: 1810, w: 1120, h: 470, seedOrder: [], seedHouseholds: 0 },
  // The airport
  { id: 'airfield', city: 'airport', name: 'Unity Provincial Airport', short: 'Airport', tier: 'civic', x: 3728, y: 1220, w: 664, h: 1760, seedOrder: [], seedHouseholds: 0 },
];

export const COMMUNITY: Record<CommunityId, CommunitySpec> = Object.fromEntries(COMMUNITIES.map((c) => [c.id, c])) as Record<CommunityId, CommunitySpec>;

/** The settlements with households, in seating order. */
export const RESIDENTIAL: CommunityId[] = COMMUNITIES.filter((c) => c.tier !== 'civic').map((c) => c.id);

export function residentialOf(city: CityId): CommunityId[] {
  return COMMUNITIES.filter((c) => c.city === city && c.tier !== 'civic').map((c) => c.id);
}

export function communityAt(x: number, y: number): CommunityId | null {
  for (const c of COMMUNITIES) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.id;
  return null;
}

export function cityOf(community: CommunityId | null | undefined): CityId {
  return community ? COMMUNITY[community].city : 'emmaus';
}

export function tierOf(community: CommunityId | null | undefined): Tier {
  return community ? COMMUNITY[community].tier : 'affluent';
}

/** The city a point falls in: its settlement's, else the nearest city box, else the centre. */
export function cityAt(x: number, y: number): CityId | null {
  const com = communityAt(x, y);
  if (com) return cityOf(com);
  for (const c of CITIES) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.id;
  return null;
}

// ─── Roads ──────────────────────────────────────────────────────────────────

const SEGMENTS: Segment[] = [...EMMAUS_SEGMENTS, ...NEWHAVEN_SEGMENTS, ...ITHEMBA_SEGMENTS, ...UNITY_SEGMENTS, ...AIRPORT_SEGMENTS];

/** Every road segment in the province (centre lines and widths). */
export function roadSegments(): readonly Segment[] {
  return SEGMENTS;
}

export const ROAD_WIDTH = 7;

/** Every plot in the province, in plot-number order. */
export function plotSpecs(): PlotSpec[] {
  return [...emmausPlots(), ...newhavenPlots(), ...ithembaPlots()];
}

export function buildBuildings(): Record<string, Building> {
  resetSpots();
  return { ...emmausBuildings(), ...newhavenBuildings(), ...ithembaBuildings(), ...unityBuildings(), ...hyperlineBuildings(), ...airportBuildings() };
}

// ─── Road graph ───────────────────────────────────────────────────────────

export interface RoadGraph {
  nodes: Record<string, RoadNode>;
  edges: RoadEdge[];
  adj: Record<string, Array<{ to: string; length: number }>>;
}

function nodeId(x: number, y: number): string {
  return `n${Math.round(x)}_${Math.round(y)}`;
}

/** Project a point onto the nearest road segment; returns the point, the segment and distance. */
export function nearestRoadPoint(px: number, py: number): { x: number; y: number; seg: Segment; d: number } {
  let best: { x: number; y: number; seg: Segment; d: number } | null = null;
  for (const s of SEGMENTS) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = s.x1 + t * dx;
    const y = s.y1 + t * dy;
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { x, y, seg: s, d };
  }
  return best!;
}

export function buildRoadGraph(buildings: Record<string, Building>): RoadGraph {
  // Stations per segment: endpoints, intersections, entrance projections.
  const stations = new Map<Segment, Array<{ t: number; x: number; y: number }>>();
  for (const s of SEGMENTS) stations.set(s, [{ t: 0, x: s.x1, y: s.y1 }, { t: 1, x: s.x2, y: s.y2 }]);
  const addStation = (s: Segment, x: number, y: number) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const t = Math.abs(dx) > Math.abs(dy) ? (x - s.x1) / dx : (y - s.y1) / dy;
    const arr = stations.get(s)!;
    if (!arr.some((st) => Math.abs(st.t - t) < 1e-6)) arr.push({ t, x, y });
  };
  // intersections (and touching endpoints) between horizontal and vertical segments
  for (const a of SEGMENTS) {
    for (const b of SEGMENTS) {
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
    const np = nearestRoadPoint(b.entrance.x, b.entrance.y);
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

export function roomByKind(b: Building, kind: Room['kind']): Room | null {
  return b.rooms.find((r) => r.kind === kind) ?? null;
}

export function roomCentre(r: Room): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

/** Province exit / entry points (migrants, intruders, the long-distance taxis) with their road nodes. */
export const EXITS = [
  { id: 'west', x: 0, y: 280, node: 'n0_280' },
  { id: 'east', x: 4400, y: 280, node: 'n4400_280' },
  { id: 'north', x: CENTRAL_X, y: 0, node: `n${CENTRAL_X}_0` },
  { id: 'south', x: 1600, y: 3420, node: 'n1600_3420' },
] as const;

export const WEST_EXIT = { x: EXITS[0].x, y: EXITS[0].y };
export const EAST_EXIT = { x: EXITS[1].x, y: EXITS[1].y };
export const SOUTH_EXIT = { x: EXITS[3].x, y: EXITS[3].y };

/** The exit nearest a point (intruders come from, and flee to, the nearest edge of the province). */
export function nearestExit(x: number, y: number): (typeof EXITS)[number] {
  let best: (typeof EXITS)[number] = EXITS[0];
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

// ─── Landmarks: what each settlement and city calls its own ─────────────────

/** The community a person belongs to is the community of their house. */
export function communityOfBuilding(buildings: Record<string, Building>, buildingId: string | null | undefined): CommunityId | null {
  if (!buildingId) return null;
  return buildings[buildingId]?.community ?? null;
}

export type LandmarkKind = 'church' | 'shop' | 'bank' | 'park' | 'busstop' | 'hall' | 'cemetery' | 'school' | 'clinic' | 'police' | 'court' | 'council' | 'medical' | 'taxi' | 'workshop' | 'office' | 'farm' | 'library';

type Landmarks = Partial<Record<LandmarkKind, string>>;

/** What a settlement keeps for itself: its congregation, shop, bank counter, park and bus stop. */
const SETTLEMENT_LANDMARKS: Record<CommunityId, Landmarks> = {
  ebenezer: { church: 'church', shop: 'market', bank: 'bank', park: 'park', busstop: 'busstop' },
  hebron: { church: 'rchurch', shop: 'rshop', bank: 'rbank', park: 'rpark', busstop: 'busstop' },
  kanana: { church: 'pchurch', shop: 'pshop', bank: 'pbank', park: 'ppitch', busstop: 'pbusstop' },
  crossing: { shop: 'market', bank: 'combank', park: 'plaza', busstop: 'busstop' },
  bellevue: { shop: 'nh-deli', bank: 'nh-rbank', park: 'nh-green', busstop: 'nh-busstop' },
  oakdale: { shop: 'nh-market', bank: 'nh-bank', park: 'nh-park', busstop: 'nh-busstop' },
  westbrook: { shop: 'nh-spaza', bank: 'nh-pbank', park: 'nh-grounds', busstop: 'nh-pbusstop' },
  central: { shop: 'nh-market', bank: 'nh-combank', park: 'nh-plaza', busstop: 'nh-busstop' },
  bethesda: { church: 'it-church', shop: 'it-market', bank: 'it-bank', park: 'it-park', busstop: 'it-busstop' },
  siyakha: { church: 'it-schurch', shop: 'it-sspaza', bank: 'it-sbank', park: 'it-sgrounds', busstop: 'it-busstop' },
  nazareth: { church: 'it-nchurch', shop: 'it-nspaza', bank: 'it-nbank', park: 'it-ngrounds', busstop: 'it-nbusstop' },
  crossroads: { shop: 'it-market', bank: 'it-bank', park: 'it-plaza', busstop: 'it-busstop' },
  campus: { shop: 'un-pharmacy', park: 'grandpark', busstop: 'un-hstop' },
  cbd: { shop: 'mall', bank: 'reservebank', park: 'un-square', busstop: 'terminus' },
  precinct: { shop: 'mall', park: 'grandpark', busstop: 'un-pstop' },
  airfield: { shop: 'ap-terminal', bank: 'nh-combank', park: 'un-gardens', busstop: 'ap-busstop' },
};

/** What a city keeps for all its settlements: school, clinic, police station, court, council, medical centre, cemetery, hall, taxi rank, workshop, offices and farm. */
const CITY_LANDMARKS: Record<CityId, Landmarks> = {
  emmaus: { school: 'school', clinic: 'clinic', police: 'police', court: 'court', council: 'council', medical: 'medical', cemetery: 'cemetery', hall: 'hall', taxi: 'ptaxi', workshop: 'workshop', office: 'office', farm: 'farm', shop: 'market', bank: 'bank', park: 'park', busstop: 'busstop' },
  newhaven: { school: 'nh-school', clinic: 'nh-clinic', police: 'nh-police', court: 'nh-court', council: 'nh-council', medical: 'nh-medical', cemetery: 'nh-cemetery', hall: 'nh-hall', taxi: 'nh-taxi', workshop: 'nh-workshop', office: 'nh-office', farm: 'nh-farm', library: 'nh-library', shop: 'nh-market', bank: 'nh-bank', park: 'nh-park', busstop: 'nh-busstop' },
  ithemba: { school: 'it-school', clinic: 'it-clinic', police: 'it-police', court: 'it-court', council: 'it-council', medical: 'it-medical', cemetery: 'it-cemetery', hall: 'it-hall', taxi: 'it-taxi', workshop: 'it-workshop', office: 'it-office', farm: 'it-farm', shop: 'it-market', bank: 'it-bank', park: 'it-park', busstop: 'it-busstop' },
  // The centre has no residents; its staff belong to their home cities. What it does have covers the region.
  unity: { clinic: 'hospital', police: 'un-police', taxi: 'terminus', office: 'towers', shop: 'mall', park: 'grandpark', busstop: 'terminus' },
  // The airport is served from the centre and Newhaven.
  airport: { clinic: 'hospital', police: 'un-police', taxi: 'terminus', office: 'ap-terminal', shop: 'ap-terminal', park: 'un-gardens', busstop: 'ap-busstop', medical: 'nh-medical', court: 'nh-court', council: 'nh-council', school: 'nh-school', cemetery: 'nh-cemetery', hall: 'nh-hall', workshop: 'ap-hangar', farm: 'nh-farm', bank: 'nh-combank' },
};

/**
 * The building a community uses for a purpose: its own where it has one,
 * else its city's. `church` is null where there is none (Newhaven).
 */
export function landmark(community: CommunityId | null | undefined, kind: 'church'): string | null;
export function landmark(community: CommunityId | null | undefined, kind: Exclude<LandmarkKind, 'church'>): string;
export function landmark(community: CommunityId | null | undefined, kind: LandmarkKind): string | null {
  const com = community ?? 'ebenezer';
  const own = SETTLEMENT_LANDMARKS[com][kind];
  if (own) return own;
  const city = CITY_LANDMARKS[cityOf(com)][kind];
  if (city) return city;
  if (kind === 'church') return null;
  // A purpose the centre does not serve falls back to Emmaus (the original district's institution).
  return CITY_LANDMARKS.emmaus[kind] ?? null;
}

/** The buildings of one landmark kind across the province, in city order. */
export function landmarksOfKind(kind: LandmarkKind): string[] {
  const out: string[] = [];
  for (const c of COMMUNITIES) {
    const id = landmark(c.id, kind as 'church');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Every church in the province (three in Emmaus, three in Ithemba, none in Newhaven). */
export const CHURCH_IDS: string[] = landmarksOfKind('church');
/** The city clinics, then the central hospital (all with wards). */
export const CLINIC_IDS: string[] = ['clinic', 'nh-clinic', 'it-clinic', 'hospital'];
export const COURT_IDS: string[] = ['court', 'nh-court', 'it-court'];
export const POLICE_IDS: string[] = ['police', 'nh-police', 'it-police', 'un-police'];
export const COUNCIL_IDS: Record<CityId, string | null> = { emmaus: 'council', newhaven: 'nh-council', ithemba: 'it-council', unity: null, airport: null };
export const TAXI_RANK_IDS: string[] = ['ptaxi', 'nh-taxi', 'it-taxi', 'terminus'];
export const CENTRAL_HOSPITAL = 'hospital';
/** Where ambulances stand: the city clinics, the hospital's EMS station (two) and the airport's fire & rescue. */
export const AMBULANCE_BASES: Array<{ id: string; n: number }> = [{ id: 'clinic', n: 1 }, { id: 'nh-clinic', n: 1 }, { id: 'it-clinic', n: 1 }, { id: 'un-ambulance', n: 2 }, { id: 'ap-fire', n: 1 }];
export const STATION_IDS: string[] = STATIONS.map((s) => s.id);
export const AIRPORT_TERMINAL = 'ap-terminal';
export const BUS_HUB = 'terminus';

// ─── Public transport ───────────────────────────────────────────────────────

export interface BusLine {
  id: string;
  name: string;
  /** Stops in order; buses shuttle back and forth along the list. */
  stops: string[];
}

/** One bus line per city into the centre (by the hospital or the park), and the airport shuttle. */
export const BUS_LINES: BusLine[] = [
  { id: 'emmaus', name: 'Emmaus Line', stops: ['pbusstop', 'busstop', 'rbusstop', 'un-hstop', 'terminus'] },
  { id: 'newhaven', name: 'Newhaven Line', stops: ['nh-pbusstop', 'nh-rank', 'nh-rbusstop', 'un-hstop', 'terminus'] },
  { id: 'ithemba', name: 'Ithemba Line', stops: ['it-sbusstop', 'it-busstop', 'it-nbusstop', 'un-pstop', 'terminus'] },
  { id: 'airport', name: 'Airport Shuttle', stops: ['terminus', 'ap-busstop'] },
];
export const BUS_LINE: Record<string, BusLine> = Object.fromEntries(BUS_LINES.map((l) => [l.id, l]));

/** The city whose institutions a building serves. */
export function cityOfBuilding(b: Building | null | undefined): CityId {
  return b ? cityOf(b.community) : 'emmaus';
}
