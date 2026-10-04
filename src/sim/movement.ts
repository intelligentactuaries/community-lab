// Movement: walking along the road network, driving a household car, being
// fetched by a taxi, an e-hailing car or an ambulance, wandering inside rooms —
// and the time-lapse "snap" placement. The timetabled vehicles (buses, the
// Hyperline, the planes) live in transit.ts and are stepped from here.

import { berthOf } from './beds';
import type { Ctx } from './ctx';
import { alivePeople, dist, householdMembers } from './ctx';
import { rideFare } from './finance/transport';
import { VEHICLE_SIZE, parkPath, yardWayIn, yardWayOut } from './parking';
import { SUPERVISOR_AGE, activityAt, coverChildrenNow } from './schedule';
import { BUS_SPEED, HYPERLINE, boardingStopFor, busArrive, planTransit, resetTransit, transitStep, waitSpotFor } from './transit';
import type { Activity, Building, Household, Person, Room, Spot, Vehicle, World } from './types';
import { cityOf, doorOf, pointInRect, roadPath, roomByKind, roomOf } from './world';

export const WALK_SPEED = 80; // metres per simulated minute (≈ 4.8 km/h)
export const CAR_SPEED = 500; // ≈ 30 km/h in the village
const DRIVE_MIN_DISTANCE = 140; // metres of road; below this people walk
/** Metres of road beyond which someone without a car hails a minibus taxi rather than walk (the next city is 2–5 km). */
export const TAXI_MIN_DISTANCE = 900;
const TAXI_SEATS = 14;
/** Riders an e-hailing car takes besides its driver. */
const RIDE_SEATS = 3;
/** Metres of road beyond which a household that uses the app orders a ride rather than walk. */
export const RIDE_MIN_DISTANCE = 900;

function seatsFor(v: Vehicle | undefined): number {
  return v?.kind === 'taxi' ? TAXI_SEATS : v?.kind === 'ride' ? RIDE_SEATS : 2;
}
/** Metres of road beyond which someone without a car looks for the Hyperline or a bus before a taxi. */
export const TRANSIT_MIN_DISTANCE = 700;
/** Minutes stood at a stop before giving up on the bus (or the train) and hailing a taxi instead. */
const MAX_WAIT_BUS = 22;
const MAX_WAIT_TRAIN = 14;
/** Minutes a patrol car or ambulance stands where it stopped before heading back to its station. */
const SERVICE_IDLE_MIN = 3;
/** Age below which a child travels with a grown-up of the household heading the same way rather than choosing for themselves. */
const ESCORT_AGE = 12;

function speedFor(ctx: Ctx, p: Person): number {
  if (p.age < ESCORT_AGE) {
    // A small child walking with a grown-up of the household keeps their pace (carried, or by the hand).
    const near = householdMembers(ctx.world, p.householdId).some((q) => q.id !== p.id && q.age >= 14 && q.path.length > 0 && !q.inVehicleId && q.target?.buildingId === p.target?.buildingId && dist(q.loc.x, q.loc.y, p.loc.x, p.loc.y) < 60);
    if (near) return WALK_SPEED;
  }
  if (p.age < 4) return 45;
  if (p.age < 10) return 65;
  if (p.age >= 75) return 50;
  if (p.age >= 65) return 62;
  if (p.health.state !== 'healthy') return 55;
  return WALK_SPEED;
}

/** Default room for an activity that did not name one. */
export function roomForActivity(b: Building, a: Activity): Room | null {
  if (a.roomId) {
    const r = roomOf(b, a.roomId);
    if (r) return r;
  }
  switch (a.kind) {
    case 'sleep':
      return roomByKind(b, 'bedroom');
    case 'breakfast':
    case 'lunch':
    case 'dinner':
      return roomByKind(b, 'kitchen') ?? b.rooms[0];
    case 'visit':
    case 'rest':
    case 'idle':
    case 'homeschool':
      return roomByKind(b, 'living') ?? roomByKind(b, 'hall') ?? b.rooms[0];
    case 'play':
    case 'chores':
      return roomByKind(b, 'yard') ?? b.rooms[0];
    case 'church':
    case 'funeral':
    case 'wedding':
      return roomByKind(b, 'nave') ?? roomByKind(b, 'graves') ?? b.rooms[0];
    case 'fellowship':
    case 'biblestudy':
    case 'youth':
    case 'celebration':
      return roomByKind(b, 'hall') ?? b.rooms[0];
    case 'shop':
      return roomByKind(b, 'shop') ?? b.rooms[0];
    case 'clinic':
      return roomByKind(b, 'reception') ?? b.rooms[0];
    case 'hospital':
      return roomByKind(b, 'ward') ?? b.rooms[0];
    case 'court':
      return roomByKind(b, 'courtroom') ?? b.rooms[0];
    case 'sport':
      return roomByKind(b, 'pitch') ?? roomByKind(b, 'yard') ?? b.rooms[0];
    case 'match':
      return roomByKind(b, 'stand') ?? b.rooms[0];
    case 'concert':
      return roomByKind(b, 'auditorium') ?? b.rooms[0];
    case 'flight':
      return roomByKind(b, 'hall') ?? b.rooms[0]; // the departures hall
    default:
      return b.rooms[0] ?? null;
  }
}

/** Spots already claimed in a building (by presence or by intent). */
function claimedSpots(ctx: Ctx, buildingId: string, exceptId: string): Set<string> {
  const s = new Set<string>();
  for (const p of alivePeople(ctx.world)) {
    if (p.id === exceptId) continue;
    if (p.loc.buildingId === buildingId && p.loc.spotId) s.add(p.loc.spotId);
    if (p.target?.buildingId === buildingId && p.target.spotId) s.add(p.target.spotId);
  }
  return s;
}

const SEATED_KINDS = new Set<Activity['kind']>(['church', 'funeral', 'wedding', 'school', 'work', 'court', 'sleep', 'hospital', 'clinic', 'breakfast', 'lunch', 'dinner', 'biblestudy', 'match', 'concert', 'flight']);

/** The spots a person may use for an activity in a room (the pulpit is the pastor's, beds are for sleeping, ...). */
export function spotPool(room: Room, p: Person, a: Activity): Spot[] {
  let pool = room.spots;
  if (a.kind === 'sleep') pool = room.spots.filter((s) => s.kind === 'bed' || s.kind === 'ward');
  else if ((a.kind === 'church' || a.kind === 'funeral' || a.kind === 'wedding') && a.role === 'lead') pool = room.spots.filter((s) => s.kind === 'pulpit');
  else if (a.kind === 'church' || a.kind === 'funeral' || a.kind === 'wedding') pool = room.spots.filter((s) => s.kind === 'pew' || s.kind === 'seat' || s.kind === 'bench-out' || s.kind === 'bench');
  else if (a.kind === 'match' || a.kind === 'concert') pool = room.spots.filter((s) => s.kind === 'seat');
  else if (a.kind === 'work') {
    const pref = p.job === 'doctor' ? 'desk' : p.job === 'magistrate' ? 'bench' : p.job === 'shopkeeper' ? 'counter' : p.job === 'vendor' ? 'stall' : p.job === 'teacher' ? 'desk' : null;
    if (pref) {
      const sub = room.spots.filter((s) => s.kind === pref);
      if (sub.length) pool = p.job === 'teacher' ? [sub[0]] : sub;
    }
  } else if (a.kind === 'school') pool = room.spots.filter((s) => s.kind === 'desk').slice(1);
  else if (a.kind === 'hospital') pool = room.spots.filter((s) => s.kind === 'ward');
  else if (a.kind === 'clinic') pool = room.spots.filter((s) => s.kind === 'seat');
  else if (a.kind === 'court') {
    const kind = p.job === 'magistrate' ? 'bench' : p.job === 'clerk' || p.job === 'police' ? 'desk' : 'seat';
    pool = room.spots.filter((s) => s.kind === kind);
  } else if (room.kind === 'nave') pool = room.spots.filter((s) => s.kind === 'pew');
  if (!pool.length) pool = room.spots.filter((s) => s.kind !== 'pulpit' && s.kind !== 'altar');
  if (!pool.length) pool = room.spots;
  return pool;
}

/** Asleep at home: their own bed (a husband and wife their shared one), and their side of it. */
function homeBed(world: World, b: Building, room: Room, p: Person, a: Activity): { spot: Spot; side: number } | null {
  if (a.kind !== 'sleep' || room.kind !== 'bedroom' || world.households[p.householdId]?.houseId !== b.id) return null;
  const berth = berthOf(world, p);
  const spot = berth?.roomId === room.id ? room.spots.find((s) => s.id === berth.spotId) : undefined;
  return spot ? { spot, side: berth!.side } : null;
}

export function pickSpot(ctx: Ctx, b: Building, room: Room, p: Person, a: Activity): Spot | null {
  const bed = homeBed(ctx.world, b, room, p, a);
  if (bed) return bed.spot;
  const claimed = claimedSpots(ctx, b.id, p.id);
  const pool = spotPool(room, p, a);
  if (!pool.length) return null;
  const rng = ctx.rng.stream('movement');
  const free = pool.filter((s) => !claimed.has(s.id));
  if (free.length) {
    // Families sit together: prefer a free spot adjacent to a household member already placed.
    if (a.kind === 'church' || a.kind === 'funeral' || a.kind === 'wedding') {
      const kin = alivePeople(ctx.world).filter((q) => q.householdId === p.householdId && q.id !== p.id && (q.loc.buildingId === b.id || q.target?.buildingId === b.id));
      if (kin.length) {
        const anchor = kin[0].target ?? kin[0].loc;
        free.sort((s1, s2) => dist(s1.x, s1.y, anchor.x, anchor.y) - dist(s2.x, s2.y, anchor.x, anchor.y));
        return free[Math.min(free.length - 1, rng.int(Math.min(3, free.length)))];
      }
    }
    return rng.pick(free);
  }
  return rng.pick(pool);
}

/** Straight-line polyline from a person's location out of its current building to the door. */
function exitPath(ctx: Ctx, p: Person): Array<{ x: number; y: number }> {
  if (!p.loc.buildingId) return [];
  const b = ctx.world.buildings[p.loc.buildingId];
  if (!b) return [];
  const door = doorOf(b);
  const out: Array<{ x: number; y: number }> = [{ x: door.x, y: door.y }];
  if (b.kind === 'house') out.push({ x: b.entrance.x, y: b.entrance.y });
  return out;
}

export function entryPath(ctx: Ctx, b: Building, to: { x: number; y: number }): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (b.kind === 'house') out.push({ x: b.entrance.x, y: b.entrance.y });
  const door = doorOf(b);
  out.push({ x: door.x, y: door.y });
  out.push(to);
  return out;
}

/** Road polyline between two road nodes (inclusive of both ends). */
export function roadPolyline(ctx: Ctx, fromNode: string, toNode: string): Array<{ x: number; y: number }> {
  const ids = roadPath(ctx.roads, fromNode, toNode) ?? [fromNode, toNode];
  return ids.map((id) => ({ x: ctx.roads.nodes[id].x, y: ctx.roads.nodes[id].y }));
}

/**
 * Pulling out onto a road from beside it (a bay on the verge, a bus stop): out into the lane a few metres ahead,
 * then on, leaving out the points already behind, so a vehicle neither backs up to the corner it has drawn up past
 * nor runs along the kerb through the car parked in front of it.
 */
export function joinRoad(x: number, y: number, road: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  let i = 0;
  let lead: { x: number; y: number } | null = null;
  while (i + 1 < road.length) {
    const a = road[i];
    const b = road[i + 1];
    const l = dist(a.x, a.y, b.x, b.y);
    if (l < 1e-6) {
      i++;
      continue;
    }
    const ux = (b.x - a.x) / l;
    const uy = (b.y - a.y) / l;
    const along = (x - a.x) * ux + (y - a.y) * uy;
    const side = Math.abs((x - a.x) * uy - (y - a.y) * ux);
    if (side > 12) break;
    if (along >= l) {
      i++;
      continue;
    }
    const q = along + 4;
    if (along > 0) {
      i++;
      if (side > 0.5 && q < l) lead = { x: a.x + ux * q, y: a.y + uy * q };
    } else if (side > 0.5 && q < 0) lead = { x: a.x + ux * q, y: a.y + uy * q };
    break;
  }
  const out = road.slice(i);
  return lead ? [lead, ...out] : out;
}

/** A vehicle setting off from (x, y): out of the yard it stands in, if it does, then onto the road. */
export function setOff(world: World, x: number, y: number, road: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const out = yardWayOut(world, x, y);
  const from = out.length ? out[out.length - 1] : { x, y };
  return [...out, ...joinRoad(from.x, from.y, road)];
}

/** Home to a place at its base: through the gate and round the parked cars when that is a house's yard. */
function homeWay(base: Building, v: Vehicle): Array<{ x: number; y: number }> {
  return base.kind === 'house' ? yardWayIn(base, { x: v.homeX, y: v.homeY }) : [{ x: v.homeX, y: v.homeY }];
}

const laneWidths = new WeakMap<object, Map<string, number>>();

/**
 * A vehicle's way along the roads: the centre-line route shifted into the left-hand lane (South Africa drives on
 * the left), a quarter of each road's width from its centre, so traffic in the two directions passes side by side.
 */
export function lanePolyline(ctx: Ctx, fromNode: string, toNode: string): Array<{ x: number; y: number }> {
  const ids = roadPath(ctx.roads, fromNode, toNode) ?? [fromNode, toNode];
  let widths = laneWidths.get(ctx.roads);
  if (!widths) {
    widths = new Map();
    for (const e of ctx.roads.edges) {
      widths.set(`${e.a}|${e.b}`, e.width);
      widths.set(`${e.b}|${e.a}`, e.width);
    }
    laneWidths.set(ctx.roads, widths);
  }
  const pts: Array<{ x: number; y: number }> = [];
  const segs: Array<{ nx: number; ny: number; o: number; dx: number; dy: number }> = [];
  for (let i = 1; i < ids.length; i++) {
    const a = ctx.roads.nodes[ids[i - 1]];
    const b = ctx.roads.nodes[ids[i]];
    const l = dist(a.x, a.y, b.x, b.y);
    if (l < 1e-6) continue;
    const dx = (b.x - a.x) / l;
    const dy = (b.y - a.y) / l;
    // The left of a heading (y runs south on the map): (dy, -dx).
    segs.push({ nx: dy, ny: -dx, o: (widths.get(`${ids[i - 1]}|${ids[i]}`) ?? 7) / 4, dx, dy });
  }
  const nodes = ids.map((id) => ctx.roads.nodes[id]).filter((n, i, arr) => i === 0 || dist(n.x, n.y, arr[i - 1].x, arr[i - 1].y) >= 1e-6);
  if (!segs.length) return nodes.map((n) => ({ x: n.x, y: n.y }));
  pts.push({ x: nodes[0].x + segs[0].nx * segs[0].o, y: nodes[0].y + segs[0].ny * segs[0].o });
  for (let i = 1; i < segs.length; i++) {
    const p = nodes[i];
    const s0 = segs[i - 1];
    const s1 = segs[i];
    const dot = s0.dx * s1.dx + s0.dy * s1.dy;
    if (dot > 0.99) pts.push({ x: p.x + s1.nx * s1.o, y: p.y + s1.ny * s1.o });
    else if (dot < -0.99) {
      pts.push({ x: p.x + s0.nx * s0.o, y: p.y + s0.ny * s0.o });
      pts.push({ x: p.x + s1.nx * s1.o, y: p.y + s1.ny * s1.o });
    } else pts.push({ x: p.x + s0.nx * s0.o + s1.nx * s1.o, y: p.y + s0.ny * s0.o + s1.ny * s1.o });
  }
  const last = segs[segs.length - 1];
  const end = nodes[nodes.length - 1];
  pts.push({ x: end.x + last.nx * last.o, y: end.y + last.ny * last.o });
  return pts;
}

/** The way it was heading along the last stretch of a route (to park facing the way it came). */
export function arrivalDir(pts: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  for (let i = pts.length - 1; i > 0; i--) {
    const l = dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (l > 0.5) return { x: (pts[i].x - pts[i - 1].x) / l, y: (pts[i].y - pts[i - 1].y) / l };
  }
  return null;
}

/** A vehicle's drive on to a building's bay: the lanes there, then into the bay facing the way it came. */
function driveOn(ctx: Ctx, v: Vehicle, fromNode: string, b: Building): Array<{ x: number; y: number }> {
  const road = setOff(ctx.world, v.x, v.y, lanePolyline(ctx, fromNode, b.roadNode));
  return [...road, ...parkPath(ctx.world, v, b, arrivalDir(road))];
}

function polyLength(pts: Array<{ x: number; y: number }>): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return l;
}

/** Any of the household's cars standing free at this door. */
function carAtHand(ctx: Ctx, hh: Household | undefined, fromB: Building): Vehicle | null {
  if (!hh) return null;
  const door = doorOf(fromB);
  for (const id of [hh.vehicleId, ...hh.extraVehicleIds]) {
    const car = id ? ctx.world.vehicles[id] : null;
    if (car && !car.moving && car.occupantIds.length === 0 && dist(car.x, car.y, door.x, door.y) < 60) return car;
  }
  return null;
}

/** A member of the child's household, of supervising age, setting out from the same building for the same place (a parent first). */
function escortFor(ctx: Ctx, p: Person, fromB: Building, toB: Building): Person | null {
  const near = householdMembers(ctx.world, p.householdId).filter((q) => q.id !== p.id && q.age >= 14 && !q.away && q.target?.buildingId === toB.id && (q.loc.buildingId === fromB.id || !!q.inVehicleId || !!q.waitingFor || !!q.waitingLine || dist(q.loc.x, q.loc.y, fromB.entrance.x, fromB.entrance.y) < 90));
  near.sort((a, b) => Number(p.parentIds.includes(b.id)) - Number(p.parentIds.includes(a.id)) || b.age - a.age);
  return near[0] ?? null;
}

/** A child climbs in with the grown-up: the car still at the door, the taxi they are waiting for, the stop they are walking to. False when the grown-up is simply walking (or already gone), and the child walks too. */
function joinLead(ctx: Ctx, p: Person, lead: Person, fromB: Building): boolean {
  const world = ctx.world;
  if (lead.inVehicleId) {
    const v = world.vehicles[lead.inVehicleId];
    if (v && (v.kind === 'car' || v.kind === 'bakkie') && v.occupantIds.length < 5 && dist(v.x, v.y, doorOf(fromB).x, doorOf(fromB).y) < 60) {
      v.occupantIds.push(p.id);
      p.inVehicleId = v.id;
      p.path = [];
      p.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
      return true;
    }
    return false;
  }
  if (lead.waitingFor) {
    const v = world.vehicles[lead.waitingFor];
    const seats = seatsFor(v);
    if (v && v.stage === 'pickup' && v.boardIds.length < seats) {
      p.path = exitPath(ctx, p);
      p.waitingFor = v.id;
      v.boardIds.push(p.id);
      return true;
    }
    return false;
  }
  if (lead.waitingLine && lead.alightAt) {
    const stop = boardingStopFor(world, lead.waitingLine, fromB);
    if (stop) {
      p.path = [...exitPath(ctx, p), ...roadPolyline(ctx, fromB.roadNode, stop.roadNode), ...entryPath(ctx, stop, waitSpotFor(ctx, stop))];
      p.waitingLine = lead.waitingLine;
      p.alightAt = lead.alightAt;
      return true;
    }
  }
  return false;
}

/** Choose the target and compute the path for an activity; may put the person in a car, a taxi, a bus, the train or an ambulance. */
export function beginActivity(ctx: Ctx, p: Person, a: Activity): void {
  const world = ctx.world;
  const b = world.buildings[a.buildingId];
  if (!b) return;
  if (p.conversationId) {
    const c = world.conversations[p.conversationId];
    if (c) c.endMinute = Math.min(c.endMinute, world.minute);
    p.conversationId = null;
  }
  const room = roomForActivity(b, a);
  const spotObj = room ? pickSpot(ctx, b, room, p, a) : null;
  const rng = ctx.rng.stream('movement');
  const side = room && spotObj?.kind === 'bed' ? homeBed(world, b, room, p, a)?.side ?? 0 : 0;
  const to = spotObj
    ? { x: spotObj.x + side, y: spotObj.y }
    : room
      ? { x: room.x + 2 + rng.next() * Math.max(1, room.w - 4), y: room.y + 2 + rng.next() * Math.max(1, room.h - 4) }
      : { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  p.target = { x: to.x, y: to.y, buildingId: b.id, roomId: room?.id ?? null, spotId: spotObj?.id ?? null };
  p.wanderTimer = 0;
  p.waitingFor = null;
  p.waitingLine = null;
  p.alightAt = null;
  p.waitedMin = 0;
  // A driver-partner's shift: into the rented car at the gate and online for fares.
  if (p.job === 'ehailer' && a.kind === 'work' && goOnline(ctx, p)) return;
  if (p.loc.buildingId === b.id) {
    p.path = [to];
    return;
  }
  const fromB = p.loc.buildingId ? world.buildings[p.loc.buildingId] : null;
  const startNode = fromB ? fromB.roadNode : nearestNode(ctx, p.loc.x, p.loc.y);
  const road = roadPolyline(ctx, startNode, b.roadNode);
  const roadLen = polyLength(road);
  // Fetched by ambulance: an admission, a serious injury (nobody drives themselves in that state).
  if (a.ambulance && fromB && roadLen >= DRIVE_MIN_DISTANCE) {
    const amb = callAmbulance(ctx, fromB);
    if (amb) {
      p.path = exitPath(ctx, p);
      p.waitingFor = amb.id;
      amb.boardIds.push(p.id);
      return;
    }
  }
  // A small child goes with the grown-up of the household who is heading the same way.
  const lead = fromB && p.age < ESCORT_AGE ? escortFor(ctx, p, fromB, b) : null;
  if (lead && joinLead(ctx, p, lead, fromB!)) return;
  // Drive? Any of the household's cars standing free at this door.
  const hh = world.households[p.householdId];
  if (fromB && p.driver && roadLen >= DRIVE_MIN_DISTANCE && a.kind !== 'sleep') {
    const car = carAtHand(ctx, hh, fromB);
    if (car) {
      startDrive(ctx, car, p, fromB, b, to);
      return;
    }
  }
  // A household that uses the app orders a ride (a night out, the airport, or simply its way of getting about)…
  if (!lead && fromB && roadLen >= RIDE_MIN_DISTANCE && p.age >= 18 && a.kind !== 'sleep' && wantsRide(ctx, p, hh, a)) {
    const car = requestRide(ctx, fromB, roadLen);
    if (car) {
      p.path = exitPath(ctx, p);
      p.waitingFor = car.id;
      car.boardIds.push(p.id);
      return;
    }
  }
  // A long way and no car: the Hyperline or a bus where they serve both ends…
  // (a child walking with a grown-up who is walking keeps step with them instead)
  if (!lead && fromB && roadLen >= TRANSIT_MIN_DISTANCE && p.age >= 6 && a.kind !== 'sleep') {
    const ride = planTransit(ctx, p, fromB, b);
    if (ride) {
      p.path = [...exitPath(ctx, p), ...roadPolyline(ctx, startNode, ride.stop.roadNode), ...entryPath(ctx, ride.stop, ride.wait)];
      p.waitingLine = ride.lineId;
      p.alightAt = ride.alightAt;
      return;
    }
  }
  // …else hail a minibus taxi and wait at the gate for it.
  if (!lead && fromB && roadLen >= TAXI_MIN_DISTANCE && p.age >= 12 && a.kind !== 'sleep') {
    const taxi = hailTaxi(ctx, fromB);
    if (taxi) {
      p.path = exitPath(ctx, p);
      p.waitingFor = taxi.id;
      taxi.boardIds.push(p.id);
      return;
    }
  }
  p.path = [...exitPath(ctx, p), ...road, ...entryPath(ctx, b, to)];
}

/** Whether a taxi, an e-hailing car or an ambulance is already on its way to a building; a second fare from the same door joins it. */
function boundFor(ctx: Ctx, kind: 'taxi' | 'ambulance' | 'ride', b: Building): Vehicle | null {
  for (const vid in ctx.world.vehicles) {
    const v = ctx.world.vehicles[vid];
    if (v.kind === kind && v.stage === 'pickup' && v.destBuildingId === b.id && v.boardIds.length < seatsFor(v)) return v;
  }
  return null;
}

// ─── E-hailing ──────────────────────────────────────────────────────────────

/** Whether this trip is ordered on the app: the household's e-hailing share of its trips, higher for the airport and a night out. */
function wantsRide(ctx: Ctx, p: Person, hh: Household | undefined, a: Activity): boolean {
  const T = ctx.world.finance?.transport;
  if (!T || !hh) return false;
  let share = T.hhRide[hh.id] ?? 0;
  if (a.kind === 'flight') share = Math.max(share, 0.35);
  else if (a.kind === 'concert' || a.kind === 'match') share = Math.max(share, 0.15);
  void p;
  return share > 0 && ctx.rng.stream('movement').bernoulli(Math.min(0.9, share));
}

/**
 * The nearest online, idle e-hailing car sets off to the rider's gate. The fare
 * is quoted up front from the month's rate card: the month's surge, pushed up
 * when most of the cars are already on a trip. Null when no car is free.
 */
function requestRide(ctx: Ctx, fromB: Building, roadLen: number): Vehicle | null {
  const world = ctx.world;
  const bound = boundFor(ctx, 'ride', fromB);
  if (bound) return bound;
  let best: Vehicle | null = null;
  let bd = Infinity;
  let online = 0;
  let idle = 0;
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind !== 'ride' || !v.online || !v.driverId) continue;
    online++;
    if (v.moving || v.stage !== null) continue;
    idle++;
    const d = dist(v.x, v.y, fromB.entrance.x, fromB.entrance.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  const T = world.finance?.transport;
  if (!best || !T) return null;
  const busy = online > 0 ? 1 - (idle - 1) / online : 0;
  const s = Math.round(Math.max(1, T.last.surge * (1 + 0.6 * Math.max(0, busy - 0.5))) * 10) / 10;
  best.surge = s;
  best.fare = Math.round(rideFare(T.fares.ride, roadLen / 1000, s));
  world.stats.rideTrips++;
  world.stats.rideFares += best.fare;
  // Off to the pickup with the driver aboard.
  best.path = driveOn(ctx, best, nearestNode(ctx, best.x, best.y), fromB);
  best.moving = true;
  best.stage = 'pickup';
  best.destBuildingId = fromB.id;
  best.boardIds = [];
  return best;
}

/** The start of a shift: the driver-partner climbs into the rented car at their gate and goes online. */
function goOnline(ctx: Ctx, p: Person): boolean {
  const world = ctx.world;
  let v: Vehicle | null = null;
  for (const vid in world.vehicles) {
    const x = world.vehicles[vid];
    if (x.kind === 'ride' && x.rideDriverId === p.id) v = x;
  }
  const house = world.buildings[world.households[p.householdId]?.houseId ?? ''];
  if (!v || v.online || v.moving || !house || p.loc.buildingId !== house.id) return false;
  v.online = true;
  v.driverId = p.id;
  v.occupantIds = [p.id];
  v.stage = null;
  v.boardIds = [];
  v.idleSince = world.minute;
  p.inVehicleId = v.id;
  p.path = [];
  p.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
  return true;
}

/** An e-hailing car has arrived: riders get out at their destination and it waits there for the next fare; home at the end of the shift, the driver gets out and the car goes offline. */
function rideArrive(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  if (v.stage === 'return') {
    const d = v.driverId ? world.people[v.driverId] : null;
    for (const pid of v.occupantIds) {
      const q = world.people[pid];
      if (!q) continue;
      q.inVehicleId = null;
      q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
      if (q.alive && !q.away) walkOn(ctx, q);
    }
    void d;
    v.occupantIds = [];
    v.driverId = null;
    v.online = false;
    v.stage = null;
    v.destBuildingId = null;
    v.fare = undefined;
    v.surge = undefined;
    return;
  }
  const dest = v.destBuildingId ? world.buildings[v.destBuildingId] : null;
  const stay: string[] = [];
  for (const pid of v.occupantIds) {
    const q = world.people[pid];
    if (!q) continue;
    if (pid === v.driverId) {
      stay.push(pid);
      continue;
    }
    q.inVehicleId = null;
    q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
    if (q.target && dest && q.target.buildingId === dest.id) q.path = entryPath(ctx, dest, { x: q.target.x, y: q.target.y });
    else walkOn(ctx, q);
  }
  v.occupantIds = stay;
  v.stage = null;
  v.destBuildingId = null;
  v.idleSince = world.minute;
}

/** Each minute: a driver whose shift is over (or who is needed elsewhere) drives home once the car is free. */
function rideSweep(ctx: Ctx): void {
  const world = ctx.world;
  const mod = world.minuteOfDay;
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind !== 'ride' || !v.online || v.moving || v.stage !== null) continue;
    const d = v.driverId ? world.people[v.driverId] : null;
    const onShift = !!d && d.alive && !d.away && activityAt(d.plan, mod)?.kind === 'work';
    if (onShift) continue;
    const home = v.baseId ? world.buildings[v.baseId] : null;
    if (!home) {
      v.online = false;
      continue;
    }
    v.path = [...setOff(world, v.x, v.y, lanePolyline(ctx, nearestNode(ctx, v.x, v.y), home.roadNode)), ...homeWay(home, v)];
    v.parkHeading = v.homeHeading ?? 0;
    v.moving = true;
    v.stage = 'return';
    v.destBuildingId = home.id;
  }
}

/** Send a vehicle from where it stands to collect at a building's gate. */
function sendToCollect(ctx: Ctx, v: Vehicle, fromB: Building): Vehicle {
  const startNode = nearestNode(ctx, v.x, v.y);
  v.path = driveOn(ctx, v, startNode, fromB);
  v.moving = true;
  v.stage = 'pickup';
  v.destBuildingId = fromB.id;
  v.boardIds = [];
  v.occupantIds = [];
  v.driverId = null;
  return v;
}

/** The nearest ambulance standing at any station in the province sets off; null when every one is out. */
function callAmbulance(ctx: Ctx, fromB: Building): Vehicle | null {
  const bound = boundFor(ctx, 'ambulance', fromB);
  if (bound) return bound;
  let best: Vehicle | null = null;
  let bd = Infinity;
  for (const vid in ctx.world.vehicles) {
    const v = ctx.world.vehicles[vid];
    if (v.kind !== 'ambulance' || v.moving || v.stage !== null) continue;
    const d = dist(v.x, v.y, fromB.entrance.x, fromB.entrance.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  if (!best) return null;
  ctx.world.stats.ambulanceRuns++;
  return sendToCollect(ctx, best, fromB);
}

/** The nearest free ambulance goes to a spot (an accident on the road); it drives home again when it has stood there a while. */
export function ambulanceTo(ctx: Ctx, near: Building, point: { x: number; y: number }): boolean {
  let best: Vehicle | null = null;
  let bd = Infinity;
  for (const vid in ctx.world.vehicles) {
    const v = ctx.world.vehicles[vid];
    if (v.kind !== 'ambulance' || v.moving || v.stage !== null) continue;
    const d = dist(v.x, v.y, point.x, point.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  if (!best) return false;
  ctx.world.stats.ambulanceRuns++;
  return dispatchVehicle(ctx, best, [], near, point);
}

/**
 * The nearest idle minibus at a rank in the building's own city, or at the
 * terminus in the centre; it sets off to collect. Returns null when every
 * taxi is out, in which case the fare walks.
 */
function hailTaxi(ctx: Ctx, fromB: Building): Vehicle | null {
  const world = ctx.world;
  const bound = boundFor(ctx, 'taxi', fromB);
  if (bound) return bound;
  const city = cityOf(fromB.community);
  let best: Vehicle | null = null;
  let bd = Infinity;
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind !== 'taxi' || v.moving || v.stage !== null || !v.baseId) continue;
    const rank = world.buildings[v.baseId];
    if (!rank) continue;
    if (cityOf(rank.community) !== city && rank.community !== 'cbd') continue;
    const d = dist(v.x, v.y, fromB.entrance.x, fromB.entrance.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  if (!best) return null;
  return sendToCollect(ctx, best, fromB);
}

/** A taxi or ambulance has drawn up: everyone waiting for it climbs in and it heads for the first fare's destination; nobody there, and it goes home. */
function vehiclePickup(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const here = v.destBuildingId ? world.buildings[v.destBuildingId] : null;
  const seats = seatsFor(v);
  const riders = v.boardIds.map((id) => world.people[id]).filter((q) => q && q.alive && q.waitingFor === v.id && q.target && dist(q.loc.x, q.loc.y, v.x, v.y) < 80).slice(0, seats);
  v.boardIds = [];
  const dest = riders[0]?.target?.buildingId ? world.buildings[riders[0].target!.buildingId!] : null;
  if (!here || !dest || !riders.length) {
    // A no-show: an e-hailing car simply waits where it is for the next request.
    if (v.kind === 'ride') {
      v.stage = null;
      v.destBuildingId = null;
      v.idleSince = world.minute;
      return;
    }
    returnToBase(ctx, v);
    return;
  }
  for (const q of riders) {
    q.waitingFor = null;
    q.inVehicleId = v.id;
    q.path = [];
    q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
    v.occupantIds.push(q.id);
  }
  if (v.kind === 'taxi') world.stats.taxiRides += riders.length;
  v.path = driveOn(ctx, v, here.roadNode, dest);
  v.moving = true;
  v.stage = 'ride';
  v.destBuildingId = dest.id;
}

/** Back to the rank or station, empty. */
export function returnToBase(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const base = v.baseId ? world.buildings[v.baseId] : null;
  v.occupantIds = [];
  v.boardIds = [];
  v.driverId = null;
  if (!base) {
    v.stage = null;
    v.moving = false;
    return;
  }
  const startNode = nearestNode(ctx, v.x, v.y);
  v.path = [...setOff(world, v.x, v.y, lanePolyline(ctx, startNode, base.roadNode)), ...homeWay(base, v)];
  v.parkHeading = v.homeHeading ?? 0;
  v.moving = true;
  v.stage = 'return';
  v.destBuildingId = base.id;
}

/** Patrol cars and ambulances that have stood a while away from their station drive home. */
function serviceSweep(ctx: Ctx): void {
  const world = ctx.world;
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if ((v.kind !== 'police' && v.kind !== 'ambulance') || v.moving || v.stage !== null || !v.baseId) continue;
    if (dist(v.x, v.y, v.homeX, v.homeY) < 15 || world.minute - v.idleSince < SERVICE_IDLE_MIN) continue;
    returnToBase(ctx, v);
  }
}

export function nearestNode(ctx: Ctx, x: number, y: number): string {
  let best = '';
  let bd = Infinity;
  for (const id in ctx.roads.nodes) {
    const n = ctx.roads.nodes[id];
    const d = dist(x, y, n.x, n.y);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

export function startDrive(ctx: Ctx, car: Vehicle, driver: Person, fromB: Building, toB: Building, finalPoint: { x: number; y: number }): void {
  const world = ctx.world;
  // Home: into its own place in the yard; anywhere else, the free bay nearest the door.
  const own = car.householdId !== null && world.households[car.householdId]?.houseId === toB.id;
  const road = setOff(world, car.x, car.y, lanePolyline(ctx, fromB.roadNode, toB.roadNode));
  let park: Array<{ x: number; y: number }>;
  if (own) {
    car.parkHeading = car.homeHeading ?? 0;
    park = homeWay(toB, car);
  } else park = parkPath(world, car, toB, arrivalDir(road));
  car.path = [...road, ...park];
  car.moving = true;
  car.driverId = driver.id;
  car.destBuildingId = toB.id;
  car.occupantIds = [driver.id];
  driver.inVehicleId = car.id;
  driver.path = [];
  // Walk to the car first? Keep it simple: the driver is at the door; the car leaves from the yard.
  driver.loc = { x: car.x, y: car.y, buildingId: null, roomId: null, spotId: null };
  // Passengers: household members at home heading to the same building.
  for (const pid of world.households[driver.householdId]?.memberIds ?? []) {
    const q = world.people[pid];
    if (!q || q === driver || !q.alive || q.emigrated || q.inVehicleId) continue;
    if (q.loc.buildingId === fromB.id && q.target?.buildingId === toB.id && car.occupantIds.length < 5) {
      car.occupantIds.push(q.id);
      q.inVehicleId = car.id;
      q.path = [];
      q.loc = { x: car.x, y: car.y, buildingId: null, roomId: null, spotId: null };
      // whatever else they were waiting for, they are in the car now
      if (q.waitingFor) {
        const t = world.vehicles[q.waitingFor];
        if (t) t.boardIds = t.boardIds.filter((id) => id !== q.id);
      }
      q.waitingFor = null;
      q.waitingLine = null;
      q.alightAt = null;
    }
  }
}

/** Dispatch a service vehicle (police / ambulance) with crew to a building; returns false if unavailable. */
export function dispatchVehicle(ctx: Ctx, car: Vehicle, crew: Person[], toB: Building, toPoint?: { x: number; y: number }): boolean {
  if (car.moving) return false;
  const startNode = nearestNode(ctx, car.x, car.y);
  if (toPoint) {
    car.parkHeading = null;
    car.path = [...setOff(ctx.world, car.x, car.y, lanePolyline(ctx, startNode, toB.roadNode)), toPoint];
  } else car.path = driveOn(ctx, car, startNode, toB);
  car.moving = true;
  car.destBuildingId = toB.id;
  car.occupantIds = crew.map((c) => c.id);
  car.driverId = crew[0]?.id ?? null;
  for (const c of crew) {
    c.inVehicleId = car.id;
    c.path = [];
    c.loc = { x: car.x, y: car.y, buildingId: null, roomId: null, spotId: null };
  }
  return true;
}

/**
 * How far a vehicle may go this step without running into one ahead of it in its lane: vehicles on the move, and a
 * bus standing at its stop. Parked cars stand on the verge, out of the lanes.
 */
function roomAhead(world: { vehicles: Record<string, Vehicle> }, v: Vehicle, budget: number): number {
  if (!v.path.length) return budget;
  const t = v.path[0];
  const d0 = dist(v.x, v.y, t.x, t.y);
  if (d0 < 1e-6) return budget;
  return Math.max(0, roomAlong(world, v, v.x, v.y, (t.x - v.x) / d0, (t.y - v.y) / d0, budget));
}

/**
 * How far a vehicle standing at (px, py) and facing (dx, dy) may go before it comes within two metres of what is
 * ahead of it in the lane (negative when it is closer than that already), up to `budget`.
 */
function roomAlong(world: { vehicles: Record<string, Vehicle> }, v: Vehicle, px: number, py: number, dx: number, dy: number, budget: number): number {
  const [lv] = VEHICLE_SIZE[v.kind];
  let room = budget;
  for (const id in world.vehicles) {
    const u = world.vehicles[id];
    if (u === v || u.kind === 'train' || u.kind === 'plane' || u.airborne) continue;
    // Only what is in the way: moving, or a bus standing at a stop (a few minutes at most).
    const halted = !u.moving && u.kind === 'bus' && u.dwell > 0;
    if (!u.moving && !halted) continue;
    const ox = u.x - px;
    const oy = u.y - py;
    const along = ox * dx + oy * dy;
    if (along > budget + 20) continue;
    const across = Math.abs(ox * dy - oy * dx);
    if (across > 1.5) continue;
    // Going the same way (or standing): not oncoming traffic, which is in the other lane anyway.
    if (u.moving && Math.cos(u.heading) * dx + Math.sin(u.heading) * dy < 0.3) continue;
    const [lu] = VEHICLE_SIZE[u.kind];
    // Only what is ahead holds a vehicle back (so the one in front never waits for those behind, and a queue
    // cannot lock); side by side, the earlier vehicle goes first.
    if (along < -0.25 || (along <= 0.25 && vehicleNo(u.id) > vehicleNo(v.id))) continue;
    room = Math.min(room, along - (lv + lu) / 2 - 2);
  }
  return room;
}

function vehicleNo(id: string): number {
  return Number(id.replace(/\D/g, '')) || 0;
}

export function stepAlong(obj: { x: number; y: number; heading: number; path: Array<{ x: number; y: number }> }, speed: number, dtMin: number): boolean {
  let budget = speed * dtMin;
  while (budget > 0 && obj.path.length) {
    const t = obj.path[0];
    const d = dist(obj.x, obj.y, t.x, t.y);
    if (d <= budget) {
      obj.x = t.x;
      obj.y = t.y;
      budget -= d;
      obj.path.shift();
    } else {
      obj.heading = Math.atan2(t.y - obj.y, t.x - obj.x);
      obj.x += ((t.x - obj.x) / d) * budget;
      obj.y += ((t.y - obj.y) / d) * budget;
      budget = 0;
    }
  }
  return obj.path.length === 0;
}

function arrive(ctx: Ctx, p: Person): void {
  if (!p.target) return;
  p.loc = { x: p.target.x, y: p.target.y, buildingId: p.target.buildingId, roomId: p.target.roomId, spotId: p.target.spotId };
  p.wanderTimer = 1 + ctx.rng.stream('movement').int(4);
}

/** From wherever someone stands, the road path on to the building they were heading for. */
export function walkOn(ctx: Ctx, p: Person): void {
  const tb = p.target?.buildingId ? ctx.world.buildings[p.target.buildingId] : null;
  if (tb && p.target) p.path = [...roadPolyline(ctx, nearestNode(ctx, p.loc.x, p.loc.y), tb.roadNode), ...entryPath(ctx, tb, { x: p.target.x, y: p.target.y })];
  else if (p.target) p.path = [{ x: p.target.x, y: p.target.y }];
}

/** The bus stop, station or terminus a point falls in, if any. */
function stopAt(ctx: Ctx, x: number, y: number): Building | null {
  const world = ctx.world;
  for (const id in world.buildings) {
    const b = world.buildings[id];
    if ((b.kind === 'busstop' || b.kind === 'station' || b.kind === 'terminus') && pointInRect(x, y, b.x - 2, b.y - 2, b.w + 4, b.h + 4)) return b;
  }
  return null;
}

/** Stood too long at the stop: a taxi from here if one will come, else walk. */
function giveUpTransit(ctx: Ctx, p: Person): void {
  p.waitingLine = null;
  p.alightAt = null;
  p.waitedMin = 0;
  const stop = stopAt(ctx, p.loc.x, p.loc.y);
  const taxi = stop && p.age >= 12 ? hailTaxi(ctx, stop) : null;
  if (taxi) {
    p.waitingFor = taxi.id;
    taxi.boardIds.push(p.id);
    return;
  }
  walkOn(ctx, p);
}

/** Riders leave a vehicle that has stopped and walk on to wherever they were going. */
function unloadAll(ctx: Ctx, v: Vehicle): void {
  const world = ctx.world;
  const dest = v.destBuildingId ? world.buildings[v.destBuildingId] : null;
  for (const pid of v.occupantIds) {
    const q = world.people[pid];
    if (!q) continue;
    q.inVehicleId = null;
    q.loc = { x: v.x, y: v.y, buildingId: null, roomId: null, spotId: null };
    // A rider bound elsewhere than the vehicle's first fare walks on from here.
    if (q.target && dest && q.target.buildingId === dest.id) q.path = entryPath(ctx, dest, { x: q.target.x, y: q.target.y });
    else walkOn(ctx, q);
  }
  v.occupantIds = [];
  v.driverId = null;
}

const WANDER_KINDS = new Set<Activity['kind']>(['play', 'fellowship', 'sport', 'chores', 'rest', 'idle', 'shop', 'celebration', 'youth', 'visit', 'work']);

/** One micro step of dt simulated minutes. `minuteTick` marks whether an integer minute boundary was crossed. */
export function microStep(ctx: Ctx, dtMin: number, minuteTick: boolean): void {
  const world = ctx.world;
  const mod = world.minuteOfDay;
  const rng = ctx.rng.stream('movement');
  // Vehicles first so passengers ride along. The trains and planes keep to
  // their own ways and are stepped by transit; buses share the roads.
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (v.kind === 'train' || v.kind === 'plane') continue;
    if (!v.moving) continue;
    const before = { x: v.x, y: v.y };
    const speed = v.kind === 'bus' ? BUS_SPEED : CAR_SPEED;
    // Keep a car's length behind whatever is ahead in the lane, looking again at every corner: in one long step a
    // car turns into a street where another has stopped.
    let budget = speed * dtMin;
    const [lv] = VEHICLE_SIZE[v.kind];
    while (budget > 1e-6 && v.path.length) {
      const t = v.path[0];
      const toCorner = dist(v.x, v.y, t.x, t.y);
      if (toCorner < 1e-6) {
        v.path.shift();
        continue;
      }
      const leg = Math.min(budget, toCorner);
      let room = roomAhead(world, v, leg);
      // Nearing a turn: whatever stands just round the corner holds it back before it turns in.
      const n = v.path[1];
      const l2 = n ? dist(t.x, t.y, n.x, n.y) : 0;
      if (n && l2 > 1e-6 && room > toCorner - lv / 2 - 1) {
        const ux = (n.x - t.x) / l2;
        const uy = (n.y - t.y) / l2;
        if (((t.x - v.x) * ux + (t.y - v.y) * uy) / toCorner < 0.94 && roomAlong(world, v, t.x, t.y, ux, uy, lv) < 0) room = Math.min(room, Math.max(0, toCorner - lv / 2 - 1));
      }
      if (room <= 0.01) break;
      stepAlong(v, speed, room / speed);
      budget -= room;
      if (room < leg - 1e-6) break;
    }
    const done = !v.path.length;
    v.odometerKm += dist(before.x, before.y, v.x, v.y) / 1000;
    for (const pid of v.occupantIds) {
      const q = world.people[pid];
      if (q) {
        q.loc.x = v.x;
        q.loc.y = v.y;
        q.heading = v.heading;
      }
    }
    if (done) {
      v.moving = false;
      v.idleSince = world.minute;
      // Drawn up in its bay, square to the road (or back home as it stood).
      if (v.parkHeading !== undefined && v.parkHeading !== null) v.heading = v.parkHeading;
      v.parkHeading = null;
      if (v.kind === 'bus') {
        busArrive(ctx, v);
        continue;
      }
      if (v.stage === 'pickup') {
        vehiclePickup(ctx, v);
        continue;
      }
      if (v.kind === 'ride') {
        rideArrive(ctx, v);
        continue;
      }
      unloadAll(ctx, v);
      if (v.stage === 'ride') returnToBase(ctx, v);
      else {
        v.stage = null;
        v.destBuildingId = null;
      }
    }
  }
  transitStep(ctx, dtMin, minuteTick);
  if (minuteTick) {
    serviceSweep(ctx);
    rideSweep(ctx);
  }
  // Activity transitions on the minute — the grown-ups first, so a child
  // leaving with them finds their car, taxi or platform already chosen.
  const byAge = alivePeople(world).filter((p) => !p.away && !p.inVehicleId && (minuteTick || p.planIdx < 0)).sort((a, b) => b.age - a.age);
  for (const p of byAge) {
    const a = activityAt(p.plan, mod);
    const idx = a ? p.plan.indexOf(a) : -1;
    if (idx !== p.planIdx && a) {
      p.planIdx = idx;
      beginActivity(ctx, p, a);
    }
  }
  for (const p of alivePeople(world)) {
    if (p.away) continue;
    if (p.inVehicleId) continue;
    // Standing at the gate for a taxi or ambulance that is no longer coming: walk.
    if (p.waitingFor && minuteTick) {
      const v = world.vehicles[p.waitingFor];
      if (!v || v.stage !== 'pickup' || !v.boardIds.includes(p.id)) {
        p.waitingFor = null;
        walkOn(ctx, p);
      }
    }
    // At the stop with nothing coming: give it up.
    if (p.waitingLine && minuteTick && p.path.length === 0) {
      p.waitedMin++;
      if (p.waitedMin > (p.waitingLine === HYPERLINE ? MAX_WAIT_TRAIN : MAX_WAIT_BUS)) giveUpTransit(ctx, p);
    }
    if (p.path.length) {
      const done = stepAlong(p as unknown as { x: number; y: number; heading: number; path: Array<{ x: number; y: number }> } & Person, 0, 0) && false; // placeholder (never used)
      void done;
      const mover = { x: p.loc.x, y: p.loc.y, heading: p.heading, path: p.path };
      const arrived = stepAlong(mover, speedFor(ctx, p), dtMin);
      p.loc.x = mover.x;
      p.loc.y = mover.y;
      p.heading = mover.heading;
      // Once outside the origin building, clear the building reference so the renderer draws them on the street.
      if (p.loc.buildingId && p.target && p.loc.buildingId !== p.target.buildingId) {
        const b = world.buildings[p.loc.buildingId];
        if (b && !(p.loc.x >= b.x - 1 && p.loc.x <= b.x + b.w + 1 && p.loc.y >= b.y - 1 && p.loc.y <= b.y + b.h + 1)) {
          p.loc.buildingId = null;
          p.loc.roomId = null;
          p.loc.spotId = null;
        }
      }
      // At the gate for a taxi, or at the stop for the bus: stand there rather than "arrive" at the far end.
      if (arrived && !p.waitingFor && !p.waitingLine) arrive(ctx, p);
      else if (arrived && p.waitingLine) p.loc.buildingId = stopAt(ctx, p.loc.x, p.loc.y)?.id ?? null;
      continue;
    }
    if (p.waitingFor || p.waitingLine) continue;
    // Idle wandering inside the room
    if (minuteTick && !p.conversationId) {
      const a = p.plan[p.planIdx];
      if (a && WANDER_KINDS.has(a.kind) && p.target?.roomId) {
        p.wanderTimer -= 1;
        if (p.wanderTimer <= 0) {
          const b = world.buildings[p.target.buildingId!];
          const r = b ? roomOf(b, p.target.roomId) : null;
          if (r && rng.bernoulli(a.kind === 'work' ? 0.15 : 0.6)) {
            const radius = a.kind === 'work' ? 3 : 8;
            const nx = Math.min(r.x + r.w - 1, Math.max(r.x + 1, p.target.x + rng.range(-radius, radius)));
            const ny = Math.min(r.y + r.h - 1, Math.max(r.y + 1, p.target.y + rng.range(-radius, radius)));
            p.path = [{ x: nx, y: ny }];
          }
          p.wanderTimer = 2 + rng.int(5);
        }
      }
    }
  }
}

/** Time-lapse placement: put everyone at the spot of the activity running now. */
export function macroPlace(ctx: Ctx): void {
  const world = ctx.world;
  const mod = world.minuteOfDay;
  for (const p of alivePeople(world)) {
    if (p.away) continue;
    p.inVehicleId = null;
    p.waitingFor = null;
    p.waitingLine = null;
    p.alightAt = null;
    p.waitedMin = 0;
    p.path = [];
    const a = activityAt(p.plan, mod);
    if (!a) continue;
    const idx = p.plan.indexOf(a);
    if (idx === p.planIdx && p.loc.buildingId === a.buildingId) continue;
    p.planIdx = idx;
    const b = world.buildings[a.buildingId];
    if (!b) continue;
    const room = roomForActivity(b, a);
    const spots = room ? spotPool(room, p, a) : [];
    const h = hashId(p.id);
    const bed = room ? homeBed(world, b, room, p, a) : null;
    if (bed) p.loc = { x: bed.spot.x + bed.side, y: bed.spot.y, buildingId: b.id, roomId: room!.id, spotId: bed.spot.id };
    else if (spots.length) {
      const s = spots[h % spots.length];
      p.loc = { x: s.x + ((h >> 3) % 5) * 0.4 - 0.8, y: s.y + ((h >> 6) % 5) * 0.4 - 0.8, buildingId: b.id, roomId: room!.id, spotId: s.id };
    } else if (room) {
      p.loc = { x: room.x + 2 + (h % 97) / 97 * Math.max(1, room.w - 4), y: room.y + 2 + ((h >> 7) % 89) / 89 * Math.max(1, room.h - 4), buildingId: b.id, roomId: room.id, spotId: null };
    } else {
      p.loc = { x: b.x + b.w / 2, y: b.y + b.h / 2, buildingId: b.id, roomId: null, spotId: null };
    }
    p.target = { ...p.loc };
  }
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    v.moving = false;
    v.path = [];
    v.occupantIds = [];
    v.boardIds = [];
    v.stage = null;
    v.destBuildingId = null;
    v.driverId = null;
    v.x = v.homeX;
    v.y = v.homeY;
    v.heading = v.homeHeading ?? v.heading;
    v.parkHeading = null;
    v.idleSince = world.minute;
    if (v.kind === 'ride') {
      v.online = false;
      v.fare = undefined;
      v.surge = undefined;
    }
  }
  resetTransit(world);
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Send someone straight to a building now (emergencies, funerals in progress). */
export function goNow(ctx: Ctx, p: Person, buildingId: string, kind: Activity['kind'], label: string, minutes: number, roomId?: string, opts: { ambulance?: boolean } = {}): void {
  const mod = ctx.world.minuteOfDay;
  const a: Activity = { kind, start: mod, end: Math.min(1440, mod + minutes), buildingId, roomId, label };
  if (opts.ambulance) a.ambulance = true;
  // Splice into the plan: truncate the current activity and insert.
  const cur = p.plan[p.planIdx];
  const left = cur && cur.end > mod ? cur.buildingId : null;
  if (cur) cur.end = Math.min(cur.end, mod);
  p.plan.push(a);
  p.plan.sort((x, y) => x.start - y.start);
  p.planIdx = p.plan.indexOf(a);
  beginActivity(ctx, p, a);
  // A grown-up called away from a house with small children in it: someone else comes to mind them.
  if (left && left !== buildingId && p.age >= SUPERVISOR_AGE) coverChildrenNow(ctx, left, mod);
}
