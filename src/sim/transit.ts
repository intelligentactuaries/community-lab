// Public transport and the airport: the bus lines on the road network, the
// Hyperline (two trains shuttling on an elevated guideway) and the aeroplanes
// that fly the province's day trips. These vehicles run to timetables rather
// than to households: riders walk to a stop, board what comes their way and
// walk on from where they get off. Everything here is micro-mode animation;
// the day step never depends on it.

import type { Ctx } from './ctx';
import { alivePeople, dist } from './ctx';
import { affluence } from './institutions';
import { arrivalDir, entryPath, lanePolyline, roadPolyline, setOff, stepAlong, walkOn } from './movement';
import { bayFor, parkPath } from './parking';
import type { Rng } from './rng';
import type { Building, Person, Vehicle, World } from './types';
import { AIRPORT_TERMINAL, BUS_HUB, BUS_LINE, BUS_LINES, RUNWAY, STATIONS, roomByKind, trackPoint, type BusLine } from './world';

// ─── Buses ──────────────────────────────────────────────────────────────────

export const BUS_SPEED = 420; // m/min ≈ 25 km/h between stops
export const BUS_SEATS = 40;
export const BUSES_PER_LINE = 2;
export const BUS_DWELL = 1; // minutes standing at a stop
export const BUS_LAYOVER = 4; // at the end of the line
export const BUS_HOURS: [number, number] = [330, 1290]; // 05:30–21:30

// ─── The Hyperline ──────────────────────────────────────────────────────────

export const HYPERLINE = 'hyperline';
export const TRAINS = 2;
export const TRAIN_SEATS = 120;
export const TRAIN_LENGTH = 42; // metres, for the renderer
export const TRAIN_DWELL = 2;
export const TRAIN_LAYOVER = 3;
export const TRAIN_HOURS: [number, number] = [300, 1410]; // 05:00–23:30
/** Metres per minute per Mach (340 m/s at sea level). At Mach 5 a train covers the whole line in under five seconds. */
export const MACH = 20_400;
/** Metres over which a train is launched to cruise, and caught again: the length of a platform. */
const LAUNCH_RAMP = 60;
export function trainCruise(mach: number): number {
  return Math.max(1, mach) * MACH;
}

// ─── The aeroplanes ─────────────────────────────────────────────────────────

export const PLANES = 2;
export const PLANE_SEATS = 24;
/**
 * The day's flights: wheels-up and back-on-the-ground minutes. The two planes
 * take them in turn — a 100-minute round trip is 40 minutes each way and a
 * turnaround away. A day-tripper flies out on one and home on a later one.
 */
export const FLIGHTS: Array<{ dep: number; arr: number }> = [
  { dep: 400, arr: 500 }, // 06:40 → 08:20
  { dep: 550, arr: 650 }, // 09:10 → 10:50
  { dep: 750, arr: 850 }, // 12:30 → 14:10
  { dep: 940, arr: 1040 }, // 15:40 → 17:20
  { dep: 1100, arr: 1190 }, // 18:20 → 19:50
];
/** Outbound flights a day-tripper may take, and the ones home. */
export const OUTBOUND = [0, 1];
export const HOMEBOUND = [3, 4];
const BOARDING_MIN = 25;
const GROUND_SPEED = 400; // taxiing
const TAKEOFF_SPEED = 3600; // ≈ 215 km/h over the runway
const LANDING_SPEED = 2600;

// ─── Riders ─────────────────────────────────────────────────────────────────

/** How far people will walk to a Hyperline station, and to a bus stop. */
export const TRAIN_WALK = 800;
export const BUS_WALK = 350;
const BOARD_RADIUS = 80;

const withinHours = (mod: number, [lo, hi]: [number, number]) => mod >= lo && mod < hi;

export interface TransitPlan {
  lineId: string;
  /** Where to wait, and the spot to stand at. */
  stop: Building;
  wait: { x: number; y: number };
  /** The stop to get off at. */
  alightAt: string;
}

function stationIndex(id: string | null): number {
  return STATIONS.findIndex((s) => s.id === id);
}

function nearestStation(world: World, b: Building): { id: string; idx: number; d: number } | null {
  let best: { id: string; idx: number; d: number } | null = null;
  STATIONS.forEach((s, idx) => {
    const sb = world.buildings[s.id];
    if (!sb) return;
    const d = dist(b.entrance.x, b.entrance.y, sb.entrance.x, sb.entrance.y);
    if (!best || d < best.d) best = { id: s.id, idx, d };
  });
  return best;
}

function nearestStopOn(world: World, line: BusLine, pt: { x: number; y: number }): { id: string; idx: number; d: number } | null {
  let best: { id: string; idx: number; d: number } | null = null;
  line.stops.forEach((id, idx) => {
    const sb = world.buildings[id];
    if (!sb) return;
    const d = dist(pt.x, pt.y, sb.entrance.x, sb.entrance.y);
    if (!best || d < best.d) best = { id, idx, d };
  });
  return best;
}

/** A seat in the shelter or on the platform to wait at. */
function waitSpot(rng: Rng, stop: Building): { x: number; y: number } {
  const room = roomByKind(stop, 'stop') ?? stop.rooms[0];
  const seats = room?.spots.filter((s) => s.kind === 'seat') ?? [];
  if (seats.length) {
    const s = rng.pick(seats);
    return { x: s.x, y: s.y };
  }
  return { x: stop.x + stop.w / 2, y: stop.y + stop.h / 2 };
}

/** The stop of a line (or the Hyperline station) nearest a building: where someone boards. */
export function boardingStopFor(world: World, lineId: string, fromB: Building): Building | null {
  if (lineId === HYPERLINE) {
    const st = nearestStation(world, fromB);
    return st ? world.buildings[st.id] ?? null : null;
  }
  const line = BUS_LINE[lineId];
  const stop = line ? nearestStopOn(world, line, fromB.entrance) : null;
  return stop ? world.buildings[stop.id] ?? null : null;
}

/** A seat to wait on at a stop. */
export function waitSpotFor(ctx: Ctx, stop: Building): { x: number; y: number } {
  return waitSpot(ctx.rng.stream('movement'), stop);
}

/**
 * How someone without a car at hand gets across the province: the Hyperline
 * where a station is within a walk of both ends (four times in five — the
 * fifth takes a taxi), else a bus where one line serves both ends, more
 * readily the poorer the traveller's settlement. Null means a taxi or a walk.
 */
export function planTransit(ctx: Ctx, p: Person, fromB: Building, toB: Building): TransitPlan | null {
  const world = ctx.world;
  const rng = ctx.rng.stream('movement');
  const mod = world.minuteOfDay;
  if (withinHours(mod, TRAIN_HOURS)) {
    const a = nearestStation(world, fromB);
    const b = nearestStation(world, toB);
    if (a && b && a.idx !== b.idx && a.d <= TRAIN_WALK && b.d <= TRAIN_WALK && rng.bernoulli(0.8)) {
      const stop = world.buildings[a.id];
      return { lineId: HYPERLINE, stop, wait: waitSpot(rng, stop), alightAt: b.id };
    }
  }
  if (withinHours(mod, BUS_HOURS)) {
    let best: { line: BusLine; a: { id: string; idx: number; d: number }; b: { id: string; idx: number; d: number }; walk: number } | null = null;
    for (const line of BUS_LINES) {
      const a = nearestStopOn(world, line, fromB.entrance);
      const b = nearestStopOn(world, line, toB.entrance);
      if (!a || !b || a.idx === b.idx || a.d > BUS_WALK || b.d > BUS_WALK) continue;
      if (!best || a.d + b.d < best.walk) best = { line, a, b, walk: a.d + b.d };
    }
    if (best) {
      const home = world.buildings[world.households[p.householdId]?.houseId ?? '']?.community;
      if (rng.bernoulli(0.75 - 0.45 * affluence(home))) {
        const stop = world.buildings[best.a.id];
        return { lineId: best.line.id, stop, wait: waitSpot(rng, stop), alightAt: best.b.id };
      }
    }
  }
  return null;
}

// ─── The fleet ──────────────────────────────────────────────────────────────

/** Buses at the ends of their lines, the trains at the ends of theirs, the planes on their stands. */
export function seedTransit(ctx: Ctx, mk: (kind: Vehicle['kind'], x: number, y: number, baseId: string) => Vehicle): void {
  const world = ctx.world;
  for (const line of BUS_LINES) {
    for (let i = 0; i < BUSES_PER_LINE; i++) {
      const idx = i % 2 === 0 ? 0 : line.stops.length - 1;
      const stop = world.buildings[line.stops[idx]];
      // Each bus in a bay of its own (the terminus holds several lines' buses).
      const at = bayFor(world, stop, 'bus', null);
      const v = mk('bus', at.x, at.y, stop.id);
      v.heading = at.heading;
      v.homeHeading = at.heading;
      v.lineId = line.id;
      v.stopIdx = idx;
      v.dir = idx === 0 ? 1 : -1;
    }
  }
  for (let i = 0; i < TRAINS; i++) {
    const idx = i % 2 === 0 ? 0 : STATIONS.length - 1;
    const st = STATIONS[idx];
    const v = mk('train', st.x, st.y, st.id);
    v.lineId = HYPERLINE;
    v.stopIdx = idx;
    v.dir = idx === 0 ? 1 : -1;
    v.trackPos = st.t;
    v.heading = trackPoint(st.t).heading + (v.dir > 0 ? 0 : Math.PI);
  }
  const terminal = world.buildings[AIRPORT_TERMINAL];
  const stands = roomByKind(terminal, 'yard')?.spots ?? [];
  for (let i = 0; i < PLANES; i++) {
    const s = stands[i % Math.max(1, stands.length)];
    const v = mk('plane', s?.x ?? terminal.x + terminal.w + 40, s?.y ?? terminal.y + 30 + i * 60, AIRPORT_TERMINAL);
    v.lineId = `air:${i}`;
    v.stopIdx = i;
    v.heading = Math.PI / 2;
  }
}

/** Time-lapse reset: everything back to where it started the day. */
export function resetTransit(world: World): void {
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind === 'bus') {
      const line = v.lineId ? BUS_LINE[v.lineId] : null;
      v.stopIdx = Math.max(0, line?.stops.indexOf(v.baseId ?? '') ?? 0);
      v.dir = v.stopIdx === 0 ? 1 : -1;
    } else if (v.kind === 'train') {
      v.stopIdx = Math.max(0, stationIndex(v.baseId));
      v.dir = v.stopIdx === 0 ? 1 : -1;
      v.trackPos = STATIONS[v.stopIdx].t;
      v.heading = trackPoint(v.trackPos).heading + (v.dir > 0 ? 0 : Math.PI);
    } else if (v.kind === 'plane') {
      v.stopIdx = planeIndex(v);
      v.heading = Math.PI / 2;
    }
    v.dwell = 0;
    v.speed = 0;
    v.airborne = false;
  }
}

// ─── Running ────────────────────────────────────────────────────────────────

/** One micro step for the timetabled vehicles; buses move with the road traffic and only take their stop decisions here. */
export function transitStep(ctx: Ctx, dtMin: number, minuteTick: boolean): void {
  const world = ctx.world;
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind === 'train') trainStep(ctx, v, dtMin, minuteTick);
    else if (v.kind === 'plane') planeStep(ctx, v, dtMin, minuteTick);
    else if (v.kind === 'bus' && minuteTick && !v.moving) busMinute(ctx, v);
  }
}

function carry(world: World, v: Vehicle): void {
  for (const pid of v.occupantIds) {
    const q = world.people[pid];
    if (q) {
      q.loc.x = v.x;
      q.loc.y = v.y;
      q.heading = v.heading;
    }
  }
}

/** Everyone waiting at this stop for this line, going this way, climbs aboard. */
function boardRiders(ctx: Ctx, v: Vehicle, lineId: string, hereIdx: number, indexOf: (id: string | null) => number, seats: number): void {
  const world = ctx.world;
  for (const p of alivePeople(world)) {
    if (v.occupantIds.length >= seats) break;
    if (p.away || p.inVehicleId || p.waitingLine !== lineId) continue;
    // a small child a few steps behind their grown-up is waited for
    const child = p.age < 12;
    if (p.path.length && !(child && dist(p.loc.x, p.loc.y, v.x, v.y) <= 120)) continue;
    if (dist(p.loc.x, p.loc.y, v.x, v.y) > (child ? 120 : BOARD_RADIUS)) continue;
    const j = indexOf(p.alightAt);
    if (j < 0 || Math.sign(j - hereIdx) !== v.dir) continue;
    p.waitingLine = null;
    p.waitedMin = 0;
    p.inVehicleId = v.id;
    p.path = [];
    p.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
    v.occupantIds.push(p.id);
    if (lineId === HYPERLINE) world.stats.trainRides++;
    else world.stats.busRides++;
  }
}

/** Riders for this stop get off and walk on to wherever they were going. */
function alight(ctx: Ctx, v: Vehicle, hereId: string, everyone = false): void {
  const world = ctx.world;
  const stay: string[] = [];
  for (const pid of v.occupantIds) {
    const q = world.people[pid];
    if (!q) continue;
    if (everyone || q.alightAt === hereId || !q.alive || q.away) {
      q.inVehicleId = null;
      q.alightAt = null;
      q.waitingLine = null;
      q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
      if (q.alive && !q.away) walkOn(ctx, q);
    } else stay.push(pid);
  }
  v.occupantIds = stay;
  if (v.driverId && !v.occupantIds.includes(v.driverId)) v.driverId = null;
}

// ── Buses ──

/** The minute a bus last pulled out of each stop, per world. */
const departures = new WeakMap<World, Map<string, number>>();

function busMinute(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const line = v.lineId ? BUS_LINE[v.lineId] : null;
  if (!line) return;
  const mod = world.minuteOfDay;
  boardRiders(ctx, v, line.id, v.stopIdx, (id) => line.stops.indexOf(id ?? ''), BUS_SEATS);
  driverChange(ctx, v, line);
  if (!withinHours(mod, BUS_HOURS)) return; // holds at the stop overnight
  if (v.dwell > 0) {
    v.dwell -= 1;
    if (v.dwell > 0) return;
  }
  const next = v.stopIdx + v.dir;
  const here = world.buildings[line.stops[v.stopIdx]];
  const to = world.buildings[line.stops[next]];
  if (!here || !to) return;
  // One bus pulls out of a stop a minute (at the terminus several would otherwise leave together).
  let out = departures.get(world);
  if (!out) departures.set(world, (out = new Map()));
  if (out.get(here.id) === world.minute) return;
  out.set(here.id, world.minute);
  const road = setOff(world, v.x, v.y, lanePolyline(ctx, here.roadNode, to.roadNode));
  v.path = [...road, ...parkPath(world, v, to, arrivalDir(road))];
  v.moving = true;
  v.destBuildingId = to.id;
}

/** A bus has drawn up at its next stop. */
export function busArrive(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const line = v.lineId ? BUS_LINE[v.lineId] : null;
  if (!line) return;
  v.stopIdx = Math.max(0, Math.min(line.stops.length - 1, v.stopIdx + v.dir));
  const end = v.stopIdx === 0 || v.stopIdx === line.stops.length - 1;
  if (end) v.dir = v.dir === 1 ? -1 : 1;
  v.dwell = end ? BUS_LAYOVER : BUS_DWELL;
  v.destBuildingId = null;
  const here = line.stops[v.stopIdx];
  alight(ctx, v, here);
  boardRiders(ctx, v, line.id, v.stopIdx, (id) => line.stops.indexOf(id ?? ''), BUS_SEATS);
  driverChange(ctx, v, line);
}

/** At the terminus a driver on shift takes the wheel; one whose shift is over (or when the service ends, wherever the bus is) gets off. */
function driverChange(ctx: Ctx, v: Vehicle, line: BusLine): void {
  const world = ctx.world;
  const atHub = line.stops[v.stopIdx] === BUS_HUB;
  const d = v.driverId ? world.people[v.driverId] : null;
  if (d) {
    const onShift = d.alive && !d.away && d.plan[d.planIdx]?.kind === 'work';
    if (!onShift && (atHub || !withinHours(world.minuteOfDay, BUS_HOURS))) {
      v.occupantIds = v.occupantIds.filter((id) => id !== d.id);
      v.driverId = null;
      d.inVehicleId = null;
      d.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
      walkOn(ctx, d);
    }
  }
  if (!v.driverId && atHub) {
    const cand = alivePeople(world).find((q) => q.job === 'busdriver' && !q.inVehicleId && !q.path.length && !q.waitingLine && q.loc.buildingId === BUS_HUB && q.plan[q.planIdx]?.kind === 'work');
    if (cand) {
      cand.inVehicleId = v.id;
      cand.path = [];
      cand.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
      v.occupantIds.push(cand.id);
      v.driverId = cand.id;
    }
  }
}

// ── Trains ──

function trainStep(ctx: Ctx, v: Vehicle, dt: number, minuteTick: boolean): void {
  const world = ctx.world;
  const mod = world.minuteOfDay;
  if (!v.moving) {
    if (!minuteTick) return;
    boardRiders(ctx, v, HYPERLINE, v.stopIdx, stationIndex, TRAIN_SEATS);
    if (!withinHours(mod, TRAIN_HOURS)) return;
    if (v.dwell > 0) {
      v.dwell -= 1;
      if (v.dwell > 0) return;
    }
    if (v.stopIdx + v.dir < 0 || v.stopIdx + v.dir >= STATIONS.length) v.dir = v.dir === 1 ? -1 : 1;
    v.moving = true;
    v.speed = 0;
    return;
  }
  const from = STATIONS[v.stopIdx];
  const to = STATIONS[v.stopIdx + v.dir];
  // Launched to cruise within a platform's length and caught the same way at
  // the far end: hypersonic in between, so the hop is over in a second or so
  // of simulated time. The renderer stretches it into a visible streak.
  const cruise = trainCruise(ctx.params.trainMach);
  const d = Math.abs(to.t - from.t);
  const u = Math.min(d, Math.abs(v.trackPos - from.t));
  const r = Math.max(0, d - u);
  const speed = Math.max(600, cruise * Math.min(1, Math.sqrt(Math.min(u + 1, r) / LAUNCH_RAMP)));
  const step = Math.min(speed * dt, r);
  v.trackPos += v.dir * step;
  v.speed = speed;
  v.odometerKm += step / 1000;
  const pt = trackPoint(v.trackPos);
  v.x = pt.x;
  v.y = pt.y;
  v.heading = v.dir > 0 ? pt.heading : pt.heading + Math.PI;
  carry(world, v);
  if (r - step <= 1e-6) {
    v.trackPos = to.t;
    v.moving = false;
    v.speed = 0;
    v.stopIdx += v.dir;
    v.idleSince = world.minute;
    const end = v.stopIdx === 0 || v.stopIdx === STATIONS.length - 1;
    if (end) v.dir = v.dir === 1 ? -1 : 1;
    v.dwell = end ? TRAIN_LAYOVER : TRAIN_DWELL;
    alight(ctx, v, to.id);
    boardRiders(ctx, v, HYPERLINE, v.stopIdx, stationIndex, TRAIN_SEATS);
  }
}

// ── Planes ──

function planeIndex(v: Vehicle): number {
  return Number(v.lineId?.split(':')[1] ?? 0) % 2;
}

/** The next of this plane's flights still to leave today (its first tomorrow when none is). */
function nextFlightFor(k: number, mod: number): number {
  for (let i = k; i < FLIGHTS.length; i += 2) if (FLIGHTS[i].dep + 5 > mod) return i;
  return k;
}

function planeStep(ctx: Ctx, v: Vehicle, dt: number, minuteTick: boolean): void {
  const world = ctx.world;
  const mod = world.minuteOfDay;
  const f = FLIGHTS[v.stopIdx] ?? FLIGHTS[0];
  if (v.airborne) {
    if (!minuteTick) return;
    if (mod >= f.arr - 3 && mod < f.arr + 40) {
      // On finals from the south: touch down, roll out, taxi to the stand.
      v.airborne = false;
      v.x = RUNWAY.x;
      v.y = RUNWAY.south;
      v.heading = -Math.PI / 2;
      v.path = [{ x: RUNWAY.x, y: RUNWAY.north + 560 }, { x: RUNWAY.x, y: RUNWAY.taxiwayY }, { x: RUNWAY.taxiwayX, y: RUNWAY.taxiwayY }, { x: RUNWAY.taxiwayX, y: v.homeY }, { x: v.homeX, y: v.homeY }];
      v.moving = true;
      v.stage = 'return';
    } else if (mod >= f.arr + 40 || mod < f.dep - 60) landPlane(ctx, v); // the clock jumped past the landing
    return;
  }
  if (v.moving) {
    const takeoffRoll = v.stage === 'ride' && v.path.length === 1;
    const landingRoll = v.stage === 'return' && v.path.length === 5;
    const speed = takeoffRoll ? TAKEOFF_SPEED : landingRoll ? LANDING_SPEED : GROUND_SPEED;
    const done = stepAlong(v, speed, dt);
    v.speed = speed;
    carry(world, v);
    if (done) {
      v.moving = false;
      if (v.stage === 'ride') {
        v.airborne = true; // gone until the timetable brings it back
        v.speed = 0;
      } else landPlane(ctx, v);
    }
    return;
  }
  if (!minuteTick) return;
  // On the stand. Boarding opens before the departure and, after a jump in
  // the clock, up to a few minutes past it, so a flight is never left behind.
  if (v.stage === null) {
    disembarkStale(ctx, v);
    v.stopIdx = nextFlightFor(planeIndex(v), mod);
    const nf = FLIGHTS[v.stopIdx];
    if (mod < nf.dep - BOARDING_MIN || mod >= nf.dep + 5) return;
    v.stage = 'pickup';
  }
  const flight = FLIGHTS[v.stopIdx];
  boardPlane(ctx, v, flight);
  if (mod >= flight.dep) {
    // Push back, taxi to the northern threshold, and roll south.
    v.path = [{ x: RUNWAY.taxiwayX, y: v.homeY }, { x: RUNWAY.taxiwayX, y: RUNWAY.taxiwayY }, { x: RUNWAY.x, y: RUNWAY.taxiwayY }, { x: RUNWAY.x, y: RUNWAY.north }, { x: RUNWAY.x, y: RUNWAY.south }];
    v.moving = true;
    v.stage = 'ride';
  }
}

/** Passengers booked on this flight walk out from the departures hall; two pilots on shift take it up. */
function boardPlane(ctx: Ctx, v: Vehicle, f: { dep: number; arr: number }): void {
  const world = ctx.world;
  let crew = v.occupantIds.filter((id) => world.people[id]?.job === 'pilot').length;
  for (const p of alivePeople(world)) {
    if (v.occupantIds.length >= PLANE_SEATS + 2) break;
    if (p.away || p.inVehicleId || p.path.length || p.loc.buildingId !== AIRPORT_TERMINAL) continue;
    const a = p.plan[p.planIdx];
    if (!a) continue;
    const pilot = p.job === 'pilot' && a.kind === 'work' && crew < 2;
    const booked = a.kind === 'flight' && a.flight?.dep === f.dep;
    if (!pilot && !booked) continue;
    if (pilot) crew++;
    p.inVehicleId = v.id;
    p.path = [];
    p.waitingLine = null;
    p.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
    v.occupantIds.push(p.id);
    if (pilot && !v.driverId) v.driverId = p.id;
  }
}

/** Someone gets off a plane on the stand and walks into the terminal: passengers to the arrivals hall, the crew back to the crew room. */
function disembark(ctx: Ctx, v: Vehicle, q: Person): void {
  const world = ctx.world;
  const terminal = world.buildings[AIRPORT_TERMINAL];
  const arrivals = terminal.rooms.find((r) => r.id.endsWith('-arrivals')) ?? roomByKind(terminal, 'hall');
  q.inVehicleId = null;
  q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
  if (!q.alive || q.away) return;
  if (q.job !== 'pilot' && arrivals) {
    const seat = arrivals.spots.length ? ctx.rng.stream('movement').pick(arrivals.spots) : null;
    q.target = { x: seat?.x ?? arrivals.x + arrivals.w / 2, y: seat?.y ?? arrivals.y + arrivals.h / 2, buildingId: terminal.id, roomId: arrivals.id, spotId: seat?.id ?? null };
  }
  if (q.target) q.path = entryPath(ctx, terminal, { x: q.target.x, y: q.target.y });
}

/** Whether a passenger's day away is over by this landing (or their plan has moved on). */
function dueBack(q: Person, arr: number): boolean {
  const a = q.plan[q.planIdx];
  return !a || a.kind !== 'flight' || !a.flight || a.flight.ret <= arr || !q.alive || !!q.away;
}

/**
 * Back on the stand: the crew get off, and so does everyone whose return this
 * is — whichever plane flew them out, since a day-tripper comes home on the
 * flight their plan says, not necessarily the aircraft they left on. Those
 * still away stay listed against the plane they flew out in.
 */
function landPlane(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const f = FLIGHTS[v.stopIdx] ?? FLIGHTS[0];
  v.moving = false;
  v.airborne = false;
  v.path = [];
  v.x = v.homeX;
  v.y = v.homeY;
  v.heading = Math.PI / 2;
  v.speed = 0;
  v.stage = null;
  v.destBuildingId = null;
  v.idleSince = world.minute;
  for (const vid in world.vehicles) {
    const plane = world.vehicles[vid];
    if (plane.kind !== 'plane') continue;
    const stay: string[] = [];
    for (const pid of plane.occupantIds) {
      const q = world.people[pid];
      if (!q) continue;
      const crewHere = q.job === 'pilot' && plane === v;
      if (crewHere || (q.job !== 'pilot' && dueBack(q, f.arr))) disembark(ctx, v, q);
      else stay.push(pid);
    }
    plane.occupantIds = stay;
    if (plane.driverId && !stay.includes(plane.driverId)) plane.driverId = null;
  }
}

/** Anyone left aboard a parked plane whose plan has moved on (a mode switch, a jump) gets off. */
function disembarkStale(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const stay: string[] = [];
  for (const pid of v.occupantIds) {
    const q = world.people[pid];
    if (!q) continue;
    const a = q.plan[q.planIdx];
    const stale = !q.alive || q.away || !a || (q.job === 'pilot' ? a.kind !== 'work' : a.kind !== 'flight');
    if (stale) disembark(ctx, v, q);
    else stay.push(pid);
  }
  v.occupantIds = stay;
  if (v.driverId && !stay.includes(v.driverId)) v.driverId = null;
}
