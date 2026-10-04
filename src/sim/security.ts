// Public safety: intruders from outside, incidents between residents,
// police response (animated in micro mode, statistical in macro mode),
// the magistrate's court, and road accidents.

import type { Ctx } from './ctx';
import { farmLoss, hhPayOut } from './finance';
import { alivePeople, clamp, dist, fullName, householdMembers } from './ctx';
import { fillVacancies } from './economy';
import { injure } from './health';
import { ambulanceTo, dispatchVehicle, goNow, roadPolyline } from './movement';
import { cityOfPerson, communityOfPerson, refreshRoles } from './population';
import type { Activity, Building, CourtCase, Incident, IncidentKind, Intruder, IntruderKind, Person } from './types';
import { COMMUNITY, EXITS, POLICE_IDS, cityAt, cityOf, landmark, landmarksOfKind, nearestExit, roomByKind } from './world';

const INTRUDER_WEIGHTS: Array<[IntruderKind, number]> = [
  ['burglar', 0.28],
  ['pickpocket', 0.12],
  ['troublemaker', 0.16],
  ['stray-dog', 0.12],
  ['snake', 0.08],
  ['stranger', 0.1],
  ['con-artist', 0.06],
  ['stock-thief', 0.05],
  ['wildfire', 0.03],
];

const INTRUDER_LABEL: Record<IntruderKind, string> = {
  burglar: 'a burglar',
  pickpocket: 'a pickpocket',
  troublemaker: 'a drunk troublemaker',
  'stray-dog': 'a stray dog',
  snake: 'a snake',
  stranger: 'a stranger asking for help',
  'con-artist': 'a con artist',
  'stock-thief': 'stock thieves',
  wildfire: 'a veld fire',
};

/** The station that answers a call from a point: the nearest one (the provincial headquarters included). */
export function stationFor(ctx: Ctx, x: number, y: number): string {
  let best = POLICE_IDS[0];
  let bd = Infinity;
  for (const id of POLICE_IDS) {
    const b = ctx.world.buildings[id];
    if (!b) continue;
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

/** Officers fit for duty: the nearest station's first, then anyone's. */
function policeOnDuty(ctx: Ctx, near?: { x: number; y: number }): Person[] {
  const world = ctx.world;
  const fit = (id: string) => {
    const p = world.people[id];
    return p && p.alive && !p.away && !p.emigrated && p.health.hospitalDaysLeft === 0;
  };
  if (near) {
    const station = stationFor(ctx, near.x, near.y);
    const own = (world.roles.policeByStation[station] ?? []).filter(fit).map((id) => world.people[id]);
    if (own.length) return own;
  }
  return world.roles.policeIds.filter(fit).map((id) => world.people[id]);
}

/** The nearest patrol car that is not already out. */
function policeVehicle(ctx: Ctx, near?: { x: number; y: number }) {
  let best = null as null | (typeof ctx.world.vehicles)[string];
  let bd = Infinity;
  for (const vid in ctx.world.vehicles) {
    const v = ctx.world.vehicles[vid];
    if (v.kind !== 'police' || v.moving) continue;
    const d = near ? Math.hypot(v.x - near.x, v.y - near.y) : 0;
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export function raiseIncident(
  ctx: Ctx,
  kind: IncidentKind,
  involvedIds: string[],
  x: number,
  y: number,
  buildingId: string | null,
  opts: { aggressorId?: string; intruderId?: string; loss?: number; text?: string; severity?: number } = {},
): Incident {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const id = ctx.nextId('incident');
  const inc: Incident = {
    id,
    kind,
    day: world.day,
    minute: world.minute,
    x,
    y,
    buildingId,
    involvedIds,
    intruderId: opts.intruderId ?? null,
    status: 'active',
    responderIds: [],
    outcome: '',
    respondedMinute: null,
    resolvedMinute: null,
    courtCaseId: null,
    handledBy: null,
    loss: opts.loss ?? 0,
  };
  world.incidents[id] = inc;
  world.stats.incidents++;
  world.stats.incidentsByKind[kind] = (world.stats.incidentsByKind[kind] ?? 0) + 1;
  const names = involvedIds.map((pid) => world.people[pid]).filter(Boolean).map((p) => fullName(p));
  for (const pid of involvedIds) {
    const p = world.people[pid];
    if (p) p.alertTimer = 45;
  }
  // Violence between residents: injuries, then police
  if (kind === 'fight' || kind === 'domestic' || kind === 'assault') {
    const aggressor = world.people[opts.aggressorId ?? involvedIds[0]];
    const victim = world.people[involvedIds.find((pid) => pid !== aggressor?.id) ?? involvedIds[0]];
    const sev = opts.severity ?? rng.range(0.12, 0.6);
    if (victim) injure(ctx, victim, sev, `hurt in ${kind === 'domestic' ? 'a domestic fight' : 'a fight'}`);
    if (aggressor && rng.bernoulli(0.35)) injure(ctx, aggressor, sev * 0.6, 'hurt in a fight');
    ctx.emit({ kind: 'fight', severity: 'danger', text: opts.text ?? `${names.join(' and ')} came to blows${buildingId ? ` at ${world.buildings[buildingId]?.name ?? 'the scene'}` : ''}.`, personIds: involvedIds, buildingId: buildingId ?? undefined, x, y });
    const officers = policeOnDuty(ctx, { x, y });
    if (officers.length && rng.bernoulli(kind === 'domestic' ? 0.55 : 0.75)) {
      respond(ctx, inc, officers, aggressor ?? null, kind === 'domestic' ? 0.45 : 0.65);
    } else {
      inc.status = 'resolved';
      inc.handledBy = 'neighbours';
      inc.outcome = 'separated by neighbours';
      inc.resolvedMinute = world.minute;
    }
    if (aggressor) aggressor.reputation = clamp(aggressor.reputation - 0.2, -1, 1);
  } else {
    ctx.emit({ kind: kind === 'road-accident' ? 'accident' : 'crime', severity: kind === 'stranger' ? 'info' : 'alert', text: opts.text ?? `${kind} reported${names.length ? ` involving ${names.join(', ')}` : ''}.`, personIds: involvedIds, buildingId: buildingId ?? undefined, x, y });
  }
  return inc;
}

/** Police respond; in micro mode the vehicle is dispatched for the animation. */
function respond(ctx: Ctx, inc: Incident, officers: Person[], accused: Person | null, arrestProb: number): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  inc.status = 'responding';
  inc.responderIds = officers.map((o) => o.id);
  inc.respondedMinute = world.minute;
  inc.handledBy = 'police';
  const b = inc.buildingId ? world.buildings[inc.buildingId] : null;
  if (ctx.micro && b) {
    const car = policeVehicle(ctx, { x: inc.x, y: inc.y });
    if (car && !car.moving) dispatchVehicle(ctx, car, officers.filter((o) => !o.inVehicleId).slice(0, 2), b);
  }
  const arrested = accused ? rng.bernoulli(clamp(arrestProb * ctx.params.policeEffectiveness, 0, 0.95)) : false;
  concludeIncident(ctx, inc, arrested, accused);
}

export function concludeIncident(ctx: Ctx, inc: Incident, arrested: boolean, accused: Person | null, intruder?: Intruder): void {
  const world = ctx.world;
  inc.status = 'resolved';
  inc.resolvedMinute = world.minute;
  if (arrested) {
    world.stats.arrests++;
    const who = accused ? fullName(accused) : intruder ? intruder.name : 'the suspect';
    inc.outcome = `${who} arrested`;
    ctx.emit({ kind: 'arrest', severity: 'alert', text: `Police arrested ${who} (${inc.kind}).`, personIds: accused ? [accused.id] : [], buildingId: stationFor(ctx, inc.x, inc.y) });
    if (accused) {
      accused.criminalRecord++;
      accused.history.push({ day: world.day, kind: 'arrest', text: `Arrested for ${inc.kind}.` });
    }
    fileCase(ctx, inc, accused, intruder);
  } else {
    inc.outcome = accused ? 'warned, no arrest' : 'suspect got away';
    if (intruder) inc.status = 'escaped';
  }
}

function chargeFor(kind: IncidentKind): string {
  switch (kind) {
    case 'fight':
    case 'assault':
      return 'assault';
    case 'domestic':
      return 'domestic violence';
    case 'burglary':
      return 'housebreaking';
    case 'theft':
      return 'theft';
    case 'drunk-disorderly':
      return 'public disturbance';
    case 'fraud':
      return 'fraud';
    case 'stock-theft':
      return 'stock theft';
    case 'vandalism':
      return 'malicious damage to property';
    default:
      return kind;
  }
}

/** The magistrate's court a case goes to: the accused's own city's, else the one nearest the scene. */
function courtFor(ctx: Ctx, inc: Incident, accused: Person | null): string {
  const world = ctx.world;
  if (accused) return landmark(communityOfPerson(world, accused), 'court');
  const city = cityAt(inc.x, inc.y);
  const com = city ? COMMUNITY[world.buildings[inc.buildingId ?? '']?.community ?? 'ebenezer'] : null;
  return landmark(com?.city === city ? com.id : (inc.buildingId ? world.buildings[inc.buildingId]?.community : null) ?? 'ebenezer', 'court');
}

export function fileCase(ctx: Ctx, inc: Incident, accused: Person | null, intruder?: Intruder): CourtCase {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const id = ctx.nextId('court');
  const hearing = world.day + 14 + rng.int(32);
  const c: CourtCase = {
    id,
    courtId: courtFor(ctx, inc, accused),
    incidentId: inc.id,
    accusedId: accused?.id ?? intruder?.id ?? 'unknown',
    accusedName: accused ? fullName(accused) : intruder?.name ?? 'unknown',
    charge: chargeFor(inc.kind),
    filedDay: world.day,
    hearingDay: hearing,
    verdict: 'pending',
    sentence: null,
    fine: 0,
  };
  world.courtCases[id] = c;
  inc.courtCaseId = id;
  world.stats.courtCases++;
  ctx.emit({ kind: 'court', severity: 'info', text: `Case opened: ${c.accusedName} charged with ${c.charge}; hearing at ${world.buildings[c.courtId]?.name ?? 'the court'} in ${hearing - world.day} days.`, personIds: accused ? [accused.id] : [], buildingId: c.courtId });
  return c;
}

// ─── Intruders ─────────────────────────────────────────────────────────────

function minuteFor(rng: ReturnType<Ctx['rng']['stream']>, kind: IntruderKind, weekday: number): number {
  switch (kind) {
    case 'burglar':
      return rng.bernoulli(0.55) ? 60 + rng.int(200) : 600 + rng.int(240);
    case 'pickpocket':
      return 540 + rng.int(420);
    case 'troublemaker':
      return weekday === 5 || weekday === 6 ? 1140 + rng.int(240) : 1000 + rng.int(300);
    case 'stock-thief':
      return 30 + rng.int(200);
    case 'wildfire':
      return 720 + rng.int(240);
    default:
      return 480 + rng.int(540);
  }
}

export function scheduleIntruders(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const P = ctx.params;
  const season = world.weather.season;
  const seasonal = ctx.cal.month === 12 ? 1.4 : 1;
  const n = rng.poisson((P.intrudersPerYear / 365.25) * seasonal);
  world.scheduledIntruders = [];
  for (let i = 0; i < n; i++) {
    let kind = rng.weighted(INTRUDER_WEIGHTS);
    if (kind === 'snake' && season === 'winter') kind = 'stray-dog';
    if (kind === 'wildfire' && !(world.weather.rainMm === 0 && world.weather.windKmh > 18 && (season === 'winter' || season === 'spring'))) kind = 'stranger';
    world.scheduledIntruders.push({ minute: minuteFor(rng, kind, ctx.cal.weekday), kind, done: false });
  }
}

function targetFor(ctx: Ctx, kind: IntruderKind): Building {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const houses = Object.values(world.buildings).filter((b) => b.kind === 'house' && b.householdId);
  const of = (k: Parameters<typeof landmarksOfKind>[0]) => world.buildings[rng.pick(landmarksOfKind(k))];
  switch (kind) {
    case 'burglar':
    case 'con-artist':
    case 'stranger': {
      // Burglars prefer houses that are empty right now — and the richer the street, the better.
      if (kind === 'burglar') {
        const empty = houses.filter((h) => !alivePeople(world).some((p) => p.loc.buildingId === h.id));
        if (empty.length && rng.bernoulli(0.7)) return rng.pick(empty);
      }
      return rng.pick(houses);
    }
    case 'pickpocket':
      return rng.bernoulli(0.35) ? world.buildings.mall : of('shop');
    case 'troublemaker':
      return rng.pick([of('shop'), of('park'), world.buildings.stadium, world.buildings.terminus, rng.pick(houses)]);
    case 'stray-dog':
      return rng.pick([of('park'), of('school'), rng.pick(houses)]);
    case 'snake':
      return rng.pick([of('farm'), of('park'), world.buildings.grandpark, rng.pick(houses)]);
    case 'stock-thief':
      return of('farm');
    case 'wildfire':
      return rng.bernoulli(0.7) ? of('farm') : rng.bernoulli(0.5) ? of('park') : world.buildings.grandpark;
  }
}

function actingMinutes(rng: ReturnType<Ctx['rng']['stream']>, kind: IntruderKind): number {
  switch (kind) {
    case 'burglar':
      return 6 + rng.int(10);
    case 'pickpocket':
      return 8 + rng.int(8);
    case 'troublemaker':
      return 15 + rng.int(20);
    case 'stray-dog':
      return 40 + rng.int(40);
    case 'snake':
      return 60 + rng.int(60);
    case 'stranger':
      return 6 + rng.int(6);
    case 'con-artist':
      return 10 + rng.int(8);
    case 'stock-thief':
      return 8 + rng.int(8);
    case 'wildfire':
      return 45 + rng.int(45);
  }
}

const INTRUDER_NAMES = ['an unknown man', 'a young man in a hoodie', 'a stranger from the taxi rank', 'two men in a bakkie', 'a man nobody recognised', 'a woman with a clipboard', 'a boy from the next village'];

function nearestExitPoint(x: number, y: number): { x: number; y: number } {
  const e = nearestExit(x, y);
  return { x: e.x, y: e.y };
}

export function spawnIntruder(ctx: Ctx, kind: IntruderKind): Intruder {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const id = ctx.nextId('intruder');
  const target = targetFor(ctx, kind);
  // Mostly from the nearest edge of the region; now and then from across it.
  const exit = rng.bernoulli(0.75) ? nearestExit(target.x, target.y) : EXITS[rng.int(EXITS.length)];
  const name = kind === 'stray-dog' ? 'a stray dog' : kind === 'snake' ? 'a snake' : kind === 'wildfire' ? 'a veld fire' : kind === 'stock-thief' ? 'stock thieves' : rng.pick(INTRUDER_NAMES);
  const startNode = exit.node;
  const road = roadPolyline(ctx, startNode, target.roadNode);
  const path = kind === 'wildfire' ? [] : [...road, { x: target.entrance.x, y: target.entrance.y }];
  const intr: Intruder = {
    id,
    kind,
    name,
    x: kind === 'wildfire' ? target.x + target.w / 2 : exit.x,
    y: kind === 'wildfire' ? target.y + target.h / 2 : exit.y,
    heading: 0,
    path,
    targetBuildingId: target.id,
    state: kind === 'wildfire' ? 'acting' : 'approaching',
    spawnedMinute: world.minute,
    minutesLeft: actingMinutes(rng, kind),
    spottedByIds: [],
    incidentId: null,
  };
  if (kind === 'wildfire') {
    const inc = raiseIncident(ctx, 'fire', [], intr.x, intr.y, target.id, { intruderId: id, text: `A veld fire has broken out at ${target.name}!`, loss: 0 });
    intr.incidentId = inc.id;
    intr.state = 'acting';
    // Everyone nearby + police + builder + farmer fight it
    const fighters = alivePeople(world).filter((p) => p.age >= 16 && p.age < 65 && !p.away && (p.job === 'police' || p.job === 'builder' || p.job === 'farmer' || p.job === 'farmhand' || dist(p.loc.x, p.loc.y, intr.x, intr.y) < 120));
    for (const f of fighters.slice(0, 10)) goNow(ctx, f, target.id, 'work', 'fighting the veld fire', intr.minutesLeft, target.rooms[1]?.id ?? target.rooms[0]?.id);
    inc.responderIds = fighters.slice(0, 10).map((f) => f.id);
    inc.handledBy = 'neighbours';
  }
  world.intruders[id] = intr;
  return intr;
}

function incidentKindFor(kind: IntruderKind): IncidentKind {
  switch (kind) {
    case 'burglar':
      return 'burglary';
    case 'pickpocket':
      return 'theft';
    case 'troublemaker':
      return 'drunk-disorderly';
    case 'stray-dog':
      return 'animal';
    case 'snake':
      return 'snake';
    case 'stranger':
      return 'stranger';
    case 'con-artist':
      return 'fraud';
    case 'stock-thief':
      return 'stock-theft';
    case 'wildfire':
      return 'fire';
  }
}

function detectionRadius(kind: IntruderKind): number {
  switch (kind) {
    case 'troublemaker':
      return 45;
    case 'wildfire':
      return 250;
    case 'snake':
      return 10;
    case 'con-artist':
    case 'stranger':
      return 14;
    default:
      return 26;
  }
}

/** Micro mode: advance every active intruder by one minute. */
export function intruderMinute(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const mod = world.minuteOfDay;
  for (const s of world.scheduledIntruders) {
    if (!s.done && mod >= s.minute) {
      s.done = true;
      spawnIntruder(ctx, s.kind);
    }
  }
  const people = alivePeople(world).filter((p) => !p.away);
  const night = mod < 300 || mod > 1260;
  for (const id in world.intruders) {
    const it = world.intruders[id];
    if (it.state === 'gone') {
      delete world.intruders[id];
      continue;
    }
    const target = it.targetBuildingId ? world.buildings[it.targetBuildingId] : null;
    // Movement
    if (it.state === 'approaching' || it.state === 'fleeing') {
      const speed = it.kind === 'stray-dog' ? 110 : it.kind === 'snake' ? 6 : it.state === 'fleeing' ? 130 : 70;
      let budget = speed;
      while (budget > 0 && it.path.length) {
        const t = it.path[0];
        const d = dist(it.x, it.y, t.x, t.y);
        if (d <= budget) {
          it.x = t.x;
          it.y = t.y;
          budget -= d;
          it.path.shift();
        } else {
          it.heading = Math.atan2(t.y - it.y, t.x - it.x);
          it.x += ((t.x - it.x) / d) * budget;
          it.y += ((t.y - it.y) / d) * budget;
          budget = 0;
        }
      }
      if (!it.path.length) {
        if (it.state === 'fleeing') {
          it.state = 'gone';
          continue;
        }
        it.state = 'acting';
        if (target && it.kind !== 'stray-dog') {
          // step inside / into the yard
          const room = target.kind === 'house' ? roomByKind(target, 'yard') : target.rooms[0];
          if (room) {
            it.x = room.x + room.w / 2 + rng.range(-4, 4);
            it.y = room.y + room.h / 2 + rng.range(-4, 4);
          }
        }
      }
    } else if (it.state === 'acting') {
      it.minutesLeft--;
      if (it.kind === 'stray-dog' && rng.bernoulli(0.2)) {
        // Roams its own settlement's streets.
        const c = COMMUNITY[target?.community ?? 'ebenezer'];
        it.x = clamp(it.x + rng.range(-25, 25), c.x + 5, c.x + c.w - 5);
        it.y = clamp(it.y + rng.range(-25, 25), c.y + 5, c.y + c.h - 5);
      }
      if (it.minutesLeft <= 0) {
        // Finished unobserved: the deed is done
        finishUnobserved(ctx, it, target);
        continue;
      }
    } else if (it.state === 'caught') {
      it.minutesLeft--;
      if (it.minutesLeft <= 0) it.state = 'gone';
      continue;
    }
    // Detection by residents
    if (!it.incidentId && (it.state === 'acting' || it.state === 'approaching')) {
      const R = detectionRadius(it.kind);
      for (const p of people) {
        if (p.age < 6) continue;
        const asleep = p.plan[p.planIdx]?.kind === 'sleep';
        if (dist(p.loc.x, p.loc.y, it.x, it.y) > R) continue;
        let pDetect = 0.07 * (p.archetype === 'sentinel' ? 1.7 : 1) * (night && it.kind !== 'troublemaker' && it.kind !== 'wildfire' ? 0.5 : 1);
        if (asleep) pDetect *= it.kind === 'burglar' || it.kind === 'stock-thief' ? 0.15 : 0.03;
        if (it.kind === 'con-artist' || it.kind === 'stranger') pDetect = p.loc.buildingId === it.targetBuildingId ? 0.5 : 0;
        if (rng.bernoulli(pDetect)) {
          it.spottedByIds.push(p.id);
          onDetected(ctx, it, p, target);
          break;
        }
      }
    }
  }
}

function finishUnobserved(ctx: Ctx, it: Intruder, target: Building | null): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  if (it.kind === 'burglar' || it.kind === 'stock-thief' || it.kind === 'pickpocket') {
    const loss = it.kind === 'stock-thief' ? 8_000 + rng.int(20_000) : it.kind === 'burglar' ? 1_500 + rng.int(12_000) : 200 + rng.int(1_500);
    const hh = target?.householdId ? world.households[target.householdId] : null;
    const victim = it.kind === 'pickpocket' ? alivePeople(world).filter((p) => p.loc.buildingId === target?.id)[0] ?? null : null;
    const inc = raiseIncident(ctx, incidentKindFor(it.kind), victim ? [victim.id] : hh ? [hh.headId ?? hh.memberIds[0]] : [], it.x, it.y, target?.id ?? null, { intruderId: it.id, loss, text: `${target?.name ?? 'The farm'} was hit by ${INTRUDER_LABEL[it.kind]} — R${loss.toLocaleString()} lost, discovered later.` });
    inc.status = 'escaped';
    inc.outcome = 'discovered after the fact';
    if (hh) hhPayOut(ctx, hh, loss, '5170', `Loss to ${INTRUDER_LABEL[it.kind]}, discovered later`);
    else if (it.kind === 'stock-thief') farmLoss(ctx, loss, 'Stock theft discovered after the fact');
  } else if (it.kind === 'wildfire') {
    const inc = it.incidentId ? world.incidents[it.incidentId] : null;
    if (inc) {
      inc.status = 'resolved';
      inc.loss = 5_000 + rng.int(40_000);
      inc.outcome = 'fire beaten back by the community';
      inc.resolvedMinute = world.minute;
      ctx.emit({ kind: 'crime', severity: 'joy', text: `The veld fire is out. Damage about R${inc.loss.toLocaleString()}.`, buildingId: target?.id ?? undefined });
    }
  }
  it.state = 'fleeing';
  it.path = [nearestExitPoint(it.x, it.y)];
}

function onDetected(ctx: Ctx, it: Intruder, spotter: Person, target: Building | null): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  spotter.alertTimer = 40;
  const kind = incidentKindFor(it.kind);
  if (it.kind === 'stranger') {
    const helper = spotter;
    const inc = raiseIncident(ctx, kind, [helper.id], it.x, it.y, target?.id ?? null, { intruderId: it.id, text: `${fullName(helper)} met a stranger at the gate and ${helper.big5.A > 0.5 ? 'gave them food and directions' : 'sent them on their way'}.` });
    inc.status = 'resolved';
    inc.handledBy = 'self';
    inc.outcome = 'helped';
    it.incidentId = inc.id;
    it.state = 'fleeing';
    it.path = [nearestExitPoint(it.x, it.y)];
    if (helper.big5.A > 0.5) helper.mood = clamp(helper.mood + 0.1, -1, 1);
    return;
  }
  if (it.kind === 'con-artist') {
    const hh = target?.householdId ? world.households[target.householdId] : null;
    const adults = hh ? householdMembers(world, hh.id).filter((p) => p.age >= 18 && p.loc.buildingId === target?.id) : [];
    const guard = adults.some((p) => p.archetype === 'sentinel' || p.archetype === 'organiser' || p.big5.C > 0.7);
    const mark = adults.sort((a, b) => b.big5.A - a.big5.A)[0] ?? spotter;
    const loss = guard ? 0 : 500 + rng.int(7_500);
    const inc = raiseIncident(ctx, 'fraud', [mark.id], it.x, it.y, target?.id ?? null, { intruderId: it.id, loss, text: guard ? `A con artist tried the ${hh?.name ?? ''} household but ${fullName(adults.find((p) => p.archetype === 'sentinel' || p.archetype === 'organiser') ?? mark)} saw through the scheme.` : `A con artist talked ${fullName(mark)} out of R${loss.toLocaleString()}.` });
    inc.status = 'resolved';
    inc.handledBy = 'self';
    inc.outcome = guard ? 'foiled' : 'money lost';
    if (hh && !guard) hhPayOut(ctx, hh, loss, '5170', `Loss to ${INTRUDER_LABEL[it.kind]}`);
    it.incidentId = inc.id;
    it.state = 'fleeing';
    it.path = [nearestExitPoint(it.x, it.y)];
    return;
  }
  if (it.kind === 'snake' || it.kind === 'stray-dog') {
    const inc = raiseIncident(ctx, kind, [spotter.id], it.x, it.y, target?.id ?? null, { intruderId: it.id, text: `${fullName(spotter)} spotted ${INTRUDER_LABEL[it.kind]} at ${target?.name ?? 'the road'}.` });
    it.incidentId = inc.id;
    // A capable adult deals with it
    const handlers = alivePeople(world).filter((p) => p.age >= 16 && p.age < 70 && !p.away && dist(p.loc.x, p.loc.y, it.x, it.y) < 80 && (p.job === 'farmer' || p.job === 'farmhand' || p.job === 'builder' || p.job === 'police' || p.big5.E > 0.6));
    const h = handlers[0] ?? spotter;
    const bite = rng.bernoulli(it.kind === 'snake' ? 0.08 : 0.12);
    if (bite) {
      const victim = it.kind === 'stray-dog' && spotter.age < 14 ? spotter : h;
      injure(ctx, victim, it.kind === 'snake' ? 0.6 : 0.3, it.kind === 'snake' ? 'snake bite' : 'dog bite');
    }
    inc.status = 'resolved';
    inc.handledBy = h.job === 'police' ? 'police' : 'neighbours';
    inc.outcome = `${fullName(h)} ${it.kind === 'snake' ? 'removed the snake' : 'chased the dog off'}`;
    inc.responderIds = [h.id];
    inc.resolvedMinute = world.minute;
    ctx.emit({ kind: 'intruder', severity: 'info', text: `${inc.outcome}${bite ? ' — someone was bitten' : ''}.`, personIds: [h.id], buildingId: target?.id ?? undefined });
    it.state = 'fleeing';
    it.path = [nearestExitPoint(it.x, it.y)];
    it.minutesLeft = 0;
    return;
  }
  // Police matters
  const inc = raiseIncident(ctx, kind, [spotter.id], it.x, it.y, target?.id ?? null, { intruderId: it.id, text: `${fullName(spotter)} spotted ${INTRUDER_LABEL[it.kind]} at ${target?.name ?? 'the road'} and raised the alarm.` });
  it.incidentId = inc.id;
  const officers = policeOnDuty(ctx, { x: it.x, y: it.y }).filter((o) => !o.inVehicleId);
  const rngS = ctx.rng.stream('security');
  if (officers.length && target) {
    inc.status = 'responding';
    inc.responderIds = officers.slice(0, 2).map((o) => o.id);
    inc.respondedMinute = world.minute;
    inc.handledBy = 'police';
    const car = policeVehicle(ctx, { x: it.x, y: it.y });
    if (car && !car.moving) dispatchVehicle(ctx, car, officers.slice(0, 2), target);
    // Outcome resolved statistically at the response time; the animation plays it out.
    const responseMin = 3 + rngS.int(6);
    const stillThere = it.minutesLeft > responseMin;
    const arrested = stillThere && rngS.bernoulli(clamp((it.kind === 'troublemaker' ? 0.85 : it.kind === 'burglar' ? 0.65 : 0.55) * ctx.params.policeEffectiveness, 0, 0.95));
    if (arrested) {
      it.state = 'caught';
      it.minutesLeft = responseMin + 40;
      const station = world.buildings[stationFor(ctx, it.x, it.y)];
      const cells = roomByKind(station, 'cell');
      const cell = cells?.spots[0];
      it.path = [];
      setTimeoutMinute(it, cell ? { x: cell.x, y: cell.y } : { x: station.x + 10, y: station.y + 10 }, responseMin);
    } else {
      it.state = 'fleeing';
      it.path = [nearestExitPoint(it.x, it.y)];
    }
    concludeIncident(ctx, inc, arrested, null, it);
    if (!arrested && (it.kind === 'burglar' || it.kind === 'pickpocket')) {
      inc.loss = it.kind === 'burglar' ? rngS.int(4000) : rngS.int(800);
      const hh = target?.householdId ? world.households[target.householdId] : null;
      if (hh) hhPayOut(ctx, hh, inc.loss, '5170', `Loss to a ${it.kind === 'burglar' ? 'burglary' : 'pickpocket'}`);
    }
  } else {
    // Neighbours confront
    const brave = alivePeople(world).filter((p) => p.age >= 18 && p.age < 60 && p.sex === 'M' && !p.away && dist(p.loc.x, p.loc.y, it.x, it.y) < 60 && p.big5.E > 0.45);
    const ok = brave.length > 0 && rngS.bernoulli(0.4 + 0.15 * Math.min(3, brave.length));
    inc.handledBy = 'neighbours';
    inc.responderIds = brave.slice(0, 3).map((p) => p.id);
    if (brave.length && rngS.bernoulli(0.2)) injure(ctx, brave[0], 0.35, 'hurt confronting an intruder');
    inc.status = ok ? 'resolved' : 'escaped';
    inc.outcome = ok ? 'chased off by neighbours' : 'got away';
    inc.resolvedMinute = world.minute;
    ctx.emit({ kind: 'intruder', severity: ok ? 'info' : 'alert', text: ok ? `Neighbours chased ${it.name} away.` : `${it.name} got away before anyone could act.`, personIds: inc.responderIds });
    it.state = 'fleeing';
    it.path = [nearestExitPoint(it.x, it.y)];
  }
}

/** Walk to the cells after `delay` minutes (approximated by a short path). */
function setTimeoutMinute(it: Intruder, to: { x: number; y: number }, delay: number): void {
  it.path = [to];
  it.state = 'caught';
  void delay;
}

/** Macro mode: resolve the day's scheduled intruders statistically. */
export function resolveIntrudersMacro(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  for (const s of world.scheduledIntruders) {
    if (s.done) continue;
    s.done = true;
    const target = targetFor(ctx, s.kind);
    const night = s.minute < 300 || s.minute > 1260;
    const officers = policeOnDuty(ctx, { x: target.x + target.w / 2, y: target.y + target.h / 2 });
    const kind = incidentKindFor(s.kind);
    const x = target.x + target.w / 2;
    const y = target.y + target.h / 2;
    const hh = target.householdId ? world.households[target.householdId] : null;
    const someoneHome = hh ? householdMembers(world, hh.id).some((p) => p.job === 'homemaker' || p.job === 'retired' || p.job === 'unemployed' || night) : true;
    switch (s.kind) {
      case 'stranger': {
        const helper = hh ? householdMembers(world, hh.id).find((p) => p.age >= 16) : alivePeople(world).find((p) => p.age >= 16);
        if (!helper) break;
        const inc = raiseIncident(ctx, kind, [helper.id], x, y, target.id, { text: `${fullName(helper)} helped a stranger who came to the gate.` });
        inc.status = 'resolved';
        inc.handledBy = 'self';
        inc.outcome = 'helped';
        break;
      }
      case 'con-artist': {
        if (!hh) break;
        const adults = householdMembers(world, hh.id).filter((p) => p.age >= 18);
        const guard = adults.some((p) => p.archetype === 'sentinel' || p.archetype === 'organiser');
        const mark = adults[0];
        if (!mark) break;
        const loss = guard ? 0 : 500 + rng.int(7_500);
        const inc = raiseIncident(ctx, 'fraud', [mark.id], x, y, target.id, { loss, text: guard ? `A con artist tried the ${hh.name} household and was seen through.` : `A con artist talked ${fullName(mark)} out of R${loss.toLocaleString()}.` });
        inc.status = 'resolved';
        inc.outcome = guard ? 'foiled' : 'money lost';
        if (!guard) hhPayOut(ctx, hh, loss, '5170', `Fraud: ${fullName(mark)} was conned`);
        break;
      }
      case 'snake':
      case 'stray-dog': {
        const people = alivePeople(world).filter((p) => p.age >= 16 && p.age < 70);
        const h = people.find((p) => p.job === 'farmer' || p.job === 'builder') ?? people[0];
        if (!h) break;
        const inc = raiseIncident(ctx, kind, [h.id], x, y, target.id, { text: `${fullName(h)} dealt with ${INTRUDER_LABEL[s.kind]} at ${target.name}.` });
        inc.status = 'resolved';
        inc.handledBy = 'neighbours';
        inc.outcome = 'removed';
        if (rng.bernoulli(s.kind === 'snake' ? 0.08 : 0.12)) injure(ctx, h, s.kind === 'snake' ? 0.6 : 0.3, s.kind === 'snake' ? 'snake bite' : 'dog bite');
        break;
      }
      case 'wildfire': {
        const loss = 5_000 + rng.int(40_000);
        const inc = raiseIncident(ctx, 'fire', [], x, y, target.id, { loss, text: `A veld fire at ${target.name} was fought by the community; damage about R${loss.toLocaleString()}.` });
        inc.status = 'resolved';
        inc.handledBy = 'neighbours';
        inc.outcome = 'extinguished';
        break;
      }
      default: {
        // burglar / pickpocket / troublemaker / stock-thief
        const pDetect = s.kind === 'troublemaker' ? 0.9 : s.kind === 'pickpocket' ? 0.5 : someoneHome ? 0.6 : 0.25;
        const detected = rng.bernoulli(pDetect);
        const loss = s.kind === 'stock-thief' ? 8_000 + rng.int(20_000) : s.kind === 'burglar' ? 1_500 + rng.int(12_000) : s.kind === 'pickpocket' ? 200 + rng.int(1_500) : 0;
        const victimId = hh?.headId ?? alivePeople(world)[0]?.id;
        const inc = raiseIncident(ctx, kind, victimId ? [victimId] : [], x, y, target.id, { loss: detected ? Math.round(loss * 0.3) : loss, text: detected ? `${INTRUDER_LABEL[s.kind]} was spotted at ${target.name}; the alarm was raised.` : `${target.name} was hit by ${INTRUDER_LABEL[s.kind]} — R${loss.toLocaleString()} lost.` });
        if (detected && officers.length) {
          inc.handledBy = 'police';
          inc.responderIds = officers.map((o) => o.id);
          inc.respondedMinute = world.minute;
          const arrested = rng.bernoulli(clamp((s.kind === 'troublemaker' ? 0.8 : 0.5) * ctx.params.policeEffectiveness, 0, 0.95));
          concludeIncident(ctx, inc, arrested, null, { id: `x-${inc.id}`, name: INTRUDER_LABEL[s.kind] } as Intruder);
        } else if (detected) {
          inc.status = 'resolved';
          inc.handledBy = 'neighbours';
          inc.outcome = 'chased off';
        } else {
          inc.status = 'escaped';
          inc.outcome = 'discovered after the fact';
        }
        const payer = hh ?? (s.kind === 'stock-thief' ? (() => { const f = alivePeople(world).find((p) => p.job === 'farmer' && p.workplaceId === target.id) ?? alivePeople(world).find((p) => p.job === 'farmer'); return f ? world.households[f.householdId] : null; })() : null);
        if (payer) hhPayOut(ctx, payer, inc.loss, '5170', `Loss to ${INTRUDER_LABEL[s.kind]}`);
        if (s.kind === 'troublemaker' && rng.bernoulli(0.25)) {
          const victim = alivePeople(world).filter((p) => p.age >= 15 && p.sex === 'M')[rng.int(Math.max(1, alivePeople(world).length))];
          if (victim) injure(ctx, victim, 0.3, 'hurt by a troublemaker');
        }
      }
    }
  }
}

// ─── Court ─────────────────────────────────────────────────────────────────

export function courtDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  const isCourtDay = ctx.cal.weekday === 2 || ctx.cal.weekday === 4;
  for (const id in world.courtCases) {
    const c = world.courtCases[id];
    if (c.verdict !== 'pending' || c.hearingDay > world.day) continue;
    if (!isCourtDay || world.holiday) {
      c.hearingDay = world.day + 1;
      continue;
    }
    const mid = world.roles.magistrateByCourt[c.courtId] ?? world.roles.magistrateId;
    const magistrate = mid ? world.people[mid] : null;
    if (!magistrate || magistrate.away) {
      c.hearingDay = world.day + 7;
      continue;
    }
    const accused = world.people[c.accusedId] ?? null;
    const inc = world.incidents[c.incidentId];
    const caughtAtScene = inc?.handledBy === 'police';
    const fairness = 0.5 + 0.4 * (magistrate.big5.C - 0.5);
    const pGuilty = clamp(0.55 + (caughtAtScene ? 0.25 : 0) + 0.1 * (fairness - 0.5), 0.2, 0.95);
    const guilty = rng.bernoulli(pGuilty);
    c.verdict = guilty ? 'guilty' : rng.bernoulli(0.5) ? 'not-guilty' : 'dismissed';
    let text: string;
    if (guilty) {
      world.stats.convictions++;
      const serious = c.charge === 'housebreaking' || c.charge === 'stock theft' || c.charge === 'assault' || c.charge === 'fraud';
      if (serious && rng.bernoulli(accused ? 0.35 : 0.8)) {
        const months = 3 + rng.int(accused ? 9 : 24);
        c.sentence = `${months} months imprisonment`;
        if (accused) {
          accused.away = { untilDay: world.day + months * 30, reason: `serving ${months} months` };
          accused.reputation = clamp(accused.reputation - 0.4, -1, 1);
          // If they held an essential post, the community appoints a stand-in
          // now: the pulpit, the surgery and the bench cannot wait a month.
          refreshRoles(world);
          fillVacancies(ctx);
        }
      } else {
        c.fine = 500 + rng.int(9) * 500;
        c.sentence = `fine of R${c.fine.toLocaleString()}${c.charge === 'domestic violence' ? ' and a protection order' : rng.bernoulli(0.4) ? ' or 60 hours community service' : ''}`;
        if (accused) {
          const hh = world.households[accused.householdId];
          if (hh) hhPayOut(ctx, hh, c.fine, '5160', `Fine: ${fullName(accused)}, ${c.charge}`, { to: 'gov', toAccount: '4137', loan: 'legal', flow: 'tax' });
          accused.reputation = clamp(accused.reputation - 0.15, -1, 1);
        }
      }
      text = `Court: ${c.accusedName} found guilty of ${c.charge} — ${c.sentence}.`;
    } else text = `Court: the case against ${c.accusedName} (${c.charge}) was ${c.verdict === 'dismissed' ? 'dismissed' : 'dismissed after a not-guilty verdict'}.`;
    ctx.emit({ kind: 'court', severity: guilty ? 'alert' : 'info', text, personIds: accused ? [accused.id] : [], buildingId: c.courtId });
    if (accused) accused.history.push({ day: world.day, kind: 'court', text });
    world.todayHearings.push(c.id);
  }
}

/** After the plans are built: put today's court parties in their court's room 09:00–12:00. */
export function applyCourtAttendance(ctx: Ctx): void {
  const world = ctx.world;
  if (!world.todayHearings.length) return;
  const byCourt = new Map<string, Set<string>>();
  for (const cid of world.todayHearings) {
    const c = world.courtCases[cid];
    if (!c) continue;
    const attendees = byCourt.get(c.courtId) ?? byCourt.set(c.courtId, new Set()).get(c.courtId)!;
    if (world.people[c.accusedId]?.alive && !world.people[c.accusedId].away) attendees.add(c.accusedId);
    const inc = world.incidents[c.incidentId];
    for (const pid of inc?.involvedIds ?? []) if (world.people[pid]?.alive) attendees.add(pid);
  }
  for (const [courtId, attendees] of byCourt) {
    const court = world.buildings[courtId];
    if (!court) continue;
    const mid = world.roles.magistrateByCourt[courtId];
    if (mid) attendees.add(mid);
    for (const p of alivePeople(world)) if (p.job === 'clerk' && p.workplaceId === courtId) attendees.add(p.id);
    const officer = policeOnDuty(ctx, { x: court.x, y: court.y })[0];
    if (officer) attendees.add(officer.id);
    const room = roomByKind(court, 'courtroom')?.id;
    for (const pid of attendees) {
      const p = world.people[pid];
      if (!p || p.away || p.health.hospitalDaysLeft > 0) continue;
      overridePlan(p, { kind: 'court', start: 535, end: 720, buildingId: courtId, roomId: room, label: `at ${court.name}` });
    }
  }
  world.todayHearings = [];
}

export function overridePlan(p: Person, a: Activity): void {
  const out: Activity[] = [];
  for (const x of p.plan) {
    if (x.end <= a.start || x.start >= a.end) {
      out.push(x);
      continue;
    }
    if (x.start < a.start) out.push({ ...x, end: a.start });
    if (x.end > a.end) out.push({ ...x, start: a.end });
  }
  out.push(a);
  out.sort((m, n) => m.start - n.start);
  p.plan = out;
  p.planIdx = -1;
}

// ─── Road accidents ────────────────────────────────────────────────────────

const lastOdo = new Map<string, number>();

export function roadAccidentDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('security');
  for (const vid in world.vehicles) {
    const v = world.vehicles[vid];
    if (!v.householdId) continue;
    const hh = world.households[v.householdId];
    if (!hh || hh.dissolvedDay) continue;
    let km: number;
    if (ctx.micro) {
      km = v.odometerKm - (lastOdo.get(vid) ?? v.odometerKm);
      lastOdo.set(vid, v.odometerKm);
    } else {
      const workers = householdMembers(world, hh.id).filter((p) => p.workplaceId && p.driver).length;
      km = ctx.cal.weekday === 0 ? 1.2 : workers > 0 ? 2.4 + 0.6 * workers : 0.8;
      v.odometerKm += km;
    }
    world.stats.kmDriven += km;
    const p = (km / 1000) * ctx.params.roadAccidentPer1000Km;
    if (km > 0 && rng.bernoulli(p)) {
      const drivers = householdMembers(world, hh.id).filter((d) => d.driver && !d.away);
      const driver = drivers.length ? rng.pick(drivers) : null;
      const sev = rng.range(0.15, 1);
      const house = world.buildings[hh.houseId];
      // On the road home: the household's own street, or the highway for a long commute.
      const node = ctx.roads.nodes[house?.roadNode ?? ''];
      const edge = node ? world.roads.edges.find((e) => e.a === node.id || e.b === node.id) : null;
      const inc = raiseIncident(ctx, 'road-accident', driver ? [driver.id] : [], node?.x ?? house.x, node?.y ?? house.y, null, { text: `${driver ? fullName(driver) : 'A driver'} was in a road accident on ${edge?.name ?? 'the road'}.`, loss: 5_000 + rng.int(40_000), severity: sev });
      world.stats.roadAccidents++;
      inc.status = 'resolved';
      inc.handledBy = 'doctor';
      inc.outcome = sev > 0.9 ? 'fatal' : sev > 0.5 ? 'serious injury' : 'minor injury';
      if (ctx.micro && sev > 0.5 && node && house) ambulanceTo(ctx, house, { x: node.x, y: node.y });
      if (driver) {
        if (sev > 0.92) ctx.hooks.onDeath(driver, 'road accident', 'accident');
        else injure(ctx, driver, sev, 'road accident');
      }
      hhPayOut(ctx, hh, Math.round(inc.loss * (hh.insurance.medical ? 0.3 : 1)), '5060', 'Road accident: repairs and medical bills', { loan: 'medical', flow: 'imports', toAccount: '4040' });
      void house;
    }
  }
}
