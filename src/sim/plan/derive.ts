// From a plan to an atlas: the plan says where things are and what they are;
// this says what each is for. Which church a settlement attends and which shop
// each house buys at, who staffs the clinic and from where, which businesses
// keep books and on what footing, the bus lines, the exits at the map's edge,
// the Hyperline's stations and the airfield's runway.
//
// Anything the plan states under `institutions` is kept as stated, where the
// building it names still stands (the province states everything, so an
// unaltered province runs exactly as drawn, and an edited one keeps every
// choice its edits did not touch). Everything else is derived by rule:
//
//   a settlement's church, shop, bank, park and stop: its own, nearest the
//     middle of its houses (each house its nearest where there are several);
//   a city's school, clinic, police, court, council, medical centre, cemetery,
//     hall, rank, workshop, offices and farm: its own, nearest its houses'
//     middle, else the nearest anywhere;
//   posts: what each building's asset says it needs, the region's best-paid
//     first, then city by city, then the rest of the region;
//   books: the asset's template for the settlement's wealth (the province's
//     own businesses are the templates).

import { cityOfIn, landmarkIn, type Atlas, type BusLine, type BusinessSpec, type CitySpec, type CommunitySpec, type EssentialPost, type ExitSpec, type JobSites, type LandmarkKind, type Landmarks, type RunwaySpec, type StationSpec, type Venues } from '../atlas';
import { resetSpots } from '../layout/builders';
import type { PlotSpec, Segment } from '../layout/plots';
import { provinceAtlas } from '../layout/province';
import { cumulative, distanceAlong } from '../track';
import type { Building, JobId, Tier } from '../types';
import { buildRoadGraphOn, nodeId } from '../world';
import { ASSET, type AssetSpec } from './assets';
import { planHash } from './hash';
import { provincePlanHash } from './province';
import type { PlanBuilding, PlanInstitutions, WorldPlan } from './types';

/** Ambient public services per city, and for a centre with region-wide institutions (ZAR a month at 2026 prices). */
export const PUBLIC_SERVICES_PER_CITY = 48_000;
export const CENTRAL_SERVICES = 95_000;

// ─── Buildings ──────────────────────────────────────────────────────────────

/** The asset a plan building is, or (for a raw building whose asset is unknown) none. */
export function assetOf(b: PlanBuilding): AssetSpec | null {
  return ASSET[b.asset] ?? null;
}

function translate(b: Building, dx: number, dy: number): void {
  if (!dx && !dy) return;
  b.x += dx;
  b.y += dy;
  b.entrance = { x: b.entrance.x + dx, y: b.entrance.y + dy };
  if (b.door) b.door = { x: b.door.x + dx, y: b.door.y + dy };
  for (const r of b.rooms) {
    r.x += dx;
    r.y += dy;
    for (const s of r.spots) {
      s.x = Math.round((s.x + dx) * 10) / 10;
      s.y = Math.round((s.y + dy) * 10) / 10;
    }
  }
}

/**
 * Every building of a plan, laid out: raw ones as drawn (moved with their
 * footprint), the rest by their asset's builder. Spot ids continue after the
 * highest a raw building uses, so they stay unique.
 */
export function materialise(plan: WorldPlan): Record<string, Building> {
  let floor = 0;
  for (const pb of plan.buildings) {
    if (!pb.raw) continue;
    for (const r of pb.raw.rooms) for (const s of r.spots) {
      const m = /^s(\d+)$/.exec(s.id);
      if (m) floor = Math.max(floor, Number(m[1]));
    }
  }
  resetSpots(floor);
  const out: Record<string, Building> = {};
  for (const pb of plan.buildings) {
    let b: Building;
    if (pb.raw) {
      b = structuredClone(pb.raw);
      translate(b, pb.x - b.x, pb.y - b.y);
      b.id = pb.id;
      b.name = pb.name;
    } else {
      const a = assetOf(pb);
      if (!a) continue;
      b = a.build(pb);
      b.id = pb.id;
      b.name = pb.name;
    }
    b.community = pb.settlement;
    if (pb.plot != null) b.plot = pb.plot;
    out[b.id] = b;
  }
  return out;
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}

const centre = (r: { x: number; y: number; w: number; h: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const d2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const round = (x: number, to = 1000) => Math.max(to, Math.round(x / to) * to);

function nearest<T>(items: T[], at: (t: T) => Pt, to: Pt): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of items) {
    const d = d2(at(t), to);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

// ─── The derivation ─────────────────────────────────────────────────────────

const SETTLEMENT_KINDS: LandmarkKind[] = ['church', 'shop', 'bank', 'park', 'busstop'];
const CITY_KINDS: LandmarkKind[] = ['school', 'clinic', 'police', 'court', 'council', 'medical', 'cemetery', 'hall', 'taxi', 'workshop', 'office', 'farm', 'library', 'shop', 'bank', 'park', 'busstop', 'church'];

/** The roles a building plays: its asset's, or for a raw building the kind's usual ones. */
function rolesOf(pb: PlanBuilding): LandmarkKind[] {
  return assetOf(pb)?.roles ?? [];
}

/** Settlement-level preference: a park before a square, a general dealer before a spaza or a deli. */
function rolePreference(pb: PlanBuilding, kind: LandmarkKind): number {
  if (kind === 'park') return pb.asset === 'park' ? 0 : 1;
  if (kind === 'shop') return pb.asset === 'market' ? 0 : pb.asset === 'deli' ? 1 : 2;
  return 0;
}

const JOB_ORDER: JobId[] = ['pastor', 'dmo', 'doctor', 'magistrate', 'clerk', 'attorney', 'accountant', 'combanker', 'nurse', 'teacher', 'police', 'shopkeeper', 'banker', 'taxidriver', 'farmer', 'builder', 'vendor', 'farmhand', 'librarian', 'civilservant'];
const TOP_JOBS = new Set<JobId>(['executive', 'surgeon', 'centralbanker', 'pilot']);

export function deriveAtlas(plan: WorldPlan): Atlas {
  const I: Partial<PlanInstitutions> = plan.institutions ?? {};
  const W = plan.size.w;
  const H = plan.size.h;
  const PB: Record<string, PlanBuilding> = Object.fromEntries(plan.buildings.map((b) => [b.id, b]));
  const exists = (id: string | null | undefined): id is string => !!id && !!PB[id];
  const template = materialise(plan);
  const segments: Segment[] = plan.roads.map((r) => ({ name: r.name, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, ...(r.width ? { width: r.width } : {}) }));

  // ── Settlements and cities ──
  const settlementOf = (pb: PlanBuilding) => pb.settlement;
  const settlementCity: Record<string, string> = Object.fromEntries(plan.settlements.map((s) => [s.id, s.city]));
  const cityOfB = (pb: PlanBuilding) => settlementCity[pb.settlement] ?? plan.cities[0]?.id ?? 'city';
  const houses = plan.buildings.filter((b) => template[b.id]?.kind === 'house');
  const housesIn = (s: string) => houses.filter((h) => h.settlement === s);
  const homeCentre = (list: PlanBuilding[], fallback: Pt): Pt => (list.length ? { x: list.reduce((a, h) => a + h.x + h.w / 2, 0) / list.length, y: list.reduce((a, h) => a + h.y + h.h / 2, 0) / list.length } : fallback);
  const settlementCentre: Record<string, Pt> = Object.fromEntries(plan.settlements.map((s) => [s.id, homeCentre(housesIn(s.id), centre(s))]));
  const cityCentre: Record<string, Pt> = Object.fromEntries(plan.cities.map((c) => [c.id, homeCentre(houses.filter((h) => settlementCity[h.settlement] === c.id), centre(c))]));
  const worldCentre = homeCentre(houses, { x: W / 2, y: H / 2 });
  const tierOfS = (s: string): Tier => plan.settlements.find((x) => x.id === s)?.tier ?? 'middle';

  const communities: CommunitySpec[] = plan.settlements.map((s) => {
    const plots = housesIn(s.id)
      .map((h) => h.plot ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    // Seat every other plot first, then the rest, so vacancies interleave along the street.
    const spread = [...plots.filter((_, i) => i % 2 === 0), ...plots.filter((_, i) => i % 2 === 1)];
    const seedOrder = s.seedOrder?.length ? s.seedOrder.filter((p) => plots.includes(p)) : spread;
    const households = s.tier === 'civic' ? 0 : Math.min(seedOrder.length, Math.max(0, Math.round(s.households ?? Math.max(plots.length ? 1 : 0, Math.round(plots.length * 0.8)))));
    return { id: s.id, city: s.city, name: s.name, short: s.short, tier: s.tier, x: s.x, y: s.y, w: s.w, h: s.h, seedOrder, seedHouseholds: households, ...(s.profile && Object.keys(s.profile).length ? { profile: s.profile } : {}) };
  });

  const churchesIn = (city: string) => plan.buildings.some((b) => rolesOf(b).includes('church') && cityOfB(b) === city);
  const cities: CitySpec[] = plan.cities.map((c) => ({
    id: c.id,
    name: c.name,
    short: c.short,
    kind: c.kind,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    religious: c.religious ?? churchesIn(c.id),
    faith: c.faith ?? null,
    blurb: c.blurb ?? `${c.name}: ${plan.settlements.filter((s) => s.city === c.id && s.tier !== 'civic').map((s) => s.name).join(', ') || 'a civic centre'}`,
    ...(c.tagline ? { tagline: c.tagline } : {}),
  }));

  const residential = communities.filter((c) => c.tier !== 'civic');
  const defaultCommunity = (plan.defaultSettlement && communities.some((c) => c.id === plan.defaultSettlement) ? plan.defaultSettlement : residential[0]?.id) ?? communities[0]?.id ?? 'settlement';
  const defaultCity = settlementCity[defaultCommunity] ?? cities[0]?.id ?? 'city';

  // ── Landmarks ──
  const withRole = (kind: LandmarkKind) => plan.buildings.filter((b) => rolesOf(b).includes(kind));
  const pick = (cands: PlanBuilding[], kind: LandmarkKind, to: Pt): string | null => {
    if (!cands.length) return null;
    const best = Math.min(...cands.map((b) => rolePreference(b, kind)));
    return nearest(cands.filter((b) => rolePreference(b, kind) === best), (b) => centre(b), to)?.id ?? null;
  };
  const explicitS = I.settlementLandmarks ?? {};
  const explicitC = I.cityLandmarks ?? {};
  const settlementLandmarks: Record<string, Landmarks> = {};
  const houseLandmarks: Record<string, Landmarks> = {};
  for (const s of plan.settlements) {
    const L: Landmarks = {};
    const se = explicitS[s.id];
    // A stated table's own order first (so an unaltered province comes back exactly as stated).
    for (const kind of se ? [...(Object.keys(se) as LandmarkKind[]), ...SETTLEMENT_KINDS.filter((k) => !(k in se))] : SETTLEMENT_KINDS) {
      const entry = explicitS[s.id];
      const stated = entry?.[kind];
      if (exists(stated)) {
        L[kind] = stated;
        continue;
      }
      // Stated as none (the province's Newhaven has no church): only a building added since can take it.
      const onlyNew = !!entry && stated === undefined;
      const own = withRole(kind).filter((b) => settlementOf(b) === s.id && (!onlyNew || !b.raw));
      const id = pick(own, kind, settlementCentre[s.id]);
      if (id) L[kind] = id;
      // Several to choose from: each house its nearest.
      if (own.length > 1) {
        for (const h of housesIn(s.id)) {
          const near = pick(own, kind, centre(h));
          if (near && near !== id) (houseLandmarks[h.id] ??= {})[kind] = near;
        }
      }
    }
    settlementLandmarks[s.id] = L;
  }
  const cityLandmarks: Record<string, Landmarks> = {};
  for (const c of plan.cities) {
    const L: Landmarks = {};
    const ce = explicitC[c.id];
    for (const kind of ce ? [...(Object.keys(ce) as LandmarkKind[]), ...CITY_KINDS.filter((k) => !(k in ce))] : CITY_KINDS) {
      const entry = explicitC[c.id];
      const stated = entry?.[kind];
      if (exists(stated)) {
        L[kind] = stated;
        continue;
      }
      const onlyNew = !!entry && stated === undefined;
      const own = withRole(kind).filter((b) => cityOfB(b) === c.id && (!onlyNew || !b.raw));
      const id = pick(own, kind, cityCentre[c.id]);
      if (id) L[kind] = id;
    }
    cityLandmarks[c.id] = L;
  }
  const regionLandmarks: Landmarks = { ...(I.regionLandmarks ?? {}) };
  for (const k of Object.keys(regionLandmarks) as LandmarkKind[]) if (!exists(regionLandmarks[k])) delete regionLandmarks[k];
  for (const kind of CITY_KINDS) {
    if (kind === 'church' || regionLandmarks[kind]) continue;
    // A stated table keeps its gaps for the buildings drawn with it; a building added since may fill one.
    const id = pick(withRole(kind).filter((b) => !I.regionLandmarks || !b.raw), kind, worldCentre);
    if (id) regionLandmarks[kind] = id;
  }
  const fallbackCity = I.fallbackCity && cities.some((c) => c.id === I.fallbackCity) ? I.fallbackCity : null;

  // ── Lists of institutions ──
  const byAsset = (...ids: string[]) => plan.buildings.filter((b) => ids.includes(b.asset));
  const cityOrder = (list: PlanBuilding[]) => [...list].sort((a, b) => plan.cities.findIndex((c) => c.id === cityOfB(a)) - plan.cities.findIndex((c) => c.id === cityOfB(b)));
  // A stated list keeps its order and gains only buildings added since (never ones it left out on purpose).
  const keep = (stated: string[] | undefined, derived: string[]) => (stated ? [...stated.filter(exists), ...derived.filter((id) => !stated.includes(id) && !PB[id]?.raw)] : derived);
  const churchIds = keep(I.churchIds, plan.settlements.flatMap((s) => withRole('church').filter((b) => b.settlement === s.id).map((b) => b.id)));
  const hospitals = byAsset('hospital');
  const clinicIds = keep(I.clinicIds, [...cityOrder(byAsset('clinic')).map((b) => b.id), ...hospitals.map((b) => b.id)]);
  const courtIds = keep(I.courtIds, cityOrder(byAsset('court')).map((b) => b.id));
  const policeIds = keep(I.policeIds, cityOrder(byAsset('police')).map((b) => b.id));
  const councilIds: Record<string, string | null> = {};
  for (const c of plan.cities) {
    const stated = I.councilIds?.[c.id];
    const onlyNew = !!I.councilIds && c.id in I.councilIds;
    councilIds[c.id] = exists(stated) ? stated : pick(byAsset('council').filter((b) => cityOfB(b) === c.id && (!onlyNew || !b.raw)), 'council', cityCentre[c.id]);
  }
  const taxiRankIds = keep(I.taxiRankIds, [...cityOrder(byAsset('taxi')), ...byAsset('terminus')].map((b) => b.id));
  const centralHospital = exists(I.centralHospital) ? I.centralHospital : hospitals[0]?.id ?? null;
  const ambulanceBases = I.ambulanceBases
    ? [...I.ambulanceBases.filter((x) => exists(x.id)), ...byAsset('clinic', 'ambulance', 'airport-fire').filter((b) => !I.ambulanceBases!.some((x) => x.id === b.id)).map((b) => ({ id: b.id, n: b.asset === 'ambulance' ? 2 : 1 }))]
    : [...cityOrder(byAsset('clinic')).map((b) => ({ id: b.id, n: 1 })), ...byAsset('ambulance').map((b) => ({ id: b.id, n: 2 })), ...byAsset('airport-fire').map((b) => ({ id: b.id, n: 1 })), ...(byAsset('ambulance').length ? [] : hospitals.map((b) => ({ id: b.id, n: 1 })))];
  const runwayB = byAsset('runway')[0] ?? plan.buildings.find((b) => b.raw?.kind === 'runway');
  const terminalB = byAsset('airport-terminal')[0] ?? plan.buildings.find((b) => b.raw?.kind === 'terminal');
  const airportTerminal = exists(I.airportTerminal) ? I.airportTerminal : terminalB && runwayB ? terminalB.id : null;
  const busHub = exists(I.busHub) ? I.busHub : byAsset('terminus')[0]?.id ?? null;

  // ── The runway: centreline, thresholds 40 m in, the taxiway along the airside road ──
  let runway: RunwaySpec | null = null;
  if (airportTerminal && runwayB) {
    const stated = I.runway;
    if (stated && (!runwayB.raw || (runwayB.raw.x === runwayB.x && runwayB.raw.y === runwayB.y))) runway = { ...stated };
    else {
      const rx = runwayB.x + runwayB.w / 2;
      const airside = segments.filter((s) => s.y1 === s.y2 && Math.max(s.x1, s.x2) <= runwayB.x && Math.max(s.x1, s.x2) >= runwayB.x - 120 && s.y1 > runwayB.y && s.y1 < runwayB.y + runwayB.h);
      const tw = nearest(airside, (s) => ({ x: Math.max(s.x1, s.x2), y: s.y1 }), centre(PB[airportTerminal]));
      runway = { x: rx, north: runwayB.y + 40, south: runwayB.y + runwayB.h - 40, taxiwayX: runwayB.x - 40, taxiwayY: tw ? tw.y1 : PB[airportTerminal].y + PB[airportTerminal].h / 2 };
    }
  }

  // ── The Hyperline ──
  const track = (plan.track ?? []).map((p) => ({ x: p.x, y: p.y }));
  const cum = cumulative(track);
  let stations: StationSpec[] = [];
  const stationBs = byAsset('station').concat(plan.buildings.filter((b) => b.asset !== 'station' && b.raw?.kind === 'station'));
  if (track.length >= 2) {
    const stated = (I.stations ?? []).filter((s) => exists(s.id) && PB[s.id].raw && PB[s.id].raw!.x === PB[s.id].x && PB[s.id].raw!.y === PB[s.id].y);
    const derived = stationBs
      .filter((b) => !stated.some((s) => s.id === b.id))
      .map((b): StationSpec => {
        const bb = template[b.id];
        const plat = bb?.rooms.find((r) => r.id.endsWith('-platform')) ?? bb?.rooms[0];
        const at = plat ? centre(plat) : centre(b);
        // The point on the guideway nearest the platform.
        let best = { x: track[0].x, y: track[0].y, d: Infinity };
        for (let i = 1; i < track.length; i++) {
          const a = track[i - 1];
          const c = track[i];
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const len2 = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2));
          const p = { x: a.x + u * dx, y: a.y + u * dy };
          const d = d2(p, at);
          if (d < best.d) best = { ...p, d };
        }
        const x = Math.round(best.x);
        const y = Math.round(best.y);
        return { id: b.id, name: b.name.replace(/ (Hyperline )?Station$/, ''), x, y, t: distanceAlong(track, cum, x, y) };
      })
      // A station further than 60 m from the guideway is not on the line.
      .filter((s) => {
        const b = PB[s.id];
        return Math.sqrt(d2(s, centre(b))) <= Math.max(b.w, b.h) / 2 + 60;
      });
    stations = [...stated.map((s) => ({ ...s, t: distanceAlong(track, cum, s.x, s.y) })), ...derived].sort((a, b) => a.t - b.t);
    if (I.stations && !derived.length && stated.length === I.stations.length) stations = I.stations.map((s) => ({ ...s }));
  }

  // ── Bus lines ──
  let busLines: BusLine[];
  const stops = byAsset('busstop').concat(plan.buildings.filter((b) => b.asset !== 'busstop' && b.raw?.kind === 'busstop'));
  const statedLines = plan.busLines ?? null;
  if (statedLines) {
    busLines = statedLines.map((l) => ({ ...l, stops: l.stops.filter(exists) })).filter((l) => l.stops.length >= 2);
  } else {
    busLines = [];
    const hub = busHub ? PB[busHub] : null;
    for (const c of plan.cities) {
      const own = stops.filter((b) => cityOfB(b) === c.id);
      if (!own.length || (own.length < 2 && !hub)) continue;
      // From the stop farthest from the hub (or the city's middle), each next stop the nearest unvisited, ending at the hub.
      const end = hub ? centre(hub) : cityCentre[c.id];
      const left = [...own];
      const seq: PlanBuilding[] = [];
      let cur = left.reduce((a, b) => (d2(centre(b), end) > d2(centre(a), end) ? b : a), left[0]);
      while (cur) {
        seq.push(cur);
        left.splice(left.indexOf(cur), 1);
        cur = nearest(left, (b) => centre(b), centre(cur))!;
      }
      const ids = seq.map((b) => b.id);
      if (hub && !ids.includes(hub.id)) ids.push(hub.id);
      if (ids.length >= 2) busLines.push({ id: `line-${c.id}`, name: `${c.name} Line`, stops: ids });
    }
    const apStop = airportTerminal ? nearest(stops, (b) => centre(b), centre(PB[airportTerminal])) : null;
    if (hub && apStop && Math.sqrt(d2(centre(apStop), centre(PB[airportTerminal!]))) < 200 && !busLines.some((l) => l.stops.includes(apStop.id))) busLines.push({ id: 'airport', name: 'Airport Shuttle', stops: [hub.id, apStop.id] });
  }

  // ── Exits: where roads leave the map ──
  let exits: ExitSpec[] = (I.exits ?? []).filter((e) => segments.some((s) => (s.x1 === e.x && s.y1 === e.y) || (s.x2 === e.x && s.y2 === e.y)));
  if (!exits.length) {
    const seen = new Set<string>();
    const onEdge = (x: number, y: number) => x <= 0.5 || y <= 0.5 || x >= W - 0.5 || y >= H - 0.5;
    for (const s of segments) {
      for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as Array<[number, number]>) {
        const node = nodeId(x, y);
        if (!onEdge(x, y) || seen.has(node)) continue;
        seen.add(node);
        const side = x <= 0.5 ? 'west' : x >= W - 0.5 ? 'east' : y <= 0.5 ? 'north' : 'south';
        exits.push({ id: `${side}-${exits.length + 1}`, x, y, node });
      }
    }
    if (!exits.length && segments.length) {
      // No road reaches the edge: newcomers and visitors arrive at the road end nearest it.
      const graph = buildRoadGraphOn(segments, structuredClone(template));
      const nodes = Object.values(graph.nodes);
      const edgeDist = (n: Pt) => Math.min(n.x, n.y, W - n.x, H - n.y);
      const n = nodes.reduce((a, b) => (edgeDist(b) < edgeDist(a) ? b : a), nodes[0]);
      exits = [{ id: 'gate', x: n.x, y: n.y, node: n.id }];
    }
  }

  // ── Pay scales, the bank, the chambers and commercial banks ──
  const banks = byAsset('bank');
  const hqStated = I.bankHq;
  const bankHq = exists(hqStated) ? hqStated : banks.find((b) => b.options?.hq === true)?.id ?? nearest(banks, (b) => centre(b), worldCentre)?.id ?? null;
  const spazaIds = keep(I.spazaIds, byAsset('spaza').map((b) => b.id));
  const marketIds = keep(I.marketIds, byAsset('market').map((b) => b.id));
  const deliIds = keep(I.deliIds, byAsset('deli').map((b) => b.id));
  const counterIds = keep(I.counterIds, banks.filter((b) => b.id !== bankHq).map((b) => b.id)).filter((id) => id !== bankHq);
  const forCities = (assetIds: string[], stated: Record<string, string | null> | undefined) => {
    const out: Record<string, string | null> = {};
    const all = byAsset(...assetIds);
    for (const c of plan.cities) {
      const s = stated?.[c.id];
      if (exists(s)) out[c.id] = s;
      else {
        const own = all.filter((b) => cityOfB(b) === c.id);
        out[c.id] = (own.length ? nearest(own, (b) => centre(b), cityCentre[c.id]) : nearest(all, (b) => centre(b), cityCentre[c.id]))?.id ?? null;
      }
    }
    return out;
  };
  const chambersByCity = forCities(['chambers'], I.chambersByCity);
  const combankByCity = forCities(['combank'], I.combankByCity);

  // ── Venues and the produce market ──
  const first = (asset: string) => byAsset(asset)[0]?.id ?? null;
  const produceMarket = exists(I.produceMarket) ? I.produceMarket : nearest(byAsset('market'), (b) => centre(b), worldCentre)?.id ?? null;
  const farms = byAsset('farm');
  // The farm nearest the produce market, its own city's first.
  const marketFarms = produceMarket ? farms.filter((f) => cityOfB(f) === cityOfB(PB[produceMarket])) : [];
  const produceFarm = exists(I.produceFarm) ? I.produceFarm : produceMarket ? nearest(marketFarms.length ? marketFarms : farms, (b) => centre(b), centre(PB[produceMarket]))?.id ?? null : null;
  const statedV = I.venues;
  const v = (k: keyof Venues, derived: string | null) => (statedV && exists(statedV[k]) ? statedV[k] : derived);
  const shopsAll = plan.buildings.filter((b) => rolesOf(b).includes('shop'));
  const centreId = v('centre', first('mall') ?? produceMarket ?? nearest(shopsAll, (b) => centre(b), worldCentre)?.id ?? first('council') ?? plan.buildings.find((b) => template[b.id]?.kind !== 'house')?.id ?? null);
  const venues: Venues = {
    grandpark: v('grandpark', first('grandpark')),
    sports: v('sports', first('sports')),
    mall: v('mall', first('mall')),
    stadium: v('stadium', first('stadium')),
    concert: v('concert', first('concert')),
    centre: centreId,
    centralStation: v('centralStation', centreId && stations.length ? nearest(stations, (s) => s, centre(PB[centreId]))?.id ?? null : null),
  };

  // ── Businesses ──
  const region = plan.region || 'Unity';
  // The province seats a hundred households; a world's region-wide operators scale with its own.
  const seeded = communities.reduce((s, c) => s + c.seedHouseholds, 0);
  const marketScale = I.marketScale ?? Math.max(0.05, Math.min(5, seeded / 100));
  const statedBiz = (I.businesses ?? []).filter((b) => exists(b.id) || (b.kind === 'transit' || b.kind === 'platform' || b.kind === 'fleet' || (b.kind === 'airport' && !!airportTerminal)));
  const statedIds = new Set(statedBiz.map((b) => b.id));
  const businesses: BusinessSpec[] = [...statedBiz.map((b) => ({ ...b }))];
  for (const pb of plan.buildings) {
    if (statedIds.has(pb.id)) continue;
    const a = assetOf(pb);
    if (!a?.business || pb.raw && I.businesses) continue;
    const t = tierOfS(pb.settlement);
    const spec = a.business(t === 'civic' ? 'middle' : t, pb);
    if (spec) businesses.push({ id: pb.id, city: cityOfB(pb), ...spec });
  }
  // Each chambers briefs the cities that use it, each commercial bank banks theirs.
  for (const b of businesses) {
    if (b.clientCities || statedIds.has(b.id)) continue;
    if (b.kind === 'practice') b.clientCities = plan.cities.filter((c) => chambersByCity[c.id] === b.id).map((c) => c.id);
    if (b.kind === 'combank') b.clientCities = plan.cities.filter((c) => combankByCity[c.id] === b.id).map((c) => c.id);
  }
  const hasTransit = busLines.length > 0 || stations.length >= 2;
  const have = (id: string) => businesses.some((b) => b.id === id);
  const primaryCity = defaultCity;
  if (!have('transit')) businesses.push({ id: 'transit', name: `${region} Transit`, kind: 'transit', city: primaryCity, regime: 'exempt', vatRegistered: false, sdl: true, opening: hasTransit ? { '1020': 1_400_000 } : {}, openingMemo: 'Opening balances: working capital from the transport department (the buses and any guideway are public assets)' });
  if (!have('hamba')) businesses.push({ id: 'hamba', name: 'Hamba (e-hailing app)', kind: 'platform', city: primaryCity, regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': round(120_000 * marketScale), '1500': round(60_000 * marketScale) }, openingMemo: 'Opening balances: working capital and the app platform', dep: round(60_000 * marketScale) / 36 });
  if (!have('fleet')) businesses.push({ id: 'fleet', name: `${region} Fleet Rentals`, kind: 'fleet', city: primaryCity, regime: 'sbc', vatRegistered: true, sdl: false, opening: { '1020': 120_000 }, openingMemo: 'Opening balances: working capital (the cars are brought in at cost)' });
  if (airportTerminal && !have('airportco')) businesses.push({ id: 'airportco', name: `${region} Airport Company`, kind: 'airport', city: cityOfB(PB[airportTerminal]), regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 450_000, '1500': 2_400_000 }, openingMemo: 'Opening balances: working capital, terminal systems and ground equipment (the runway is public)', dep: 2_400_000 / 240 });
  const publicWorkplaces = keep(I.publicWorkplaces, plan.buildings.filter((b) => assetOf(b)?.public).map((b) => b.id));

  // ── The posts a community cannot leave empty ──
  let essentialPosts: EssentialPost[];
  if (I.essentialPosts) {
    const covered = new Set(I.essentialPosts.map((p) => p.workplace).filter(Boolean));
    essentialPosts = [...I.essentialPosts.filter((p) => !p.workplace || exists(p.workplace)), ...postsFor(plan.buildings.filter((b) => !covered.has(b.id) && !b.raw), cityOfB, plan.cities.map((c) => c.id))];
  } else essentialPosts = postsFor(plan.buildings, cityOfB, plan.cities.map((c) => c.id));
  // A bus line needs drivers: Unity Transit's, from anywhere.
  if (!I.essentialPosts && busLines.length && busHub) for (let i = 0; i < 4; i++) essentialPosts.push({ job: 'busdriver', workplace: busHub });

  const jobSites: JobSites = I.jobSites
    ? { region: Object.fromEntries(Object.entries(I.jobSites.region).filter(([, id]) => exists(id))), city: Object.fromEntries(Object.entries(I.jobSites.city).map(([c, m]) => [c, Object.fromEntries(Object.entries(m).filter(([, id]) => exists(id)))])) }
    : { region: {}, city: {} };
  const setRegion = (job: JobId, id: string | null | undefined) => {
    if (id && !jobSites.region[job]) jobSites.region[job] = id;
  };
  setRegion('surgeon', centralHospital);
  setRegion('executive', first('towers'));
  setRegion('civilservant', first('govt') ?? first('post'));
  setRegion('centralbanker', first('reservebank'));
  setRegion('librarian', first('library'));
  setRegion('pilot', airportTerminal);
  setRegion('busdriver', busHub ?? busLines[0]?.stops[0] ?? null);
  for (const c of plan.cities) {
    const post = byAsset('post').find((b) => cityOfB(b) === c.id);
    if (post && !jobSites.city[c.id]?.civilservant) (jobSites.city[c.id] ??= {}).civilservant = post.id;
  }

  // ── Public services, owners' names ──
  const cityCount = cities.filter((c) => c.kind === 'city' && plan.buildings.some((b) => cityOfB(b) === c.id && assetOf(b)?.public)).length;
  const central = plan.buildings.some((b) => ['hospital', 'govt', 'reservebank', 'grandpark', 'stadium', 'concert', 'sports'].includes(b.asset));
  const publicServicesCost = I.publicServicesCost ?? PUBLIC_SERVICES_PER_CITY * cityCount + (central ? CENTRAL_SERVICES : 0);
  const publicServicesMemo = I.publicServicesMemo ?? `Public services: ${cityCount === 1 ? "the city's" : `${cityCount} cities'`} clinics, schools, police, courts and councils${central ? '; the region\'s hospital, government and parks' : ''}`;
  const ownerNames = I.ownerNames
    ? I.ownerNames.filter((o) => exists(o.id))
    : plan.buildings.filter((b) => assetOf(b)?.ownerName && b.options?.ownerNamed !== false).map((b) => ({ id: b.id, ...assetOf(b)!.ownerName! }));

  const atlas: Atlas = {
    id: plan.id,
    name: plan.name || null,
    region: plan.region || null,
    plan,
    hash: planHash(plan),
    width: W,
    height: H,
    cities,
    communities,
    defaultCommunity,
    defaultCity,
    baseline: plan.baseline && communities.some((c) => c.id === plan.baseline) ? plan.baseline : null,
    segments,
    plots: houses
      .map((h): PlotSpec => ({ plot: h.plot ?? 0, x: h.x, y: h.y, w: h.w, h: h.h, facing: h.facing === 'N' ? 'north' : 'south', community: h.settlement, tier: h.asset === 'house-small' ? 'small' : h.asset === 'house-large' ? 'large' : 'standard' }))
      .sort((a, b) => a.plot - b.plot),
    buildings: () => structuredClone(template),
    settlementLandmarks,
    cityLandmarks,
    regionLandmarks,
    houseLandmarks: I.houseLandmarks ? { ...Object.fromEntries(Object.entries(I.houseLandmarks).filter(([h]) => exists(h))), ...houseLandmarks } : houseLandmarks,
    fallbackCity,
    churchIds,
    clinicIds,
    courtIds,
    policeIds,
    councilIds,
    taxiRankIds,
    centralHospital,
    ambulanceBases,
    airportTerminal,
    busHub,
    busLines,
    track: stations.length >= 2 ? track : [],
    stations: stations.length >= 2 ? stations : [],
    runway,
    exits,
    businesses,
    publicWorkplaces,
    spazaIds,
    marketIds,
    deliIds,
    counterIds,
    bankHq,
    chambersByCity,
    combankByCity,
    essentialPosts,
    jobSites,
    produceMarket,
    produceFarm,
    venues,
    publicServicesCost,
    publicServicesMemo,
    marketScale,
    ownerNames,
  };
  return atlas;
}

/** The posts each building's asset asks for, the region's best-paid first, then city by city, then the rest of the region. */
function postsFor(buildings: PlanBuilding[], cityOfB: (b: PlanBuilding) => string, cityIds: string[]): EssentialPost[] {
  const top: EssentialPost[] = [];
  const byCity: Record<string, Array<EssentialPost & { order: number }>> = {};
  const rest: EssentialPost[] = [];
  buildings.forEach((b, bi) => {
    const a = assetOf(b);
    for (const s of a?.staff ?? []) {
      for (let i = 0; i < s.n; i++) {
        const post: EssentialPost = { job: s.job, workplace: b.id };
        if (s.from === 'settlement') post.community = b.settlement;
        if (s.from === 'city') post.city = cityOfB(b);
        if (s.from === 'region') {
          (TOP_JOBS.has(s.job) ? top : rest).push(post);
          continue;
        }
        const c = cityOfB(b);
        const rank = JOB_ORDER.indexOf(s.job);
        (byCity[c] ??= []).push({ ...post, order: (rank < 0 ? JOB_ORDER.length : rank) * 10_000 + bi });
      }
    }
  });
  const out: EssentialPost[] = [...top.sort((x, y) => [...TOP_JOBS].indexOf(x.job) - [...TOP_JOBS].indexOf(y.job))];
  for (const c of cityIds) for (const p of (byCity[c] ?? []).sort((x, y) => x.order - y.order)) out.push({ job: p.job, workplace: p.workplace, ...(p.community ? { community: p.community } : {}), ...(p.city ? { city: p.city } : {}) });
  out.push(...rest);
  return out;
}

// ─── The atlas a run uses ───────────────────────────────────────────────────

const cache = new Map<string, Atlas>();

/** The atlas a run uses: the built-in province without a plan (or with the province's own plan, unaltered), else the plan's. */
export function atlasFor(plan: WorldPlan | null | undefined): Atlas {
  if (!plan) return provinceAtlas();
  const h = planHash(plan);
  if (h === provincePlanHash()) return provinceAtlas();
  let a = cache.get(h);
  if (!a) {
    a = deriveAtlas(plan);
    cache.set(h, a);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return a;
}

/** Re-exported for the builder: the landmark a settlement would use, read from a derived atlas without installing it. */
export { cityOfIn, landmarkIn };
