// Daily routines. Every person gets a plan for the day at 00:00 — a sorted
// list of activities with a building and room. Plans are role-, age-,
// weekday-, term-, weather- and health-aware, and are randomised with the
// 'schedule' RNG stream so no two days are identical.
//
// Micro mode walks the plan minute by minute (movement.ts); macro mode
// samples it (activityAt) to place people for the time-lapse.

import { berths } from './beds';
import type { Ctx } from './ctx';
import { alivePeople, clamp, householdMembers } from './ctx';
import { affluence } from './institutions';
import { JOBS } from './population';
import type { Rng } from './rng';
import { recordAirTrip } from './finance/transport';
import { FLIGHTS, HOMEBOUND, OUTBOUND } from './transit';
import type { Activity, ActivityKind, Building, Gathering, Household, JobId, Person, Room } from './types';
import { isOutdoorFriendly } from './weather';
import { AIRPORT_TERMINAL, COUNCIL_IDS, cityOf, landmark, roadDistance, roomByKind, tierOf } from './world';

const HOLIDAYS_ZA: Record<string, string> = {
  '01-01': "New Year's Day",
  '03-21': 'Human Rights Day',
  '04-27': 'Freedom Day',
  '05-01': "Workers' Day",
  '06-16': 'Youth Day',
  '08-09': "Women's Day",
  '09-24': 'Heritage Day',
  '12-16': 'Day of Reconciliation',
  '12-25': 'Christmas Day',
  '12-26': 'Day of Goodwill',
};

/** Easter Sunday (Anonymous Gregorian algorithm). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export function holidayFor(year: number, month: number, day: number): string | null {
  const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (HOLIDAYS_ZA[key]) return HOLIDAYS_ZA[key];
  const e = easterSunday(year);
  const eMs = Date.UTC(year, e.month - 1, e.day);
  const dMs = Date.UTC(year, month - 1, day);
  const diff = Math.round((dMs - eMs) / 86_400_000);
  if (diff === -2) return 'Good Friday';
  if (diff === 0) return 'Easter Sunday';
  if (diff === 1) return 'Family Day';
  return null;
}

/** SA public-school calendar approximation: four terms, breaks in between, long December holiday. */
export function isSchoolDay(month: number, day: number, weekday: number, holiday: string | null): boolean {
  if (weekday === 0 || weekday === 6 || holiday) return false;
  const md = month * 100 + day;
  if (md < 115) return false; // Jan 1-14
  if (md >= 325 && md <= 407) return false; // autumn break
  if (md >= 625 && md <= 715) return false; // winter break
  if (md >= 925 && md <= 1005) return false; // spring break
  if (md >= 1205) return false; // December holidays
  return true;
}

function act(kind: ActivityKind, start: number, end: number, buildingId: string, label: string, roomId?: string, withIds?: string[]): Activity {
  return { kind, start: Math.max(0, Math.round(start)), end: Math.min(1440, Math.round(end)), buildingId, roomId, label, withIds };
}

function jitter(rng: Rng, mins: number, sd: number): number {
  return mins + rng.normal(0, sd);
}

/** Room chooser for the "at home" activities. */
function homeRoom(house: Building, kind: 'living' | 'kitchen' | 'bedroom' | 'yard'): string | undefined {
  return roomByKind(house, kind)?.id;
}

/** The room a person sleeps in at home: the one their bed is in (see beds.ts). */
function bedroomFor(house: Building, p: Person, ctx: Ctx): string | undefined {
  const hh = ctx.world.households[p.householdId];
  const berth = hh?.houseId === house.id ? berths(ctx.world, hh).get(p.id) : undefined;
  return berth?.roomId ?? house.rooms.find((r) => r.kind === 'bedroom')?.id;
}

export interface DayContext {
  weekday: number;
  holiday: string | null;
  schoolDay: boolean;
  outdoor: boolean;
  isSunday: boolean;
  gatherings: Ctx['world']['todayGatherings'];
  /** Households going to church together this Sunday (rolled once per household per day). */
  churchgoing: Set<string>;
}

export function dayContext(ctx: Ctx): DayContext {
  const cal = ctx.cal;
  const holiday = holidayFor(cal.year, cal.month, cal.day);
  // A family goes to church together or not at all: the household decides, then
  // individuals follow (the sick and the very small are the usual exceptions).
  // In a congregation this devout the decision is close to automatic, so the
  // `churchAttendance` parameter reads as the share of residents at the service.
  const churchgoing = new Set<string>();
  if (cal.weekday === 0) {
    const rng = ctx.rng.stream('schedule');
    for (const id in ctx.world.households) {
      const hh = ctx.world.households[id];
      if (hh.dissolvedDay || !hh.memberIds.length) continue;
      // A household without a congregation to go to (Newhaven) has nothing to decide.
      if (!landmark(ctx.world.buildings[hh.houseId]?.community, 'church')) continue;
      if (rng.bernoulli(clamp(hh.faith * 1.02, 0, 0.995))) churchgoing.add(id);
    }
  }
  return {
    churchgoing,
    weekday: cal.weekday,
    holiday,
    schoolDay: isSchoolDay(cal.month, cal.day, cal.weekday, holiday),
    outdoor: isOutdoorFriendly(ctx.world.weather),
    isSunday: cal.weekday === 0,
    gatherings: ctx.world.todayGatherings,
  };
}

/** The visit target: a friend's or relative's house, if any. */
function visitTarget(ctx: Ctx, p: Person, rng: Rng): { houseId: string; withId: string } | null {
  const world = ctx.world;
  const cands = Object.entries(p.relationships)
    .filter(([id, r]) => (r.kind === 'friend' || r.kind === 'sibling' || r.kind === 'parent' || r.kind === 'child' || r.kind === 'grandparent' || r.kind === 'grandchild' || r.kind === 'neighbour') && r.strength > 0.2)
    .map(([id]) => world.people[id])
    .filter((q) => q && q.alive && !q.emigrated && q.householdId !== p.householdId);
  if (!cands.length) return null;
  const q = rng.pick(cands);
  const hh = world.households[q.householdId];
  return hh ? { houseId: hh.houseId, withId: q.id } : null;
}

export function buildDailyPlan(ctx: Ctx, p: Person, dc: DayContext): Activity[] {
  const rng = ctx.rng.stream('schedule');
  const world = ctx.world;
  const hh = world.households[p.householdId];
  const house = world.buildings[hh.houseId];
  const H = house.id;
  const bed = bedroomFor(house, p, ctx);
  const living = homeRoom(house, 'living');
  const kitchen = homeRoom(house, 'kitchen');
  const yard = homeRoom(house, 'yard');
  // The settlement's own church (if it has one), shop and park; the school,
  // clinic, court and hall are the city's; the stadium, the mall and the
  // hospital are the region's.
  const com = house.community ?? 'ebenezer';
  const city = cityOf(com);
  const CH = landmark(com, 'church');
  const SH = landmark(com, 'shop');
  const PK = landmark(com, 'park');
  const CL = landmark(com, 'clinic');
  const roomKind = (bid: string | null, kind: Room['kind']) => (bid ? roomByKind(world.buildings[bid], kind)?.id : undefined);
  const chNave = roomKind(CH, 'nave');
  const chHall = roomKind(CH, 'hall') ?? chNave;
  const chYard = roomKind(CH, 'yard') ?? chHall;
  const shFloor = roomKind(SH, 'shop');
  const pkPitch = roomKind(PK, 'pitch') ?? roomKind(PK, 'yard');
  const pkBench = roomKind(PK, 'yard') ?? pkPitch;
  const plan: Activity[] = [];
  const isBaby = p.age < 5;
  const isKid = p.age >= 5 && p.age < 18;
  const isTeen = p.age >= 13 && p.age < 25;
  const spec = JOBS[p.job];
  const working = !!p.workplaceId && p.age >= 16 && p.age < ctx.params.retirementAge + 10;
  const wealth = affluence(com);
  const hasCar = !!hh.vehicleId;

  // ── Health overrides ──
  if (p.health.hospitalDaysLeft > 0) {
    const ward = p.health.hospitalId ?? CL;
    if (p.health.admittedDay === world.day) {
      // Admitted this morning: the ambulance comes for them after first light.
      const t0 = jitter(rng, 420, 45);
      plan.push(act('sleep', 0, t0, H, 'unwell in bed', bed));
      const adm = act('hospital', t0, 1440, ward, ward === 'hospital' ? 'taken to the central hospital' : 'taken to the clinic ward', roomKind(ward, 'ward'));
      adm.ambulance = true;
      plan.push(adm);
      return plan;
    }
    plan.push(act('hospital', 0, 1440, ward, ward === 'hospital' ? 'in a ward at the central hospital' : 'in the clinic ward', roomKind(ward, 'ward')));
    return plan;
  }
  const sick = p.health.state === 'ill' || p.health.state === 'injured' || p.health.state === 'critical';
  if (p.health.restDaysLeft > 0 || (sick && p.health.illnesses.some((i) => i.severity > 0.35))) {
    plan.push(act('sleep', 0, 480, H, 'sleeping', bed));
    plan.push(act('rest', 480, 1440, H, 'resting at home (unwell)', rng.bernoulli(0.6) ? bed : living));
    // A clinic visit if not yet seen
    if (sick && world.day - p.health.lastClinicDay > 2 && (dc.weekday >= 1 && dc.weekday <= 5)) {
      const t = jitter(rng, 600, 60);
      plan.push(act('clinic', t, t + 75, CL, 'at the clinic', roomKind(CL, 'reception')));
    }
    return finalise(plan, H, bed);
  }

  // ── A day trip by air: the province's business travellers on weekdays, the estates' flyers on a Saturday ──
  const flight = flightFor(p, dc, rng, working, wealth);
  if (flight) {
    const [dep, ret] = flight;
    const dest = rng.pick(['Johannesburg', 'Cape Town', 'Durban', 'Gqeberha']);
    plan.push(act('sleep', 0, dep - 135, H, 'sleeping', bed));
    plan.push(act('breakfast', dep - 135, dep - 105, H, 'an early breakfast', kitchen));
    const fl = act('flight', dep - 105, ret + 25, AIRPORT_TERMINAL, dc.weekday === 6 ? `a day out in ${dest}, by air` : `flying to ${dest} for the day`, roomKind(AIRPORT_TERMINAL, 'hall'));
    fl.flight = { dep, ret };
    plan.push(fl);
    world.stats.airTrips++;
    // The ticket: the employer's on a working day, the household's on a Saturday out.
    recordAirTrip(world, p, dc.weekday >= 1 && dc.weekday <= 5 && working);
    return evening(ctx, plan, p, house, ret + 30, rng, dc);
  }

  // ── Sleep / wake ──
  const wakeBase = isBaby ? 420 : isKid ? (dc.schoolDay ? 375 : 480) : working ? 345 : 420;
  const wake = clamp(jitter(rng, wakeBase + (p.big5.C - 0.5) * -30, 15), 240, 660);
  plan.push(act('sleep', 0, wake, H, 'sleeping', bed));
  plan.push(act('breakfast', wake, wake + 35, H, 'breakfast', kitchen));
  let t = wake + 35;

  // ── Special gatherings today (funeral / wedding / celebration) ──
  // (A funeral or a wedding at a church is its pastor's to conduct.)
  const officiates = (g: Gathering) => g.kind !== 'celebration' && world.buildings[g.buildingId]?.kind === 'church' && world.roles.pastorByChurch[g.buildingId] === p.id;
  const gathering = dc.gatherings.find((g) => officiates(g) || g.forIds.includes(p.id) || attendsGathering(ctx, p, g.forIds, rng));

  // ── Sunday: church, or the park for those with no congregation ──
  if (dc.isSunday) {
    // The household's decision carries almost everyone; a devout member of a
    // household that stayed home may still walk over on their own.
    const withFamily = dc.churchgoing.has(p.householdId);
    const personal = withFamily ? 0.985 * (p.age < 1 ? 0.9 : 1) * (sick ? 0.7 : 1) : 0.3 * p.faith;
    const leads = !!CH && ctx.world.roles.pastorByChurch[CH] === p.id;
    const attends = !!CH && (leads || rng.bernoulli(clamp(personal, 0, 0.995)));
    if (attends && CH) {
      const arrive = jitter(rng, leads ? 480 : 530, 8);
      plan.push(act('idle', t, arrive - 15, H, 'getting ready', living));
      const service = act('church', arrive - 15, 660, CH, leads ? 'leading the service' : 'at the Sunday service', chNave);
      if (leads) service.role = 'lead';
      plan.push(service);
      plan.push(act('fellowship', 660, jitter(rng, 712, 8), CH, 'fellowship after the service', rng.weighted([[chHall, 0.45], [chYard, 0.3], [chNave, 0.25]])));
      t = 710;
      plan.push(act('lunch', t + 10, t + 60, H, 'Sunday lunch', kitchen));
      t += 60;
    } else if (!CH && !isBaby && !sick && rng.bernoulli(0.3 + 0.2 * wealth)) {
      // Newhaven's Sunday morning: Grand Park, the sports centre or the mall, then lunch out.
      const out = rng.weighted<[string, Room['kind'], string]>([[['grandpark', 'pitch', 'a Sunday morning in Grand Park'], 0.5], [['un-sports', 'pitch', 'Sunday sport at the sports centre'], isKid || isTeen ? 0.3 : 0.15], [['mall', 'hall', 'brunch at the mall'], 0.35]]);
      const leave = jitter(rng, 570, 20);
      plan.push(act('idle', t, leave, H, 'a slow Sunday morning', living));
      plan.push(act(out[0] === 'mall' ? 'shop' : isKid ? 'play' : 'rest', leave, leave + 170, out[0], out[2], roomKind(out[0], out[1])));
      t = leave + 180;
      plan.push(act('lunch', t, t + 45, H, 'Sunday lunch', kitchen));
      t += 45;
    } else {
      plan.push(act('rest', t, 720, H, 'a quiet Sunday at home', living));
      plan.push(act('lunch', 720, 770, H, 'lunch', kitchen));
      t = 770;
    }
    // Sunday afternoon: visits, rest, park — and, from every city, Grand Park
    if (!isBaby && rng.bernoulli(0.12 + 0.1 * wealth) && (hasCar || rng.bernoulli(0.5))) {
      plan.push(act(isKid ? 'play' : 'rest', t + 20, t + 170, 'grandpark', 'an afternoon in Grand Park', roomByKind(world.buildings.grandpark, isKid ? 'yard' : 'pitch')?.id));
      t += 180;
    } else if (!isBaby && rng.bernoulli(0.45)) {
      const v = visitTarget(ctx, p, rng);
      if (v) plan.push(act('visit', t + 20, t + 140, v.houseId, `visiting ${world.people[v.withId].firstName}`, undefined, [v.withId]));
      else plan.push(act('rest', t, t + 140, H, 'resting', living));
      t += 150;
    } else if (isKid && dc.outdoor) {
      plan.push(act('play', t + 15, t + 150, rng.bernoulli(0.5) ? PK : H, 'playing', rng.bernoulli(0.5) ? pkPitch : yard));
      t += 150;
    } else {
      plan.push(act('rest', t, t + 140, H, 'resting', rng.bernoulli(0.5) ? living : yard));
      t += 150;
    }
    if (CH && (leads || (rng.bernoulli(0.25 * p.faith) && !isBaby))) {
      // The pastor is there a quarter of an hour before the congregation, as in the morning.
      const evening = act('church', leads ? 1065 : 1080, 1150, CH, leads ? 'leading the evening service' : 'evening service', chNave);
      if (leads) evening.role = 'lead';
      plan.push(evening);
    }
    return evening(ctx, plan, p, house, t, rng, dc);
  }

  // ── Gathering days (funeral / wedding) take the middle of the day ──
  if (gathering) {
    const venue = world.buildings[gathering.buildingId] ?? house;
    const venueRoom = gathering.kind === 'celebration' ? roomByKind(venue, 'hall')?.id : (roomByKind(venue, 'nave') ?? roomByKind(venue, 'hall') ?? roomByKind(venue, 'courtroom'))?.id;
    const leads = officiates(gathering);
    const arrive = gathering.start - (leads ? 35 : 20);
    plan.push(act('idle', t, arrive, H, 'preparing', living));
    const service = act(gathering.kind === 'funeral' ? 'funeral' : gathering.kind === 'wedding' ? 'wedding' : 'celebration', arrive, gathering.end, gathering.buildingId, leads ? `conducting the ${gathering.label}` : gathering.label, venueRoom);
    if (leads) service.role = 'lead';
    plan.push(service);
    // The graveside and the reception are in the deceased's / the couple's own city.
    const gCom = venue.community;
    const CEM = landmark(gCom, 'cemetery');
    const HALL = landmark(gCom, 'hall');
    if (gathering.kind === 'funeral') plan.push(act('funeral', gathering.end, gathering.end + 30, CEM, 'at the graveside', roomKind(CEM, 'graves')));
    if (gathering.kind === 'wedding') plan.push(act('celebration', gathering.end + 10, gathering.end + 190, HALL, 'wedding reception', roomKind(HALL, 'hall')));
    t = gathering.end + (gathering.kind === 'wedding' ? 200 : 45);
    return evening(ctx, plan, p, house, t, rng, dc);
  }

  // ── Work / school on weekdays ──
  const weekday = dc.weekday >= 1 && dc.weekday <= 5;
  if (isKid && p.schooling === 'school' && dc.schoolDay) {
    const start = jitter(rng, 440, 6);
    const SCH = landmark(com, 'school');
    const classes = world.buildings[SCH].rooms.filter((r) => r.kind === 'classroom');
    plan.push(act('idle', t, start - 10, H, 'getting ready for school', living));
    plan.push(act('school', start - 10, p.age < 13 ? 830 : 870, SCH, 'at school', (p.age < 13 ? classes[0] : classes[1] ?? classes[0])?.id));
    t = (p.age < 13 ? 830 : 870) + 15;
    plan.push(act('lunch', t, t + 30, H, 'lunch at home', kitchen));
    t += 30;
  } else if (isKid && p.schooling === 'homeschool' && dc.schoolDay) {
    plan.push(act('chores', t, 540, H, 'morning chores', yard));
    plan.push(act('homeschool', 540, 750, H, 'homeschool lessons', living));
    plan.push(act('lunch', 750, 790, H, 'lunch', kitchen));
    t = 790;
  } else if (working && !dc.holiday && (weekday || worksSaturday(p.job) && dc.weekday === 6)) {
    const wp = world.buildings[p.workplaceId!];
    const [ws, we] = workHours(ctx, p, rng, dc);
    if (ws > t) plan.push(act('idle', t, ws - 12, H, 'getting ready for work', living));
    const roomId = workRoom(p, wp)?.id;
    plan.push(act('work', ws - 12, we, wp.id, workLabel(p), roomId));
    // A driver-partner eats in the car between fares.
    if (p.job !== 'ehailer' && (p.job !== 'police' || we < 1200)) {
      plan.push(act('lunch', 750, 790, wp.id, 'lunch break', roomId));
    }
    t = we + 10;
  } else if (p.job === 'pastor' && !dc.holiday && (p.workplaceId ?? CH)) {
    const ownChurch = (p.workplaceId ?? CH)!;
    plan.push(act('work', 540, 780, ownChurch, 'sermon preparation', roomKind(ownChurch, 'hall')));
    const v = visitTarget(ctx, p, rng);
    if (v) plan.push(act('visit', 840, 930, v.houseId, `pastoral visit to ${world.people[v.withId].firstName}`, undefined, [v.withId]));
    t = 940;
  } else if (isBaby) {
    plan.push(act('play', t, 720, H, 'playing at home', rng.bernoulli(0.5) ? living : yard));
    plan.push(act('lunch', 720, 750, H, 'lunch', kitchen));
    plan.push(act('sleep', 750, 840, H, 'afternoon nap', bed));
    t = 840;
  } else if (p.job === 'homemaker' || (p.job === 'unemployed' && rng.bernoulli(0.5)) || p.job === 'retired') {
    plan.push(act('chores', t, jitter(rng, 600, 30), H, 'housework', rng.bernoulli(0.5) ? kitchen : yard));
    t = plan[plan.length - 1].end;
    if (rng.bernoulli(0.55)) {
      plan.push(act('shop', t + 15, t + 60, SH, `shopping at ${world.buildings[SH]?.name ?? 'the shop'}`, shFloor));
      t += 70;
    }
    if (p.job === 'retired' && rng.bernoulli(0.4) && dc.outdoor) {
      plan.push(act('rest', t, t + 60, PK, 'a walk in the park', pkBench));
      t += 60;
    }
    plan.push(act('lunch', Math.max(t, 740), Math.max(t, 740) + 40, H, 'lunch', kitchen));
    t = Math.max(t, 740) + 40;
  } else if (p.job === 'unemployed') {
    // Job seeking / piece work, in the city's own places
    const FARM = landmark(com, 'farm');
    const TAXI = landmark(com, 'taxi');
    const WS = landmark(com, 'workshop');
    const tier = tierOf(com);
    const target = rng.weighted<[string, string | undefined, string]>(
      tier === 'low-income' || tier === 'working'
        ? [
            [[FARM, roomKind(FARM, 'field'), 'looking for piece work at the farm'], 0.3],
            [[SH, shFloor, 'waiting at the spaza for piece work'], 0.2],
            [[TAXI, roomKind(TAXI, 'garage'), 'washing taxis at the rank'], 0.2],
            [[PK, pkBench, 'at the grounds'], 0.3],
          ]
        : tier === 'ultra' || tier === 'affluent'
          ? [
              [[SH, shFloor, 'asking for work at the shop'], 0.3],
              [[PK, pkBench, `in ${world.buildings[PK]?.name ?? 'the park'}`], 0.45],
              [[FARM, roomKind(FARM, 'field'), 'looking for piece work at the farm'], 0.25],
            ]
          : [
              [[FARM, roomKind(FARM, 'field'), 'looking for piece work at the farm'], 0.35],
              [[SH, roomKind(SH, 'yard') ?? shFloor, 'waiting at the market for work'], 0.35],
              [[WS, roomKind(WS, 'workshop'), 'helping at the workshop'], 0.15],
              [[PK, pkBench, 'at the park'], 0.15],
            ],
    );
    plan.push(act('work', jitter(rng, 500, 30), 750, target[0], target[2], target[1]));
    plan.push(act('lunch', 750, 790, H, 'lunch', kitchen));
    t = 790;
  } else {
    // Weekend / holiday for everyone else: chores, then the local shop or, for
    // a growing share as the money allows, the mall in Unity Centre.
    plan.push(act('chores', t, 600, H, dc.holiday ? `${dc.holiday} at home` : 'Saturday chores', rng.bernoulli(0.5) ? yard : living));
    if (!isBaby && rng.bernoulli(0.08 + 0.32 * wealth) && (hasCar || rng.bernoulli(0.6))) {
      plan.push(act('shop', 600, 720, 'mall', 'shopping at Unity Mall', roomByKind(world.buildings.mall, 'shop')?.id));
    } else if (rng.bernoulli(0.5)) plan.push(act('shop', 600, 650, SH, 'Saturday shopping', shFloor));
    plan.push(act('lunch', 730, 770, H, 'lunch', kitchen));
    t = 770;
  }

  // ── Afternoon ──
  if (isKid && dc.outdoor && rng.bernoulli(0.6)) {
    const park = rng.bernoulli(0.5);
    plan.push(act(dc.weekday === 6 ? 'sport' : 'play', t + 10, t + 120, park ? PK : H, park ? 'sport at the park' : 'playing in the yard', park ? pkPitch : yard));
    t += 130;
  } else if (!isBaby && rng.bernoulli(0.25)) {
    const v = visitTarget(ctx, p, rng);
    if (v) {
      plan.push(act('visit', t + 10, t + 90, v.houseId, `visiting ${world.people[v.withId].firstName}`, undefined, [v.withId]));
      t += 100;
    }
  }
  if (!isBaby && p.age >= 16 && rng.bernoulli(0.3)) {
    plan.push(act('shop', Math.max(t, 1020), Math.max(t, 1020) + 35, SH, 'picking up groceries', shFloor));
    t = Math.max(t, 1020) + 40;
  }
  // The city council sits on the first Tuesday of the month, after hours.
  const councilId = COUNCIL_IDS[city];
  if (councilId && dc.weekday === 2 && ctx.cal.day <= 7 && world.council.some((seat) => seat.personId === p.id)) {
    plan.push(act('council', 1050, 1150, councilId, 'council session', roomKind(councilId, 'courtroom')));
  }
  // Wednesday Bible study, Friday youth, Thursday choir — where there is a congregation
  if (CH) {
    if (dc.weekday === 3 && p.age >= 14 && rng.bernoulli(p.faith * 0.6)) plan.push(act('biblestudy', 1110, 1180, CH, 'midweek Bible study', chHall));
    if (dc.weekday === 5 && isTeen && rng.bernoulli(p.faith * 0.7)) plan.push(act('youth', 1080, 1200, CH, 'youth fellowship', chHall));
    if (dc.weekday === 4 && p.age >= 12 && rng.bernoulli(p.faith * 0.25 * (0.5 + p.big5.E))) plan.push(act('choir', 1110, 1170, CH, 'choir practice', chNave));
  } else if (dc.weekday === 3 && p.age >= 12 && rng.bernoulli(0.12 + 0.1 * p.big5.O)) {
    // Newhaven's midweek evening is the library's.
    const LIB = landmark(com, 'library');
    plan.push(act('rest', 1110, 1180, LIB, 'an evening at the library', roomKind(LIB, 'library')));
  }
  // ── Unity Park: the Saturday match and the concert draw from every city ──
  if (dc.weekday === 6 && !isBaby && p.age >= 8 && !plan.some((a) => a.kind === 'work' && a.end > 900) && rng.bernoulli(clamp(0.1 * (0.5 + p.big5.E) * (hasCar ? 1.3 : 0.8) * (isTeen || (p.sex === 'M' && p.age < 55) ? 1.4 : 0.8), 0, 0.5))) {
    plan.push(act('match', 880, 1030, 'stadium', 'at the match at Unity Stadium', roomByKind(world.buildings.stadium, 'stand')?.id));
  }
  if (dc.weekday === 5 && (ctx.cal.day <= 7 || (ctx.cal.day > 14 && ctx.cal.day <= 21)) && p.age >= 14 && rng.bernoulli(clamp(0.04 + 0.1 * wealth * (0.5 + p.big5.O), 0, 0.3))) {
    plan.push(act('concert', 1140, 1290, 'concert', 'at a concert at Unity Concert Hall', roomByKind(world.buildings.concert, 'auditorium')?.id));
  }
  return evening(ctx, plan, p, house, t, rng, dc);
}

function evening(ctx: Ctx, plan: Activity[], p: Person, house: Building, t: number, rng: Rng, dc: DayContext): Activity[] {
  const H = house.id;
  const living = homeRoom(house, 'living');
  const kitchen = homeRoom(house, 'kitchen');
  const yard = homeRoom(house, 'yard');
  const bed = bedroomFor(house, p, ctx);
  let dinner = clamp(jitter(rng, 1110, 15), 1020, 1200);
  // To the evening service first (the pastor to lead it from the start): at home until then, dinner once back.
  const service = plan.find((a) => a.kind === 'church' && a.start >= t);
  if (service) dinner = Math.max(dinner, service.end + 20);
  const until = service ? Math.min(dinner, service.start) : dinner;
  if (t < until) plan.push(act('rest', t, until, H, p.age < 5 ? 'playing at home' : dc.outdoor && rng.bernoulli(0.3) ? 'sitting in the yard' : 'at home', dc.outdoor && rng.bernoulli(0.3) ? yard : living));
  plan.push(act('dinner', dinner, dinner + 45, H, 'dinner', kitchen));
  const bedtime = p.age < 5 ? 1170 : p.age < 13 ? 1230 : p.age < 18 ? 1290 : clamp(jitter(rng, 1330, 20), 1260, 1420);
  plan.push(act('rest', dinner + 45, bedtime, H, p.age < 13 ? 'family time' : 'evening at home', living));
  plan.push(act('sleep', bedtime, 1440, H, 'sleeping', bed));
  return finalise(plan, H, bed);
}

/** Sort, de-overlap and fill gaps with idle-at-home. */
function finalise(plan: Activity[], H: string, bed?: string): Activity[] {
  plan.sort((a, b) => a.start - b.start);
  const out: Activity[] = [];
  let cursor = 0;
  for (const a of plan) {
    if (a.end <= cursor) continue;
    const start = Math.max(a.start, cursor);
    if (start > cursor) out.push({ kind: 'idle', start: cursor, end: start, buildingId: H, label: 'at home', roomId: undefined });
    out.push({ ...a, start });
    cursor = a.end;
  }
  if (cursor < 1440) out.push({ kind: 'sleep', start: cursor, end: 1440, buildingId: H, label: 'sleeping', roomId: bed });
  return out;
}

function attendsGathering(ctx: Ctx, p: Person, forIds: string[], rng: Rng): boolean {
  if (p.age < 3) return rng.bernoulli(0.5);
  for (const id of forIds) {
    const r = p.relationships[id];
    if (r) return true;
  }
  return rng.bernoulli(0.55 * p.faith + 0.2);
}

function worksSaturday(job: Person['job']): boolean {
  return job === 'shopkeeper' || job === 'vendor' || job === 'farmer' || job === 'farmhand' || job === 'nurse' || job === 'police' || job === 'taxidriver' || job === 'surgeon' || job === 'pilot' || job === 'busdriver' || job === 'ehailer';
}

/** Annual-ish odds, per working day, that a job flies somewhere for the day. */
const FLYER_ODDS: Partial<Record<JobId, number>> = { executive: 0.2, centralbanker: 0.1, surgeon: 0.03, dmo: 0.03, attorney: 0.06, accountant: 0.06, engineer: 0.06, magistrate: 0.015, civilservant: 0.01 };

/** Wheels-up out and back-on-the-ground home for a day trip by air, or null for everyone staying on the ground today. */
function flightFor(p: Person, dc: DayContext, rng: Rng, working: boolean, wealth: number): [number, number] | null {
  if (p.age < 18 || (p.health.state !== 'healthy' && p.health.state !== 'recovering')) return null;
  let odds = 0;
  if (dc.weekday >= 1 && dc.weekday <= 5 && !dc.holiday && working) odds = (FLYER_ODDS[p.job] ?? 0) + (p.job === 'office' && wealth >= 0.85 ? 0.025 : 0);
  else if (dc.weekday === 6 && wealth >= 0.85) odds = 0.04 * wealth;
  if (odds <= 0 || !rng.bernoulli(odds)) return null;
  const out = FLIGHTS[rng.pick(OUTBOUND)];
  const back = FLIGHTS[rng.pick(HOMEBOUND)];
  return [out.dep, back.arr];
}

function workHours(ctx: Ctx, p: Person, rng: Rng, dc: DayContext): [number, number] {
  switch (p.job) {
    case 'police': {
      // Two officers alternate day (06-18) and night (18-06) shifts weekly.
      const idx = ctx.world.roles.policeIds.indexOf(p.id);
      const week = Math.floor(ctx.world.day / 7);
      const night = (idx + week) % 2 === 1;
      return night ? [1080, 1440] : [360, 1080];
    }
    case 'farmer':
    case 'farmhand':
      return [jitter(rng, 380, 10), jitter(rng, 1020, 20)];
    case 'shopkeeper':
    case 'vendor':
      return [jitter(rng, 470, 10), jitter(rng, 1080, 15)];
    case 'doctor':
    case 'nurse':
      return [jitter(rng, 470, 8), jitter(rng, 1020, 15)];
    case 'engineer':
      return [jitter(rng, 465, 10), jitter(rng, 1035, 20)];
    case 'teacher':
      return [jitter(rng, 420, 6), dc.schoolDay ? 900 : 840];
    case 'magistrate':
    case 'clerk':
      return [jitter(rng, 500, 8), jitter(rng, 960, 15)];
    case 'taxidriver':
      // First loads before dawn, last loads after dark.
      return [jitter(rng, 330, 15), jitter(rng, 1140, 25)];
    case 'domestic':
      return [jitter(rng, 465, 15), jitter(rng, 790, 20)];
    case 'dmo':
      return [jitter(rng, 470, 8), jitter(rng, 1000, 15)];
    case 'combanker':
    case 'centralbanker':
      return [jitter(rng, 500, 8), jitter(rng, 990, 10)];
    case 'surgeon':
      return [jitter(rng, 420, 10), jitter(rng, 1050, 30)];
    case 'executive':
      return [jitter(rng, 450, 15), jitter(rng, 1080, 30)];
    case 'civilservant':
      return [jitter(rng, 470, 8), jitter(rng, 960, 10)];
    case 'librarian':
      return [jitter(rng, 540, 8), jitter(rng, 1080, 10)];
    case 'pilot':
      // On the airfield before the first boarding call, home after the last landing.
      return [335, 1215];
    case 'busdriver': {
      // Two shifts cover the service: early (05:20–15:00) and late (13:00–21:40).
      const late = p.id.charCodeAt(p.id.length - 1) % 2 === 1;
      return late ? [780, 1300] : [320, 900];
    }
    case 'ehailer': {
      // Driver-partners chase the peaks: an early shift for the first flights and the morning run, or a late one into the night.
      const late = p.id.charCodeAt(p.id.length - 1) % 2 === 1;
      return late ? [jitter(rng, 720, 20), jitter(rng, 1350, 20)] : [jitter(rng, 350, 15), jitter(rng, 1050, 20)];
    }
    default:
      return [jitter(rng, 480, 10), jitter(rng, 1020, 20)];
  }
}

function workLabel(p: Person): string {
  switch (p.job) {
    case 'doctor':
      return 'seeing patients';
    case 'nurse':
      return 'on duty at the clinic';
    case 'teacher':
      return 'teaching';
    case 'police':
      return 'on duty';
    case 'magistrate':
      return 'hearing cases';
    case 'clerk':
      return 'at the court registry';
    case 'shopkeeper':
      return 'minding the shop';
    case 'vendor':
      return 'selling at the market';
    case 'farmer':
      return 'working the farm';
    case 'farmhand':
      return 'working in the fields';
    case 'builder':
      return 'at the workshop';
    case 'office':
      return 'at the office';
    case 'banker':
      return 'at the bank counter';
    case 'combanker':
      return 'at the commercial bank';
    case 'attorney':
      return 'in chambers';
    case 'accountant':
      return 'at the practice';
    case 'dmo':
      return 'seeing patients at the medical centre';
    case 'taxidriver':
      return 'driving the taxi route';
    case 'domestic':
      return 'keeping house';
    case 'surgeon':
      return 'in theatre at the central hospital';
    case 'executive':
      return 'in the boardroom';
    case 'engineer':
      return 'on a project';
    case 'civilservant':
      return 'at the department';
    case 'centralbanker':
      return 'at the Reserve Bank';
    case 'librarian':
      return 'at the library desk';
    case 'pilot':
      return 'flying the provincial service';
    case 'busdriver':
      return 'driving the bus route';
    case 'ehailer':
      return 'online on the Hamba app';
    default:
      return 'working';
  }
}

export function workRoom(p: Person, wp: Building): Room | null {
  switch (p.job) {
    case 'doctor':
      return roomByKind(wp, 'consult');
    case 'nurse':
      return wp.rooms.find((r) => r.kind === 'ward') ?? roomByKind(wp, 'reception');
    case 'teacher':
      return wp.rooms.find((r) => r.kind === 'classroom') ?? null;
    case 'police':
      return roomByKind(wp, 'reception');
    case 'magistrate':
      return roomByKind(wp, 'courtroom');
    case 'clerk':
      return roomByKind(wp, 'office');
    case 'shopkeeper':
    case 'vendor':
      return roomByKind(wp, 'shop');
    case 'farmer':
      return roomByKind(wp, 'workshop') ?? roomByKind(wp, 'field');
    case 'farmhand':
      return roomByKind(wp, 'field');
    case 'builder':
      return roomByKind(wp, 'workshop');
    case 'office':
      return roomByKind(wp, 'office');
    case 'banker':
      return roomByKind(wp, 'reception');
    case 'pastor':
      return roomByKind(wp, 'hall');
    case 'dmo':
      return roomByKind(wp, 'consult') ?? roomByKind(wp, 'office');
    case 'combanker':
      return roomByKind(wp, 'reception') ?? roomByKind(wp, 'office');
    case 'attorney':
    case 'accountant':
      return roomByKind(wp, 'office');
    case 'taxidriver':
      return roomByKind(wp, 'garage') ?? roomByKind(wp, 'office');
    case 'domestic':
      return roomByKind(wp, 'kitchen') ?? roomByKind(wp, 'yard');
    case 'surgeon':
      return roomByKind(wp, 'theatre') ?? roomByKind(wp, 'consult');
    case 'executive':
    case 'engineer':
    case 'civilservant':
    case 'centralbanker':
      return roomByKind(wp, 'office') ?? wp.rooms[0] ?? null;
    case 'librarian':
      return roomByKind(wp, 'library');
    case 'pilot':
      return roomByKind(wp, 'office');
    case 'busdriver':
      return roomByKind(wp, 'garage') ?? roomByKind(wp, 'stop');
    case 'ehailer':
      return roomByKind(wp, 'yard') ?? wp.rooms[0] ?? null;
    default:
      return wp.rooms[0] ?? null;
  }
}

export function activityAt(plan: Activity[], minuteOfDay: number): Activity | null {
  for (const a of plan) if (minuteOfDay >= a.start && minuteOfDay < a.end) return a;
  return plan[plan.length - 1] ?? null;
}

/** Build the plans for everyone at the start of the day. */
export function buildAllPlans(ctx: Ctx): void {
  const dc = dayContext(ctx);
  ctx.world.holiday = dc.holiday;
  for (const p of alivePeople(ctx.world)) {
    p.plan = buildDailyPlan(ctx, p, dc);
    p.planIdx = -1;
  }
}

// ─── Childcare: no child under ten is left without someone of fourteen or more ───
//
// Plans are made person by person, so a toddler's day at home could otherwise
// run on while both parents were at work. After every plan is built (and the
// court has had its say) this pass walks each household with young children
// and closes every such gap. A child does not go out unless one of the
// household is going to the same place; and every minute the child spends at
// home has someone of supervising age in the house — a guardian who is out
// but not at work takes the child along, else someone free at home nearby
// comes to mind them (the domestic worker already covers the estates), else,
// as a last resort, the child goes along to a parent's work.

export const CARE_AGE = 10;
export const SUPERVISOR_AGE = 14;
/** A guardian doing one of these cannot take a small child along. */
const NO_TAG_ALONG = new Set<ActivityKind>(['work', 'school', 'homeschool', 'hospital', 'clinic', 'court', 'council', 'patrol', 'flight', 'travel', 'away']);
/** Anyone with one of these in the span is spoken for and cannot come and mind a child; a trip to the shop or a rest in the park can be given up. */
const COMMITTED = new Set<ActivityKind>([...NO_TAG_ALONG, 'church', 'funeral', 'wedding', 'celebration', 'match', 'concert', 'biblestudy', 'youth', 'choir']);
/** How far ahead of a gap a minder may have to set out, and how long after it they stay. */
const MINDER_LEAD_MAX = 45;
const MINDER_STAY = 25;

interface Span {
  s: number;
  e: number;
  /** For a child's time at home: when their plan says they are home (before the walk), so a minder's plan never starts after the child's. */
  raw?: number;
}

/** Cut an activity into a plan: whatever it overlaps is trimmed or split around it. */
export function overlay(plan: Activity[], a: Activity): void {
  if (a.end <= a.start) return;
  const out: Activity[] = [];
  for (const x of plan) {
    if (x.end <= a.start || x.start >= a.end) {
      out.push(x);
      continue;
    }
    if (x.start < a.start) out.push({ ...x, end: a.start });
    if (x.end > a.end) out.push({ ...x, start: a.end });
  }
  out.push(a);
  out.sort((m, n) => m.start - n.start);
  plan.length = 0;
  plan.push(...out);
}

function subtract(span: Span, cover: Span[]): Span[] {
  let gaps: Span[] = [span];
  for (const c of cover) {
    const next: Span[] = [];
    for (const g of gaps) {
      if (c.e <= g.s || c.s >= g.e) {
        next.push(g);
        continue;
      }
      if (c.s > g.s) next.push({ s: g.s, e: c.s, raw: g.raw });
      if (c.e < g.e) next.push({ s: c.e, e: g.e, raw: c.e });
    }
    gaps = next;
    if (!gaps.length) break;
  }
  return gaps;
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.slice().sort((a, b) => a.s - b.s);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.s <= last.e + 1) {
      last.e = Math.max(last.e, s.e);
      last.raw = Math.min(last.raw ?? last.s, s.raw ?? s.s);
    } else out.push({ ...s });
  }
  return out;
}

type Note = (buildingId: string, s: number, e: number, id: string) => void;

/** Someone who could be asked to mind a child today, with what the search needs to know about them. */
interface Candidate {
  q: Person;
  house: Building;
  city: ReturnType<typeof cityOf>;
  ownSmall: boolean;
}

/** Minutes after an activity's start before someone coming from elsewhere is actually there (a walk; zero when they were there already). */
function arrivalLag(ctx: Ctx, prev: Activity | null, a: Activity): number {
  if (!prev || prev.buildingId === a.buildingId) return 0;
  const from = ctx.world.buildings[prev.buildingId];
  const to = ctx.world.buildings[a.buildingId];
  return from && to ? Math.min(45, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 50) + 4) : 0;
}

/**
 * Runs in rounds: each round reads where everyone is from the plans as they
 * now stand and closes every gap it finds, and a following round catches
 * whatever the fixes themselves disturbed (a neighbour called away from a
 * visit, say). Nothing is taken away, only added, so it settles quickly.
 */
export function childcarePass(ctx: Ctx, from = 0, onlyHouse: string | null = null): void {
  for (let round = 0; round < 8; round++) if (!careRound(ctx, from, onlyHouse)) break;
}

/**
 * Mid-day, when a grown-up is suddenly called away (an ambulance, a call-out) from a house where small
 * children are or are due: the rest of the day's minding is arranged again from now (a neighbour comes
 * round, a parent is fetched home) — the morning's plan had counted on them.
 */
export function coverChildrenNow(ctx: Ctx, leftBuildingId: string, now: number): void {
  const world = ctx.world;
  const b = world.buildings[leftBuildingId];
  if (!b || b.kind !== 'house') return;
  const kidsThere = alivePeople(world).some((k) => k.age < CARE_AGE && !k.away && (k.loc.buildingId === b.id || k.plan.some((a) => a.buildingId === b.id && a.end > now)));
  // (Only the household that lives there: every other house's day is as it was.)
  if (kidsThere) childcarePass(ctx, now, b.id);
}

function careRound(ctx: Ctx, from = 0, onlyHouse: string | null = null): boolean {
  const world = ctx.world;
  const people = alivePeople(world).filter((p) => !p.away);
  const canMind = (q: Person) => q.age >= SUPERVISOR_AGE && q.health.hospitalDaysLeft === 0;
  let changed = false;
  const kidsByHh = new Map<string, Person[]>();
  for (const p of people) {
    if (p.age >= CARE_AGE) continue;
    if (onlyHouse && world.households[p.householdId]?.houseId !== onlyHouse) continue;
    const arr = kidsByHh.get(p.householdId) ?? [];
    arr.push(p);
    kidsByHh.set(p.householdId, arr);
  }
  if (!kidsByHh.size) return false;
  // Where everyone old enough to mind a child is through the day, at the houses
  // with young children (the only places it matters). Someone's plan says where
  // they are due, not where they are: coming from elsewhere they arrive a walk
  // later, so their presence is counted from then.
  const careHouses = new Set<string>();
  for (const hhId of kidsByHh.keys()) {
    const hh = world.households[hhId];
    if (hh && !hh.dissolvedDay) careHouses.add(hh.houseId);
  }
  const presence = new Map<string, Array<Span & { id: string }>>();
  const note: Note = (bid, s, e, id) => {
    let arr = presence.get(bid);
    if (!arr) presence.set(bid, (arr = []));
    arr.push({ s, e, id });
  };
  for (const q of people) {
    if (!canMind(q)) continue;
    let prev: Activity | null = null;
    let arrive = 0; // when they are actually in the building their plan has them at
    for (const a of q.plan) {
      if (!prev || prev.buildingId !== a.buildingId) arrive = a.start + arrivalLag(ctx, prev, a);
      if (careHouses.has(a.buildingId)) note(a.buildingId, Math.min(a.end, Math.max(a.start, arrive)), a.end, q.id);
      prev = a;
    }
  }
  // Who could be asked to mind a child today: sixteen or more, well, not a police officer (they may be called away).
  const pool: Candidate[] = [];
  for (const q of people) {
    if (q.age < 16 || q.job === 'police' || q.health.hospitalDaysLeft > 0 || q.health.restDaysLeft > 0) continue;
    if (q.health.state === 'ill' || q.health.state === 'injured' || q.health.state === 'critical') continue;
    const qh = world.households[q.householdId];
    const house = qh && !qh.dissolvedDay ? world.buildings[qh.houseId] : null;
    if (!house) continue;
    pool.push({ q, house, city: cityOf(house.community), ownSmall: kidsByHh.has(q.householdId) });
  }
  for (const [hhId, kids] of kidsByHh) {
    const hh = world.households[hhId];
    const house = hh && !hh.dissolvedDay ? world.buildings[hh.houseId] : null;
    if (!hh || !house) continue;
    const family = householdMembers(world, hh.id).filter((q) => !q.away && canMind(q));
    for (const kid of kids) {
      // Parents first, then the eldest.
      const guardians = family.slice().sort((a, b) => Number(kid.parentIds.includes(b.id)) - Number(kid.parentIds.includes(a.id)) || b.age - a.age);
      const atHome = (s: number, e: number, sleeping: boolean) => act(sleeping ? 'sleep' : kid.age < 5 ? 'play' : 'rest', s, e, house.id, 'at home', homeRoom(house, sleeping ? 'bedroom' : 'living'));
      // 1. No outing without one of the household (school and lessons aside): an
      //    activity elsewhere that no member shares becomes time at home instead,
      //    and one they do share is cut to the minutes a member is actually there.
      for (const a of kid.plan.slice()) {
        if (a.buildingId === house.id || a.kind === 'school' || a.kind === 'homeschool' || a.end <= from) continue;
        const there: Span[] = [];
        for (const q of family) for (const b of q.plan) if (b.buildingId === a.buildingId && b.end > a.start && b.start < a.end) there.push({ s: b.start, e: b.end });
        for (const g of subtract({ s: Math.max(a.start, from), e: a.end }, there)) {
          overlay(kid.plan, atHome(g.s, g.e, a.kind === 'sleep'));
          changed = true;
        }
      }
      // 2. Every minute at home has someone in the house (the child, too, is
      //    only home a walk after coming from elsewhere). Each fix changes the
      //    plans, so the gaps are found again after every one.
      const givenUp = new Set<number>();
      for (let guard = 0; guard < 24; guard++) {
        const others = (presence.get(house.id) ?? []).filter((x) => x.id !== kid.id);
        const home: Span[] = [];
        let prev: Activity | null = null;
        let arrive = 0;
        for (const a of kid.plan) {
          if (!prev || prev.buildingId !== a.buildingId) arrive = a.start + arrivalLag(ctx, prev, a);
          // (mid-day, only what is still to come)
          if (a.buildingId === house.id && a.end > from) home.push({ s: Math.max(from, Math.min(a.end, Math.max(a.start, arrive))), e: a.end, raw: Math.max(from, a.start) });
          prev = a;
        }
        const gaps = mergeSpans(home.flatMap((h) => subtract(h, others))).filter((g) => g.e > g.s && !givenUp.has(g.s));
        const g = gaps[0];
        if (!g) break;
        if (coverGap(ctx, hh, house, kid, g, guardians, presence.get(house.id) ?? [], note, pool, from > 0)) changed = true;
        else givenUp.add(g.s);
      }
    }
  }
  return changed;
}

/** Close one gap in a child's supervision at home; false when nothing could be done about it. */
function coverGap(ctx: Ctx, hh: Household, house: Building, kid: Person, g: Span, guardians: Person[], atHouse: Array<Span & { id: string }>, note: Note, pool: Candidate[], midDay = false): boolean {
  const world = ctx.world;
  const during = (q: Person) => q.plan.filter((a) => a.end > g.s && a.start < g.e);
  // A hand-over hole (one leaves before the next is in the door): whoever is
  // leaving stays until the other has arrived — a few minutes, or up to half an
  // hour when it is a matter of someone still on their way.
  const arriving = atHouse.some((x) => x.id !== kid.id && x.s >= g.e - 1 && x.s <= g.e + 1);
  // (Not mid-day: whoever just left was called away and cannot stay.)
  if (!midDay && (g.e - g.s <= 8 || (arriving && g.e - g.s <= 30))) {
    const leaving = atHouse.find((x) => x.id !== kid.id && x.e >= g.s - 1 && x.e <= g.s);
    const q = leaving ? world.people[leaving.id] : null;
    const a = q?.plan.find((x) => x.buildingId === house.id && x.end === leaving!.e);
    // (unless they are due to mind a child elsewhere next: that child is not to be robbed)
    const next = q && a ? q.plan.find((x) => x.start >= a.end && x.start < g.e + 1) : null;
    if (q && a && next?.role !== 'minder') {
      const oldEnd = a.end;
      const newEnd = Math.min(1440, g.e + 1);
      overlay(q.plan, { ...a, end: newEnd });
      note(house.id, a.start, newEnd, q.id);
      // a child of theirs who was along here with them stays the extra minutes too
      for (const own of householdMembers(world, q.householdId)) {
        if (own.age >= CARE_AGE) continue;
        const along = own.plan.find((x) => x.buildingId === house.id && x.end === oldEnd && x.label.startsWith(`with ${q.firstName}`));
        if (along) overlay(own.plan, { ...along, end: newEnd });
      }
      return true;
    }
  }
  // Someone is on their way home and the child is there before them: they set
  // out that much earlier (the school-run parent leaves work in time).
  if (arriving && g.e - g.s <= 60) {
    const due = atHouse.find((x) => x.id !== kid.id && x.s >= g.e - 1 && x.s <= g.e + 1)!;
    const q = world.people[due.id];
    const a = q?.plan.find((x) => x.buildingId === house.id && x.start <= due.s && x.end === due.e);
    const before = q && a ? q.plan.find((x) => x.end === a.start) : null;
    // (not off a minding elsewhere: that child is not to be robbed)
    if (q && a && a.start > 0 && before?.role !== 'minder') {
      const lag = due.s - a.start;
      const start = Math.max(0, Math.min(g.s - lag, g.raw ?? g.s));
      overlay(q.plan, { ...a, start });
      note(house.id, g.s, due.e, q.id);
      // a child of the household who was along on what they are leaving early comes home with them
      if (before) {
        for (const own of householdMembers(world, q.householdId)) {
          if (own.age >= CARE_AGE) continue;
          const along = own.plan.find((x) => x.buildingId === before.buildingId && x.end > start && x.start < a.start && x.label.startsWith(`with ${q.firstName}`));
          if (along) overlay(own.plan, act(own.age < 5 ? 'play' : 'rest', start, along.end, house.id, 'at home', homeRoom(house, 'living')));
        }
      }
      return true;
    }
  }
  // (a) a guardian who is out (somewhere other than this house) but not at work takes the child along
  const free = guardians.find((q) => {
    const acts = during(q);
    return acts.length > 0 && acts.some((a) => a.buildingId !== house.id) && acts.every((a) => !NO_TAG_ALONG.has(a.kind));
  });
  if (free && tagAlong(kid, free, g, house.id)) return true;
  // (b) someone free at home nearby comes to mind them, setting out in time to be there first and staying until the household is back
  const carer = findCarer(hh, house, g, pool, midDay);
  if (carer) {
    const from = world.buildings[world.households[carer.householdId]?.houseId ?? ''];
    // time to walk over at an elderly pace (the road is a third longer than the crow flies), and to wait for a bus or taxi if it is far enough for one
    const d = from ? 1.3 * Math.hypot(from.x - house.x, from.y - house.y) : 400;
    const walk = Math.min(MINDER_LEAD_MAX, Math.ceil(d / 45) + 5 + (d >= 700 ? 15 : 0));
    const s = Math.max(0, Math.min(g.s, g.raw ?? g.s) - walk);
    const e = Math.min(1440, g.e + MINDER_STAY);
    const night = g.s >= 1230 || g.e <= 420;
    const minding = act(night ? 'sleep' : 'visit', s, e, house.id, `minding ${kid.firstName}${night ? ' overnight' : ''}`, homeRoom(house, night ? 'bedroom' : 'living'));
    minding.role = 'minder';
    overlay(carer.plan, minding);
    note(house.id, s, e, carer.id);
    // the minder's own small children come along
    if (from) for (const own of householdMembers(world, carer.householdId)) if (own.age < CARE_AGE && !own.away) tagAlong(own, carer, { s, e }, from.id);
    return true;
  }
  // (c) last resort: along to work with whoever of the household is out
  const any = guardians.find((q) => during(q).some((a) => a.buildingId !== house.id));
  return any ? tagAlong(kid, any, g, house.id) : false;
}

/**
 * The child goes wherever the guardian goes: for the whole of each outing that
 * touches the gap (leaving and returning with them, even if someone else was
 * still home), except that school is not skipped for it. Where the child
 * cannot join in they sit quietly.
 */
function tagAlong(kid: Person, g: Person, gap: Span, homeId: string): boolean {
  const JOINS = new Set<ActivityKind>(['church', 'fellowship', 'biblestudy', 'youth', 'choir', 'shop', 'visit', 'match', 'concert', 'funeral', 'wedding', 'celebration', 'sleep', 'sport']);
  const fixed = kid.plan.filter((x) => x.kind === 'school' || x.kind === 'homeschool');
  let changed = false;
  for (const a of g.plan.slice()) {
    if (a.end <= gap.s || a.start >= gap.e || a.buildingId === homeId) continue;
    let s = a.start;
    let e = a.end;
    for (const f of fixed) {
      if (f.start <= s && s < f.end) s = f.end;
      if (s < f.start && f.start < e) e = f.start;
    }
    if (e <= s) continue;
    const kind: ActivityKind = NO_TAG_ALONG.has(a.kind) ? 'idle' : JOINS.has(a.kind) ? a.kind : kid.age < 5 ? 'play' : 'rest';
    overlay(kid.plan, act(kind, s, e, a.buildingId, `with ${g.firstName}: ${a.label}`, a.roomId));
    changed = true;
  }
  return changed;
}

/** Whether an activity ties someone down: a job, school, the ward, the court, a service — not a trip to the shop, a rest in the park or the piece work the unemployed go looking for. */
function committed(q: Person, a: Activity): boolean {
  if (a.role === 'minder') return true;
  if (a.kind === 'work' && !q.workplaceId) return false;
  return COMMITTED.has(a.kind);
}

/**
 * The nearest person of sixteen or more with nothing they are committed to in
 * the span, in the settlement, else the city — those without small children
 * of their own first; one who has some brings them along. Police officers are
 * left out: they may be called away.
 */
function findCarer(hh: Household, house: Building, g: Span, pool: Candidate[], midDay = false): Person | null {
  const com = house.community;
  const city = cityOf(com);
  // the window their plan must be free for is the widest a minding could take
  const s = Math.max(0, g.s - MINDER_LEAD_MAX);
  const e = Math.min(1440, g.e + MINDER_STAY);
  let best: Person | null = null;
  let bestKey = Infinity;
  for (const c of pool) {
    if (c.q.householdId === hh.id || c.city !== city) continue;
    const far = Math.hypot(c.house.x - house.x, c.house.y - house.y);
    // Called on at short notice: best someone at home now, with no small children of their own to bring (they would set out ahead of them).
    const now = midDay ? (c.q.loc.buildingId === c.house.id ? 0 : 1500) + (c.ownSmall ? 4000 : 0) : 0;
    const key = far + (far > 600 ? 2000 : 0) + (c.house.community === com ? 0 : 5000) + (c.ownSmall ? 800 : 0) + now;
    if (key >= bestKey) continue;
    let any = false;
    let busy = false;
    for (const a of c.q.plan) {
      if (a.end <= s || a.start >= e) continue;
      any = true;
      if (committed(c.q, a)) {
        busy = true;
        break;
      }
    }
    if (!any || busy) continue;
    bestKey = key;
    best = c.q;
  }
  return best;
}
