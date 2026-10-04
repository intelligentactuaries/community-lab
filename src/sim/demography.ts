// The life course: ageing and its transitions, mortality on the assumed
// basis, pregnancy and birth, courtship / marriage / divorce, migration in
// and out, funerals and weddings.

import type { Ctx } from './ctx';
import { alivePeople, clamp, fullName, householdMembers } from './ctx';
import { payClaims } from './economy';
import { householdClosed, householdOpened } from './finance';
import { expectedMultiplier, fallIll, mortalityMultiplier } from './health';
import { bandFor } from './mortality';
import { mortalityShock, otherChannelScale } from './shocks';
import { MATERNAL_MORTALITY, STILLBIRTH_RATE, TWIN_PROBABILITY, gestationDays, monthlyConceptionProb } from './fertility';
import { compatibility } from './personality';
import { inheritBigFive } from './personality';
import { affluence } from './institutions';
import { JOBS, addChild, addMember, assignSchooling, composeHouseholdPublic, createPerson, decideHomeschool, eduAtLeast, link, marry, newHousehold, profileFor, refreshRoles, removeMember, setJob } from './population';
import { bereave, endConversation } from './social';
import { basisDailyHazard, recordBirth, recordDeath, type DeathSource } from './stats';
import { DAYS_PER_YEAR } from './time';
import type { World, Gathering, Household, Person, CommunityId } from './types';
import { CITY, cityOf, landmark, roomByKind, tierOf } from './world';

/** Scales individual multipliers so their population average ≈ 1 (see docs/ASSUMPTIONS.md). */
/** Share of table deaths not already produced by illness episodes; calibrated (docs/ASSUMPTIONS.md). */
const MULTIPLIER_NORMALISER = Number((typeof process !== 'undefined' && process.env?.COMMUNITY_MORT_NORM) || 0.9);

/**
 * Share of the table hazard applied directly. The rest of each age's deaths
 * come from modelled illness episodes (heart attacks, strokes, pneumonia,
 * cancer, falls...), whose contribution rises with age exactly as real
 * cause-of-death mixes do. Measured with scripts/diag-bands.ts (illness
 * deaths as a fraction of expected deaths by band) and set so the TOTAL
 * stays on the basis for every band — see docs/ASSUMPTIONS.md.
 */
function tableShare(age: number): number {
  if (age < 15) return 0.85;
  if (age < 45) return 0.9;
  if (age < 55) return 0.88;
  if (age < 65) return 0.78;
  if (age < 75) return 0.7;
  if (age < 85) return 0.5;
  return 0.45;
}

// ─── Ageing ────────────────────────────────────────────────────────────────

export function ageDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('lifecourse');
  const P = ctx.params;
  for (const p of alivePeople(world)) {
    const newAge = Math.floor((world.day - p.birthDay) / DAYS_PER_YEAR);
    if (newAge === p.age) continue;
    p.age = newAge;
    p.stage = newAge < 1 ? 'infant' : newAge < 5 ? 'toddler' : newAge < 13 ? 'child' : newAge < 18 ? 'teen' : newAge < 30 ? 'youngAdult' : newAge < 45 ? 'adult' : newAge < 60 ? 'middleAge' : newAge < 75 ? 'senior' : 'elder';
    p.history.push({ day: world.day, kind: 'birthday', text: `Turned ${newAge}.` });
    if (newAge === 1 || newAge % 10 === 0 || newAge === 18 || newAge === 21) ctx.emit({ kind: 'birthday', severity: 'joy', text: `${fullName(p)} turns ${newAge} today.`, personIds: [p.id], householdId: p.householdId });
    p.mood = clamp(p.mood + 0.1, -1, 1);
    const hh = world.households[p.householdId];
    if (newAge === 6) {
      if (hh) decideHomeschool(ctx, hh);
      assignSchooling(ctx, p);
      p.education = 'primary';
      ctx.emit({ kind: 'school-start', severity: 'joy', text: `${fullName(p)} starts ${p.schooling === 'homeschool' ? 'homeschooling' : 'school'}.`, personIds: [p.id], householdId: p.householdId });
      p.history.push({ day: world.day, kind: 'school-start', text: p.schooling === 'homeschool' ? 'Began homeschooling.' : 'Started school.' });
    } else if (newAge === 13) {
      p.education = 'secondary';
      assignSchooling(ctx, p);
    } else if (newAge === 18) {
      const finished = p.schooling === 'school' || p.schooling === 'homeschool';
      p.schooling = 'none';
      if (finished && rng.bernoulli(0.82)) {
        p.education = 'matric';
        ctx.emit({ kind: 'graduation', severity: 'joy', text: `${fullName(p)} passed matric.`, personIds: [p.id], householdId: p.householdId });
        p.history.push({ day: world.day, kind: 'graduation', text: 'Passed matric.' });
        const parentsEdu = p.parentIds.map((id) => world.people[id]).filter(Boolean).some((q) => eduAtLeast(q.education, 'tertiary'));
        const pTert = clamp(P.tertiaryProgression * (parentsEdu ? 1.6 : 1) * (hh?.poor ? 0.5 : 1) * (0.7 + 0.6 * p.big5.C), 0, 0.95);
        if (rng.bernoulli(pTert)) {
          p.education = 'tertiary';
          emigrate(ctx, p, 'left for university in the city');
          continue;
        }
      } else p.education = 'secondary';
      setJob(ctx, p, 'unemployed');
    } else if (newAge < 18) assignSchooling(ctx, p);
  }
}

// ─── Mortality ─────────────────────────────────────────────────────────────

function causeForBaseline(ctx: Ctx, p: Person): string {
  const rng = ctx.rng.stream('mortality');
  const dev = ctx.params.healthProfile === 'developed' || !ctx.params.hivEnabled;
  const a = p.age;
  if (a < 1) return rng.weighted([['neonatal complications', 0.5], ['birth-related', 0.2], ['pneumonia', 0.15], ['diarrhoeal disease', 0.15]]);
  if (a < 5) return rng.weighted([['childhood infection', 0.4], ['diarrhoeal disease', 0.25], ['pneumonia', 0.2], ['accident', 0.15]]);
  if (a < 15) return rng.weighted([['accident', 0.5], ['childhood infection', 0.3], ['cancer', 0.2]]);
  if (a < 35) return p.sex === 'M' ? rng.weighted([['road accident', 0.3], ['violence', dev ? 0.1 : 0.3], ['HIV-related', dev ? 0.02 : 0.25], ['other', 0.15], ['cancer', dev ? 0.2 : 0.05]]) : rng.weighted([['HIV-related', dev ? 0.02 : 0.4], ['road accident', 0.2], ['maternal', 0.08], ['cancer', dev ? 0.3 : 0.1], ['other', 0.2]]);
  if (a < 55) return rng.weighted([['HIV-related', dev ? 0.02 : 0.3], ['tuberculosis', dev ? 0.01 : 0.15], ['heart disease', 0.2], ['stroke', 0.1], ['cancer', dev ? 0.35 : 0.1], ['accident', 0.1], ['diabetes', 0.05]]);
  if (a < 75) return rng.weighted([['heart disease', 0.3], ['stroke', 0.2], ['cancer', 0.2], ['diabetes', 0.1], ['respiratory disease', 0.1], ['tuberculosis', dev ? 0.01 : 0.1]]);
  return rng.weighted([['heart disease', 0.3], ['stroke', 0.2], ['old age', 0.25], ['cancer', 0.1], ['pneumonia', 0.15]]);
}

export function mortalityDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('mortality');
  const people = alivePeople(world);
  // Individual multipliers redistribute risk WITHIN an age band: each person's
  // multiplier is divided by the band's realised mean (credibility-blended
  // with the theoretical mean for small bands), so the table hazard holds in
  // expectation for every band and A/E stays flat by age.
  const raw = new Map<string, number>();
  const sums: Record<string, { s: number; n: number }> = {};
  for (const p of people) {
    const m = mortalityMultiplier(ctx, p);
    raw.set(p.id, m);
    const b = bandFor(p.age);
    const acc = (sums[b] ??= { s: 0, n: 0 });
    acc.s += m;
    acc.n++;
  }
  const K = 0; // pure within-band normalisation (a lone person in a band gets exactly the table hazard)
  for (const p of people) {
    const b = bandFor(p.age);
    const acc = sums[b];
    const theoretical = expectedMultiplier(ctx, p.age, p.sex);
    const mean = (acc.s + K * theoretical) / (acc.n + K);
    const rel = raw.get(p.id)! / Math.max(1e-6, mean);
    // The table channel reads the basis (a supplied one included) directly; a mortality shock scales it.
    const h = basisDailyHazard(ctx, p) * rel * tableShare(p.age) * MULTIPLIER_NORMALISER * mortalityShock(ctx, p.age);
    if (rng.bernoulli(Math.min(0.5, h))) die(ctx, p, causeForBaseline(ctx, p));
  }
}

export function die(ctx: Ctx, p: Person, cause: string, source: DeathSource = 'table'): void {
  const world = ctx.world;
  if (!p.alive) return;
  p.alive = false;
  p.deathDay = world.day;
  p.causeOfDeath = cause;
  p.conversationId && world.conversations[p.conversationId] && endConversation(ctx, world.conversations[p.conversationId], 'ok');
  p.path = [];
  if (p.inVehicleId) {
    const v = world.vehicles[p.inVehicleId];
    if (v) v.occupantIds = v.occupantIds.filter((id) => id !== p.id);
    p.inVehicleId = null;
  }
  recordDeath(ctx, p, cause, source);
  const hh = world.households[p.householdId];
  ctx.emit({ kind: 'death', severity: 'sad', text: `${fullName(p)} has died, aged ${p.age} (${cause}).`, personIds: [p.id], householdId: p.householdId, buildingId: hh?.houseId, data: { cause, age: p.age } });
  p.history.push({ day: world.day, kind: 'death', text: `Died aged ${p.age}: ${cause}.` });
  // Bereavement
  const partner = p.partnerId ? world.people[p.partnerId] : null;
  if (partner && partner.alive) {
    partner.marital = 'widowed';
    partner.partnerId = null;
    partner.romanceCooldown = 365;
    bereave(ctx, partner, p, 0.95, 365);
  }
  for (const [id, r] of Object.entries(p.relationships)) {
    const q = world.people[id];
    if (!q || !q.alive || q.emigrated || q === partner) continue;
    if (r.kind === 'child' || r.kind === 'parent') bereave(ctx, q, p, 0.75, 240);
    else if (r.kind === 'sibling') bereave(ctx, q, p, 0.5, 120);
    else if (r.kind === 'grandparent' || r.kind === 'grandchild') bereave(ctx, q, p, 0.4, 90);
    else if (r.kind === 'friend' && r.strength > 0.4) bereave(ctx, q, p, 0.3, 40);
  }
  payClaims(ctx, p);
  if (hh) {
    removeMember(world, hh, p.id);
    if (!householdMembers(world, hh.id).length) dissolveHousehold(ctx, hh, `the last member, ${fullName(p)}, died`);
    else if (hh.vehicleId && !householdMembers(world, hh.id).some((m) => m.driver)) {
      // no drivers left: the car stays parked
    }
  }
  refreshRoles(world);
  scheduleFuneral(ctx, p);
}

export function dissolveHousehold(ctx: Ctx, hh: Household, why: string, heir: Household | null = null): void {
  const world = ctx.world;
  hh.dissolvedDay = world.day;
  householdClosed(ctx, hh, heir);
  const house = world.buildings[hh.houseId];
  if (house) {
    house.householdId = null;
    house.name = `Plot ${house.plot}`;
  }
  for (const vid of [hh.vehicleId, ...hh.extraVehicleIds]) if (vid) delete world.vehicles[vid];
  hh.vehicleId = null;
  hh.extraVehicleIds = [];
  ctx.emit({ kind: 'household', severity: 'info', text: `The ${hh.name} household has closed: ${why}.`, householdId: hh.id, buildingId: hh.houseId });
}

function nextSaturday(day: number, minDaysAhead: number, weekday: number): number {
  let d = day + minDaysAhead;
  let wd = (weekday + minDaysAhead) % 7;
  while (wd !== 6) {
    d++;
    wd = (wd + 1) % 7;
  }
  return d;
}

function communityOfHousehold(world: World, householdId: string | null | undefined): CommunityId {
  const hh = householdId ? world.households[householdId] : null;
  return (hh ? world.buildings[hh.houseId]?.community : null) ?? 'ebenezer';
}

/** Where a household's funerals are held: its settlement's own congregation, or the city's memorial hall where there is none. */
function funeralVenue(world: World, householdId: string | null | undefined): string {
  const com = communityOfHousehold(world, householdId);
  return landmark(com, 'church') ?? landmark(com, 'hall');
}

/** Where a couple marries: the church, or a civil ceremony at the magistrate's court in the secular city. */
function weddingVenue(world: World, householdId: string | null | undefined): string {
  const com = communityOfHousehold(world, householdId);
  return landmark(com, 'church') ?? landmark(com, 'court');
}

function scheduleFuneral(ctx: Ctx, p: Person): void {
  const world = ctx.world;
  const day = nextSaturday(world.day, 2, ctx.cal.weekday);
  const venue = funeralVenue(world, p.householdId);
  const g: Gathering = { kind: 'funeral', buildingId: venue, day, start: 600, end: 720, forIds: [p.id, ...Object.keys(p.relationships)], label: `${world.buildings[venue]?.kind === 'church' ? 'funeral' : 'memorial'} of ${fullName(p)}` };
  world.scheduledGatherings.push(g);
}

/** Day-step processing of gatherings falling today (funerals place the grave; weddings marry). */
export function gatheringsDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('lifecourse');
  world.todayGatherings = world.scheduledGatherings.filter((g) => g.day === world.day);
  world.scheduledGatherings = world.scheduledGatherings.filter((g) => g.day > world.day);
  for (const g of world.todayGatherings) {
    if (g.kind === 'funeral') {
      const dead = world.people[g.forIds[0]];
      if (!dead) continue;
      // Buried in the deceased's own city's cemetery, row by row.
      const cemeteryId = landmark(world.buildings[g.buildingId]?.community, 'cemetery');
      const cemetery = world.buildings[cemeteryId];
      const graves = cemetery ? roomByKind(cemetery, 'graves') : null;
      const n = graves ? graves.spots.length : world.graves.length;
      const cols = 7;
      const gx = graves ? graves.x + 6 + (n % cols) * 9 : 430;
      const gy = graves ? graves.y + 6 + Math.floor(n / cols) * 9 : 70;
      world.graves.push({ personId: dead.id, name: fullName(dead), day: world.day, x: gx, y: Math.min(gy, graves ? graves.y + graves.h - 4 : 100) });
      if (graves) graves.spots.push({ id: `grave-${dead.id}`, kind: 'grave', x: gx, y: gy });
      world.stats.funerals++;
      ctx.emit({ kind: 'funeral', severity: 'sad', text: `${CITY[cityOf(world.buildings[g.buildingId]?.community)].name} buries ${fullName(dead)} today.`, personIds: [dead.id], buildingId: g.buildingId });
    } else if (g.kind === 'wedding') {
      const [aId, bId] = g.forIds;
      const a = world.people[aId];
      const b = world.people[bId];
      if (!a || !b || !a.alive || !b.alive || a.emigrated || b.emigrated) continue;
      marry(world, a, b, world.day);
      world.stats.marriages++;
      world.stats.weddings++;
      ctx.emit({ kind: 'wedding', severity: 'joy', text: `Wedding bells: ${fullName(a)} and ${fullName(b)} are married ${world.buildings[g.buildingId]?.kind === 'church' ? 'at the church' : `at ${world.buildings[g.buildingId]?.name ?? 'the court'} (a civil ceremony)`} today.`, personIds: [a.id, b.id], buildingId: g.buildingId });
      a.history.push({ day: world.day, kind: 'wedding', text: `Married ${fullName(b)}.` });
      b.history.push({ day: world.day, kind: 'wedding', text: `Married ${fullName(a)}.` });
      for (const p of alivePeople(world)) p.mood = clamp(p.mood + 0.05, -1, 1);
      a.mood = clamp(a.mood + 0.5, -1, 1);
      b.mood = clamp(b.mood + 0.5, -1, 1);
      formHousehold(ctx, a, b);
      if (rng.bernoulli(0.6)) b.surname = a.sex === 'M' ? a.surname : b.surname;
    }
  }
}

/** A newly married couple moves into a vacant house or joins one of the parental homes. */
function formHousehold(ctx: Ctx, a: Person, b: Person): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('lifecourse');
  const groom = a.sex === 'M' ? a : b;
  const bride = groom === a ? b : a;
  // A couple looks for a house in their own settlement first, then their own city.
  const vacants = Object.values(world.buildings).filter((bld) => bld.kind === 'house' && !bld.householdId);
  const homeComs = [groom, bride].map((p) => world.buildings[world.households[p.householdId]?.houseId ?? '']?.community).filter(Boolean);
  const homeCities = homeComs.map((c) => cityOf(c));
  const vacant = vacants.find((bld) => homeComs.includes(bld.community)) ?? vacants.find((bld) => homeCities.includes(cityOf(bld.community))) ?? vacants[0];
  const moveDependents = (p: Person, to: Household) => {
    const from = world.households[p.householdId];
    const deps = from ? householdMembers(world, from.id).filter((q) => q.parentIds.includes(p.id) && q.age < 18) : [];
    for (const d of deps) {
      removeMember(world, from!, d.id);
      addMember(world, to, d);
    }
  };
  if (vacant) {
    const hh = newHousehold(ctx, groom.surname, vacant.id, world.day);
    const fromG = world.households[groom.householdId];
    const fromB = world.households[bride.householdId];
    for (const p of [groom, bride]) {
      const from = world.households[p.householdId];
      if (from) removeMember(world, from, p.id);
      addMember(world, hh, p);
      moveDependents(p, hh);
      if (from && !householdMembers(world, from.id).length) dissolveHousehold(ctx, from, 'everyone moved out', hh);
    }
    hh.headId = groom.id;
    // Start-up money: what the two families can spare, topped up by wedding gifts.
    const startup = Math.round(rng.range(5_000, 40_000));
    hh.savings = startup;
    householdOpened(ctx, hh, startup * 0.5, world.households[groom.householdId] === hh ? null : (fromG ?? null), 'Set-up contribution from the groom\'s family');
    householdOpened(ctx, hh, startup * 0.3, fromB ?? null, 'Set-up contribution from the bride\'s family');
    householdOpened(ctx, hh, startup * 0.2, null, 'Wedding gifts from relatives outside the community');
    hh.insurance.funeral = rng.bernoulli(ctx.params.funeralCoverShare);
    hh.faith = (groom.faith + bride.faith) / 2;
    vacant.name = `${groom.surname} home`;
    decideHomeschool(ctx, hh);
    ctx.emit({ kind: 'household', severity: 'joy', text: `${fullName(groom)} and ${fullName(bride)} set up home at Plot ${vacant.plot}.`, householdId: hh.id, buildingId: vacant.id });
  } else {
    // Join the larger-savings household
    const hg = world.households[groom.householdId];
    const hb = world.households[bride.householdId];
    if (!hg || !hb || hg === hb) return;
    const dest = hg.savings >= hb.savings ? hg : hb;
    const mover = dest === hg ? bride : groom;
    const from = world.households[mover.householdId];
    removeMember(world, from, mover.id);
    addMember(world, dest, mover);
    moveDependents(mover, dest);
    if (!householdMembers(world, from.id).length) dissolveHousehold(ctx, from, 'everyone moved out', dest);
    ctx.emit({ kind: 'household', severity: 'info', text: `${fullName(mover)} moves in with the ${dest.name} household.`, householdId: dest.id });
  }
}

// ─── Fertility ─────────────────────────────────────────────────────────────

export function pregnancyDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('fertility');
  for (const p of alivePeople(world)) {
    if (p.sex !== 'F' || p.away) continue;
    if (p.pregnancy) {
      const days = world.day - p.pregnancy.conceivedDay;
      if (days === 90) ctx.emit({ kind: 'pregnancy', severity: 'joy', text: `${fullName(p)} is expecting a baby.`, personIds: [p.id], householdId: p.householdId });
      if (world.day >= p.pregnancy.dueDay) giveBirth(ctx, p);
      continue;
    }
    if (p.age < 15 || p.age >= 50) continue;
    // one conception roll per calendar month, staggered by person
    const slot = (parseInt(p.id.replace(/\D/g, ''), 10) || 0) % 28;
    if (ctx.cal.day - 1 !== slot) continue;
    const partner = p.partnerId ? world.people[p.partnerId] : null;
    const prob = monthlyConceptionProb(ctx.asfr, {
      age: p.age,
      marital: p.marital,
      hasPartner: !!partner,
      monthsSinceLastBirth: p.lastBirthDay === null ? null : (world.day - p.lastBirthDay) / 30.44,
      parity: p.childIds.length,
      tertiary: eduAtLeast(p.education, 'tertiary'),
      vitality: p.health.vitality,
      contraceptionShare: ctx.params.contraceptionShare,
    });
    if (rng.bernoulli(prob)) {
      const g = gestationDays(() => rng.normal());
      p.pregnancy = { conceivedDay: world.day, dueDay: world.day + g, fatherId: partner?.id ?? null, twins: rng.bernoulli(TWIN_PROBABILITY) };
    }
  }
}

function giveBirth(ctx: Ctx, mother: Person): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('fertility');
  const preg = mother.pregnancy!;
  mother.pregnancy = null;
  mother.lastBirthDay = world.day;
  const father = preg.fatherId ? world.people[preg.fatherId] : null;
  const hh = world.households[mother.householdId];
  const n = preg.twins ? 2 : 1;
  const born: Person[] = [];
  for (let i = 0; i < n; i++) {
    if (rng.bernoulli(STILLBIRTH_RATE)) {
      ctx.emit({ kind: 'birth', severity: 'sad', text: `${fullName(mother)}'s baby was stillborn.`, personIds: [mother.id], householdId: mother.householdId });
      bereave(ctx, mother, mother, 0.6, 120);
      continue;
    }
    const sex = rng.bernoulli(ctx.params.maleShareAtBirth) ? 'M' : 'F';
    const surname = father && mother.marital === 'married' ? father.surname : mother.surname;
    const baby = createPerson(ctx, { sex, ageYears: 0, householdId: mother.householdId, surname, big5: inheritBigFive(rng, mother.big5, father?.big5 ?? null), faith: clamp((mother.faith + (father?.faith ?? mother.faith)) / 2, 0.05, 0.99), bornHere: true });
    baby.birthDay = world.day;
    baby.age = 0;
    baby.stage = 'infant';
    baby.job = 'child';
    baby.education = 'none';
    baby.health.conditions = baby.health.conditions.filter((c) => c === 'hiv-on-art' || c === 'hiv-untreated' ? rng.bernoulli(0.03) : false);
    if (hh) addMember(world, hh, baby);
    addChild(world, mother, baby, world.day);
    if (father) addChild(world, father, baby, world.day);
    for (const gid of [...mother.parentIds, ...(father?.parentIds ?? [])]) if (world.people[gid]?.alive) link(world, gid, baby.id, 'grandchild', 'grandparent', 0.7, world.day);
    const house = hh ? world.buildings[hh.houseId] : null;
    const bed = house ? roomByKind(house, 'bedroom') : null;
    baby.loc = { x: bed?.spots[0]?.x ?? mother.loc.x, y: bed?.spots[0]?.y ?? mother.loc.y, buildingId: house?.id ?? null, roomId: bed?.id ?? null, spotId: null };
    born.push(baby);
    recordBirth(ctx, mother);
    baby.history.push({ day: world.day, kind: 'birth', text: `Born to ${fullName(mother)}${father ? ` and ${fullName(father)}` : ''}.` });
  }
  if (born.length) {
    const names = born.map((b) => b.firstName).join(' and ');
    ctx.emit({ kind: 'birth', severity: 'joy', text: `${fullName(mother)} gave birth to ${born.length === 2 ? 'twins, ' : ''}${names}${born.length === 1 ? ` (${born[0].sex === 'M' ? 'boy' : 'girl'})` : ''}.`, personIds: [mother.id, ...born.map((b) => b.id)], householdId: mother.householdId, buildingId: 'clinic' });
    mother.history.push({ day: world.day, kind: 'birth', text: `Gave birth to ${names}.` });
    if (father) father.history.push({ day: world.day, kind: 'birth', text: `${names} born.` });
    for (const m of hh ? householdMembers(world, hh.id) : []) m.mood = clamp(m.mood + 0.3, -1, 1);
  }
  mother.health.restDaysLeft = 6;
  mother.health.lastClinicDay = world.day;
  world.stats.hospitalVisits++;
  if (rng.bernoulli(0.08)) fallIll(ctx, mother, 'pregnancy-complication', 0.1, 'after the birth');
  if (rng.bernoulli(MATERNAL_MORTALITY * (ctx.params.healthProfile === 'developed' ? 0.15 : 1) * otherChannelScale(ctx, mother))) die(ctx, mother, 'maternal death', 'maternal');
}

// ─── Nuptiality (monthly) ──────────────────────────────────────────────────

function courtshipAgeCurve(age: number, peak: number): number {
  if (age < 18) return 0;
  const sd = 6;
  return Math.exp(-0.5 * Math.pow((age - peak) / sd, 2)) + (age > peak + 10 ? 0.15 : 0);
}

function areKin(a: Person, b: Person): boolean {
  if (a.parentIds.some((id) => b.parentIds.includes(id))) return true;
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  const r = a.relationships[b.id];
  return !!r && (r.kind === 'sibling' || r.kind === 'parent' || r.kind === 'child' || r.kind === 'grandparent' || r.kind === 'grandchild');
}

export function nuptialityMonthStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('nuptiality');
  const P = ctx.params;
  const people = alivePeople(world).filter((p) => !p.away);
  // Divorce
  for (const p of people) {
    if (p.marital !== 'married' || !p.partnerId || p.sex !== 'M') continue;
    const q = world.people[p.partnerId];
    if (!q || !q.alive) continue;
    const r = p.relationships[q.id];
    const strain = (1 - (r?.strength ?? 0.5)) + (p.stress + q.stress) / 2;
    const faith = (p.faith + q.faith) / 2;
    const monthly = (P.divorceHazard / 12) * (0.5 + strain) * (faith > 0.7 ? 0.6 : faith < 0.3 ? 1.6 : 1);
    if (rng.bernoulli(clamp(monthly, 0, 0.1))) divorce(ctx, p, q);
  }
  // Courtship progress
  for (const p of people) {
    if (p.marital === 'courting' && p.partnerId && p.sex === 'M') {
      const q = world.people[p.partnerId];
      if (!q || !q.alive || q.emigrated) {
        p.marital = 'single';
        p.partnerId = null;
        continue;
      }
      if (rng.bernoulli(0.05)) {
        breakUp(ctx, p, q);
        continue;
      }
      if (rng.bernoulli(0.12 * (0.5 + compatibility(p.big5, q.big5)))) {
        p.marital = 'engaged';
        q.marital = 'engaged';
        const day = nextSaturday(world.day, 45 + rng.int(90), ctx.cal.weekday);
        world.scheduledGatherings.push({ kind: 'wedding', buildingId: weddingVenue(world, p.householdId), day, start: 660, end: 780, forIds: [p.id, q.id], label: `wedding of ${p.firstName} & ${q.firstName}` });
        ctx.emit({ kind: 'engagement', severity: 'joy', text: `${fullName(p)} and ${fullName(q)} are engaged; the wedding is set for ${day - world.day} days from now.`, personIds: [p.id, q.id] });
        p.history.push({ day: world.day, kind: 'engagement', text: `Engaged to ${fullName(q)}.` });
        q.history.push({ day: world.day, kind: 'engagement', text: `Engaged to ${fullName(p)}.` });
      }
    } else if (p.marital === 'engaged' && p.partnerId && p.sex === 'M') {
      const q = world.people[p.partnerId];
      if (q && q.alive && rng.bernoulli(0.02)) {
        breakUp(ctx, p, q);
        world.scheduledGatherings = world.scheduledGatherings.filter((g) => !(g.kind === 'wedding' && g.forIds.includes(p.id)));
      }
    }
  }
  // New courtships
  const singles = people.filter((p) => p.age >= 18 && !p.partnerId && (p.marital === 'single' || p.marital === 'divorced' || p.marital === 'widowed') && p.romanceCooldown <= 0);
  const men = singles.filter((p) => p.sex === 'M');
  const women = singles.filter((p) => p.sex === 'F');
  for (const m of men) {
    const annual = P.courtshipHazard * courtshipAgeCurve(m.age, P.marriageAgeM - 1) * (0.6 + 0.8 * m.big5.E);
    const monthly = 1 - Math.pow(1 - clamp(annual, 0, 0.95), 1 / 12);
    if (!rng.bernoulli(monthly)) continue;
    const cands = women
      .filter((w) => !w.partnerId && w.romanceCooldown <= 0 && !areKin(m, w) && w.age >= 18 && m.age - w.age >= -4 && m.age - w.age <= 12)
      .map((w) => ({ w, score: compatibility(m.big5, w.big5) * (1 - Math.abs(m.faith - w.faith) * 0.5) * courtshipAgeCurve(w.age, P.marriageAgeF - 1) }))
      .filter((c) => c.score > 0.05);
    if (cands.length && rng.bernoulli(0.8)) {
      const pick = rng.weighted(cands.map((c) => [c.w, Math.pow(c.score, 2)] as const));
      startCourtship(ctx, m, pick);
    } else if (rng.bernoulli(0.25)) {
      // A partner from outside the community moves in on marriage
      const hh = world.households[m.householdId];
      const w = createPerson(ctx, { sex: 'F', ageYears: clamp(m.age - rng.range(-2, 8), 18, 60), householdId: m.householdId, surname: pickOutsideSurname(ctx), faith: clamp(m.faith + rng.normal(0, 0.15), 0.05, 0.99) });
      w.education = m.education;
      if (hh) addMember(world, hh, w);
      setJob(ctx, w, rng.bernoulli(0.5) ? 'unemployed' : 'office');
      w.loc = { ...m.loc };
      world.stats.immigrations++;
      ctx.emit({ kind: 'immigration', severity: 'joy', text: `${fullName(w)} came from the next town to be with ${fullName(m)}.`, personIds: [w.id, m.id] });
      startCourtship(ctx, m, w);
    }
  }
}

function pickOutsideSurname(ctx: Ctx): string {
  const rng = ctx.rng.stream('nuptiality');
  const pool = ['Mabena', 'Ngwenya', 'Steyn', 'Maseko', 'Kruger', 'Tshabalala', 'Nel', 'Mokgadi', 'Booysen', 'Mthethwa', 'Du Plessis', 'Lekota', 'Hlongwane', 'Swanepoel', 'Nyathi', 'Motaung', 'Vilakazi', 'Erasmus', 'Mabuza', 'Chauke', 'Chetty', 'Naicker', 'Padayachee', 'Taylor'];
  const used = new Set(Object.values(ctx.world.households).map((h) => h.name));
  const free = pool.filter((s) => !used.has(s));
  return rng.pick(free.length ? free : pool);
}

function startCourtship(ctx: Ctx, m: Person, w: Person): void {
  const world = ctx.world;
  m.marital = 'courting';
  w.marital = 'courting';
  m.partnerId = w.id;
  w.partnerId = m.id;
  link(world, m.id, w.id, 'partner', 'partner', 0.6, world.day);
  ctx.emit({ kind: 'courtship', severity: 'joy', text: `${fullName(m)} and ${fullName(w)} are courting.`, personIds: [m.id, w.id] });
  m.history.push({ day: world.day, kind: 'courtship', text: `Began courting ${fullName(w)}.` });
  w.history.push({ day: world.day, kind: 'courtship', text: `Began courting ${fullName(m)}.` });
}

function breakUp(ctx: Ctx, a: Person, b: Person): void {
  for (const p of [a, b]) {
    p.marital = p.history.some((h) => h.kind === 'divorce') ? 'divorced' : 'single';
    p.partnerId = null;
    p.romanceCooldown = 120;
    p.mood = clamp(p.mood - 0.3, -1, 1);
  }
  delete a.relationships[b.id];
  delete b.relationships[a.id];
  ctx.emit({ kind: 'courtship', severity: 'sad', text: `${fullName(a)} and ${fullName(b)} have parted ways.`, personIds: [a.id, b.id] });
}

function divorce(ctx: Ctx, husband: Person, wife: Person): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('nuptiality');
  world.stats.divorces++;
  for (const p of [husband, wife]) {
    p.marital = 'divorced';
    p.partnerId = null;
    p.romanceCooldown = 365;
    p.mood = clamp(p.mood - 0.4, -1, 1);
    p.stress = clamp(p.stress + 0.3, 0, 1);
    p.history.push({ day: world.day, kind: 'divorce', text: `Divorced ${fullName(p === husband ? wife : husband)}.` });
  }
  const r1 = husband.relationships[wife.id];
  const r2 = wife.relationships[husband.id];
  if (r1) {
    r1.kind = 'rival';
    r1.strength = -0.4;
  }
  if (r2) {
    r2.kind = 'rival';
    r2.strength = -0.4;
  }
  ctx.emit({ kind: 'divorce', severity: 'sad', text: `${fullName(husband)} and ${fullName(wife)} have divorced.`, personIds: [husband.id, wife.id], householdId: husband.householdId });
  // The husband moves out: a vacant house if any, else he leaves the community.
  const hh = world.households[husband.householdId];
  const vacants2 = Object.values(world.buildings).filter((b) => b.kind === 'house' && !b.householdId);
  const husCom = world.buildings[world.households[husband.householdId]?.houseId ?? '']?.community;
  const vacant = vacants2.find((b) => b.community === husCom) ?? vacants2.find((b) => cityOf(b.community) === cityOf(husCom)) ?? vacants2[0];
  if (vacant && rng.bernoulli(0.6)) {
    removeMember(world, hh, husband.id);
    const nh = newHousehold(ctx, husband.surname, vacant.id, world.day);
    addMember(world, nh, husband);
    householdOpened(ctx, nh, Math.round(hh.savings * 0.4), hh, 'Division of the estate on divorce');
    vacant.name = `${husband.surname} home`;
    ctx.emit({ kind: 'household', severity: 'info', text: `${fullName(husband)} moved to Plot ${vacant.plot}.`, householdId: nh.id, buildingId: vacant.id });
  } else emigrate(ctx, husband, 'left the community after the divorce');
}

// ─── Migration ─────────────────────────────────────────────────────────────

export function emigrate(ctx: Ctx, p: Person, why: string): void {
  const world = ctx.world;
  p.emigrated = true;
  p.leftDay = world.day;
  p.path = [];
  p.conversationId && world.conversations[p.conversationId] && endConversation(ctx, world.conversations[p.conversationId], 'ok');
  const hh = world.households[p.householdId];
  if (hh) {
    removeMember(world, hh, p.id);
    if (!householdMembers(world, hh.id).length) dissolveHousehold(ctx, hh, 'everyone left');
  }
  if (p.partnerId) {
    const q = world.people[p.partnerId];
    if (q && q.alive && q.marital !== 'married') {
      q.marital = 'single';
      q.partnerId = null;
    }
  }
  world.stats.emigrations++;
  ctx.emit({ kind: 'emigration', severity: 'info', text: `${fullName(p)} ${why}.`, personIds: [p.id], buildingId: landmark(communityOfHousehold(world, hh?.id), 'busstop') });
  p.history.push({ day: world.day, kind: 'emigration', text: why });
  refreshRoles(world);
}

export function migrationMonthStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('migration');
  const P = ctx.params;
  // Youth out-migration
  for (const p of alivePeople(world)) {
    if (p.age < 18 || p.age > 30 || p.away) continue;
    if (p.marital === 'married' || p.childIds.some((id) => world.people[id]?.alive && world.people[id].age < 18)) continue;
    if (JOBS[p.job].essential > 0 && p.workplaceId) continue;
    const annual = P.youthEmigrationHazard * (p.job === 'unemployed' ? 2 : 1) * (eduAtLeast(p.education, 'tertiary') ? 1.5 : 1);
    if (rng.bernoulli(1 - Math.pow(1 - clamp(annual, 0, 0.9), 1 / 12))) emigrate(ctx, p, rng.pick(['moved to Johannesburg for work', 'left to look for work in the city', 'took a job in Pretoria', 'went to stay with relatives in Durban']));
  }
  // In-migration into vacant houses
  const vacant = Object.values(world.buildings).filter((b) => b.kind === 'house' && !b.householdId);
  for (const house of vacant) {
    if (!rng.bernoulli(1 - Math.pow(1 - clamp(P.immigrationHazard, 0, 0.95), 1 / 12))) continue;
    const surname = pickOutsideSurname(ctx);
    const com = house.community;
    const prof = com === 'ebenezer' ? null : profileFor(P, com);
    const hh = newHousehold(ctx, surname, house.id, world.day);
    composeHouseholdPublic(ctx, hh, rng.weighted([['family', 0.55], ['couple', 0.25], ['single', 0.1], ['singleParent', 0.1]]), surname, prof?.educationMix);
    house.name = `${surname} home`;
    decideHomeschool(ctx, hh);
    const wealth = affluence(com);
    const pOffice = 0.2 + 0.6 * wealth;
    for (const pid of hh.memberIds) {
      const p = world.people[pid];
      assignSchooling(ctx, p);
      if (p.age >= 18) setJob(ctx, p, p.age >= P.retirementAge ? 'retired' : rng.bernoulli(pOffice) ? 'office' : 'unemployed');
      const bed = roomByKind(house, 'bedroom');
      p.loc = { x: bed?.spots[0]?.x ?? house.x + 20, y: bed?.spots[0]?.y ?? house.y + 30, buildingId: house.id, roomId: bed?.id ?? null, spotId: null };
      p.history.push({ day: world.day, kind: 'immigration', text: `Moved to ${CITY[cityOf(com)].name}, Plot ${house.plot}.` });
    }
    hh.insurance.funeral = rng.bernoulli(prof?.funeralCoverShare ?? P.funeralCoverShare);
    const tier = tierOf(com);
    householdOpened(ctx, hh, Math.round(rng.range(5_000, 60_000) * (tier === 'ultra' ? 4 : tier === 'affluent' ? 2.5 : tier === 'comfortable' ? 1.5 : tier === 'middle' ? 1 : tier === 'working' ? 0.6 : 0.35)), null, 'Savings brought along on moving in');
    world.stats.immigrations += hh.memberIds.length;
    ctx.emit({ kind: 'immigration', severity: 'joy', text: `The ${surname} family (${hh.memberIds.length}) moved into Plot ${house.plot}.`, householdId: hh.id, buildingId: house.id });
  }
  // Prisoners / away people returning
  for (const p of alivePeople(world)) {
    if (p.away && p.away.untilDay <= world.day) {
      ctx.emit({ kind: 'household', severity: 'info', text: `${fullName(p)} is back in the community after ${p.away.reason}.`, personIds: [p.id] });
      p.away = null;
    }
  }
}
