// Checking a plan before it runs. Errors stop a run (a world without homes,
// a building no road reaches); warnings say what a missing place will mean
// (no clinic: the sick are nursed at home); notes describe choices the engine
// will make on its own. The builder lists them all and flies to each.

import type { Building } from '../types';
import { buildRoadGraphOn } from '../world';
import { ASSET } from './assets';
import { materialise } from './derive';
import type { PlanSettlement, WorldPlan } from './types';

export type IssueLevel = 'error' | 'warning' | 'note';

export interface Issue {
  level: IssueLevel;
  /** A stable key (for tests and for de-duplicating in the UI). */
  code: string;
  text: string;
  /** What to fly to: building ids, a settlement or city id, or a point. */
  ids?: string[];
  at?: { x: number; y: number };
}

export interface PlanStats {
  buildings: number;
  houses: number;
  plotsByTier: { small: number; standard: number; large: number };
  /** Households seated at t0 and a population estimate (3.6 a household, the province's mean). */
  households: number;
  population: number;
  roadKm: number;
  /** Posts the community cannot leave empty, by job. */
  posts: Record<string, number>;
  businesses: number;
  byAsset: Record<string, number>;
}

/** Entrances further than this from a road cannot be reached; past the softer limit they are a long walk. */
const ROAD_REACH = 60;
const ROAD_NEAR = 30;

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** What is wrong with a settlement's own departures from its tier, if anything (shares in [0, 1], savings a range of months, schooling a mix). */
function profileFault(p: PlanSettlement['profile']): string | null {
  if (!p) return null;
  const share = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  for (const k of ['unemployment', 'carOwnership', 'secondCarShare', 'medicalAidShare', 'funeralCoverShare', 'lifeCoverShare'] as const) {
    if (p[k] !== undefined && !share(p[k])) return `${k} must be a share between 0 and 1`;
  }
  if (p.savingsMonths !== undefined) {
    const [lo, hi] = p.savingsMonths;
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= lo)) return 'savings must run from a number of months to at least as many';
  }
  if (p.educationMix !== undefined) {
    const v = Object.values(p.educationMix);
    if (v.some((x) => !(Number.isFinite(x) && x >= 0)) || Math.abs(v.reduce((a, b) => a + b, 0) - 1) > 0.01) return 'the schooling mix must be shares that add up to one';
  }
  return null;
}

/** Every check, cheapest first. A plan that fails a structural check is not laid out further. */
export function validatePlan(plan: WorldPlan, prebuilt?: Record<string, Building>): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, text: string, extra: Partial<Issue> = {}) => out.push({ level: 'error', code, text, ...extra });
  const warn = (code: string, text: string, extra: Partial<Issue> = {}) => out.push({ level: 'warning', code, text, ...extra });
  const note = (code: string, text: string, extra: Partial<Issue> = {}) => out.push({ level: 'note', code, text, ...extra });
  const W = plan.size.w;
  const H = plan.size.h;

  // ── Structure ──
  if (!plan.cities.length) err('no-city', 'Add a city: every settlement belongs to one.');
  if (!plan.settlements.length) err('no-settlement', 'Add a settlement: every building belongs to one.');
  const ids = new Set<string>();
  for (const b of plan.buildings) {
    if (ids.has(b.id)) err('duplicate-id', `Two buildings share the id "${b.id}".`, { ids: [b.id] });
    ids.add(b.id);
  }
  const plotSeen = new Map<number, string>();
  for (const b of plan.buildings) {
    if (b.plot == null) continue;
    if (plotSeen.has(b.plot)) err('duplicate-plot', `Plot ${b.plot} is numbered twice.`, { ids: [b.id, plotSeen.get(b.plot)!] });
    plotSeen.set(b.plot, b.id);
  }
  const cityIds = new Set(plan.cities.map((c) => c.id));
  const settlementIds = new Set(plan.settlements.map((s) => s.id));
  for (const s of plan.settlements) if (!cityIds.has(s.city)) err('settlement-city', `${s.name} belongs to a city that is not there.`, { ids: [s.id] });
  for (const b of plan.buildings) {
    if (!settlementIds.has(b.settlement)) err('building-settlement', `${b.name} belongs to a settlement that is not there.`, { ids: [b.id] });
    if (!b.raw && !ASSET[b.asset]) err('unknown-asset', `${b.name} is an unknown kind of building ("${b.asset}").`, { ids: [b.id] });
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) err('outside-world', `${b.name} stands partly outside the map.`, { ids: [b.id] });
  }
  for (const c of plan.cities) if (!plan.settlements.some((s) => s.city === c.id)) warn('empty-city', `${c.name} has no settlements.`, { ids: [c.id] });
  for (const s of plan.settlements) {
    const bad = profileFault(s.profile);
    if (bad) err('bad-profile', `${s.name}'s people: ${bad}.`, { ids: [s.id] });
  }
  if (out.some((i) => i.level === 'error')) return out;

  // ── Homes ──
  const houses = plan.buildings.filter((b) => (b.raw?.kind ?? ASSET[b.asset]?.kind) === 'house');
  const residential = plan.settlements.filter((s) => s.tier !== 'civic');
  if (!houses.length) err('no-homes', 'Place some houses: a community needs homes for its households.');
  else if (!residential.some((s) => houses.some((h) => h.settlement === s.id))) err('no-residential', 'Houses stand only in civic zones: put them in a residential settlement (any tier but civic).');
  for (const h of houses) {
    const s = plan.settlements.find((x) => x.id === h.settlement);
    if (s?.tier === 'civic') warn('house-in-civic', `${h.name} is in ${s.name}, a civic zone: nobody will be seated there at the start.`, { ids: [h.id] });
  }
  for (const s of residential) {
    const n = houses.filter((h) => h.settlement === s.id).length;
    if (s.households != null && s.households > n) warn('more-households', `${s.name} is to seat ${s.households} households in ${n} houses; it will seat ${n}.`, { ids: [s.id] });
  }

  // ── Daily needs ──
  const has = (...assets: string[]) => plan.buildings.some((b) => assets.includes(b.asset));
  if (!has('spaza', 'market', 'deli', 'mall')) err('no-shop', 'Add a shop (a spaza, a general dealer, a deli or a mall): households buy their food there.');
  if (!has('school')) warn('no-school', "No school: children stay home on school days and nobody teaches.");
  if (!has('clinic', 'hospital')) warn('no-clinic', 'No clinic: the sick are nursed at home, with a quarter of the care a clinic gives.');
  if (!has('police')) warn('no-police', 'No police station: incidents are left to neighbours, and nobody is arrested.');
  if (!has('church')) note('no-church', 'No church: a secular world (Sunday is for the park, weddings are civil).');
  if (!has('court')) note('no-court', "No magistrate's court: cases go to the regional court out of town.");
  if (!has('cemetery')) note('no-cemetery', 'No cemetery: the dead are buried out of town.');
  if (!has('bank')) note('no-bank', 'No Mutual Bank branch: the bank still keeps everyone\'s account, but employs nobody here.');
  if (!has('farm')) note('no-farm', 'No farm: fresh produce comes in from the wholesaler.');
  if (!has('medical')) note('no-medical', 'No medical centre: no district medical officer, and the council has no health seat.');
  for (const c of plan.cities) {
    if (c.kind !== 'city') continue;
    const inCity = (asset: string) => plan.buildings.some((b) => b.asset === asset && plan.settlements.find((s) => s.id === b.settlement)?.city === c.id);
    if (!inCity('council')) note('no-council', `${c.name} has no council chamber: its council is elected but never sits.`, { ids: [c.id] });
  }

  // ── Roads ──
  if (!plan.roads.length) {
    err('no-roads', 'Draw some roads: everyone travels by road, and every building needs one at its door.');
    return out;
  }
  for (const r of plan.roads) {
    if (r.x1 !== r.x2 && r.y1 !== r.y2) err('diagonal-road', `${r.name} runs at an angle: roads run north–south or east–west.`, { at: { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 } });
    if (r.x1 === r.x2 && r.y1 === r.y2) err('point-road', `${r.name} has no length.`, { at: { x: r.x1, y: r.y1 } });
  }
  if (out.some((i) => i.level === 'error')) return out;
  let buildings: Record<string, Building>;
  try {
    buildings = prebuilt ?? materialise(plan);
  } catch (e) {
    err('layout', `The plan could not be laid out: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
  const segments = plan.roads.map((r) => ({ name: r.name, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, width: r.width }));
  const g = buildRoadGraphOn(segments, buildings);
  // Distance from each entrance to its road.
  for (const id in buildings) {
    const b = buildings[id];
    const node = g.nodes[b.roadNode];
    if (!node) continue;
    const d = Math.hypot(node.x - b.entrance.x, node.y - b.entrance.y);
    if (d > ROAD_REACH) err('no-road', `${b.name}'s door is ${Math.round(d)} m from the nearest road: run a road past it.`, { ids: [id] });
    else if (d > ROAD_NEAR && b.kind !== 'runway') warn('far-road', `${b.name}'s door is ${Math.round(d)} m from the road.`, { ids: [id] });
  }
  // Connected pieces of the network: everything must be reachable from everything.
  const comp = new Map<string, number>();
  let k = 0;
  for (const start of Object.keys(g.nodes)) {
    if (comp.has(start)) continue;
    const stack = [start];
    comp.set(start, k);
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of g.adj[u] ?? []) if (!comp.has(e.to)) {
        comp.set(e.to, k);
        stack.push(e.to);
      }
    }
    k++;
  }
  const byComp = new Map<number, string[]>();
  for (const id in buildings) {
    const c = comp.get(buildings[id].roadNode);
    if (c === undefined) continue;
    (byComp.get(c) ?? byComp.set(c, []).get(c)!).push(id);
  }
  if (byComp.size > 1) {
    const groups = [...byComp.values()].sort((a, b) => b.length - a.length);
    for (const grp of groups.slice(1)) err('disconnected', `${grp.length === 1 ? buildings[grp[0]].name + ' is' : `${grp.length} buildings are`} on roads that do not join the rest: connect the roads.`, { ids: grp });
  }
  // Roads leaving the map (migrants and visitors come and go there).
  const onEdge = (x: number, y: number) => x <= 0.5 || y <= 0.5 || x >= W - 0.5 || y >= H - 0.5;
  if (!plan.roads.some((r) => onEdge(r.x1, r.y1) || onEdge(r.x2, r.y2))) note('no-exit', 'No road reaches the edge of the map: newcomers and visitors arrive at the road end nearest it.');

  // ── Overlaps ──
  const list = Object.values(buildings);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (overlap(a, b) > 4) err('overlap', `${a.name} and ${b.name} overlap.`, { ids: [a.id, b.id] });
    }
  }
  for (const s of segments) {
    const hw = (s.width ?? 7) / 2;
    const rect = { x: Math.min(s.x1, s.x2) - hw, y: Math.min(s.y1, s.y2) - hw, w: Math.abs(s.x2 - s.x1) + 2 * hw, h: Math.abs(s.y2 - s.y1) + 2 * hw };
    for (const b of list) {
      if (b.kind === 'runway') continue;
      if (overlap(rect, { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 }) > 2) warn('road-through', `${s.name} runs through ${b.name}.`, { ids: [b.id], at: { x: b.x + b.w / 2, y: b.y + b.h / 2 } });
    }
  }
  // ── Zones ──
  for (const pb of plan.buildings) {
    const s = plan.settlements.find((x) => x.id === pb.settlement);
    if (!s) continue;
    const cx = pb.x + pb.w / 2;
    const cy = pb.y + pb.h / 2;
    if (cx < s.x || cy < s.y || cx > s.x + s.w || cy > s.y + s.h) note('outside-zone', `${pb.name} belongs to ${s.name} but stands outside its zone.`, { ids: [pb.id] });
  }
  // ── Transport ──
  if (plan.track && plan.track.length >= 2) {
    const stations = plan.buildings.filter((b) => b.asset === 'station' || b.raw?.kind === 'station');
    if (stations.length < 2) warn('few-stations', 'The Hyperline needs two stations or more beside its guideway to run.');
  } else if (plan.buildings.some((b) => b.asset === 'station')) warn('no-track', 'Hyperline stations need a guideway: draw one with the Hyperline tool.');
  const ap = ['airport-terminal', 'runway'].filter((a) => plan.buildings.some((b) => b.asset === a));
  if (ap.length === 1) warn('half-airport', 'An airport needs both its terminal and its runway (place the Airfield set).');
  return out;
}

/** Counts for the builder's tools panel. */
export function planStats(plan: WorldPlan): PlanStats {
  const byAsset: Record<string, number> = {};
  for (const b of plan.buildings) byAsset[b.asset] = (byAsset[b.asset] ?? 0) + 1;
  const houses = plan.buildings.filter((b) => (b.raw?.kind ?? ASSET[b.asset]?.kind) === 'house');
  const plotsByTier = { small: byAsset['house-small'] ?? 0, standard: byAsset.house ?? 0, large: byAsset['house-large'] ?? 0 };
  let households = 0;
  for (const s of plan.settlements) {
    if (s.tier === 'civic') continue;
    const n = houses.filter((h) => h.settlement === s.id).length;
    households += Math.min(n, Math.max(0, Math.round(s.households ?? Math.max(n ? 1 : 0, Math.round(n * 0.8)))));
  }
  const posts: Record<string, number> = {};
  let businesses = 0;
  for (const b of plan.buildings) {
    const a = ASSET[b.asset];
    if (!a) continue;
    for (const s of a.staff ?? []) posts[s.job] = (posts[s.job] ?? 0) + s.n;
    if (a.business) businesses++;
  }
  const roadKm = plan.roads.reduce((s, r) => s + Math.hypot(r.x2 - r.x1, r.y2 - r.y1), 0) / 1000;
  return { buildings: plan.buildings.length, houses: houses.length, plotsByTier, households, population: Math.round(households * 3.6), roadKm: Math.round(roadKm * 100) / 100, posts, businesses, byAsset };
}
