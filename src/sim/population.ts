// Initial community generator. Builds N households with role guarantees
// (a church community cannot function without its pastor, doctor, nurses,
// teachers, police officers, magistrate, shopkeeper, farmer and builder),
// then fills the remaining adults from the employment mix. Every draw comes
// from the 'population' RNG stream so the same seed always seats the same
// people in the same houses.

import type { Ctx } from './ctx';
import { alivePeople, clamp, fullName } from './ctx';
import { heritageOf } from './heritage';
import { archetypeOf, inheritBigFive, pickFirstName, pickSurname, sampleBigFive, SHAPE_FOR } from './personality';
import { CHURCH_IDS, COUNTER_IDS, DELI_IDS, ESSENTIAL_POSTS, MARKET_IDS, SPAZA_IDS, affluence, defaultWorkplace, faithMeanFor, type EssentialPost } from './institutions';
import type { AgeProfileId, CommunityProfile, EducationMix, ScenarioParams } from './params';
import { parkingSpot, yardSlot } from './parking';
import type { Rng } from './rng';
import { DAYS_PER_YEAR } from './time';
import type { BigFive, Building, CityId, CommunityId, ConditionId, CouncilRole, CouncilSeat, Education, Household, JobId, LifeStage, Person, Schooling, Sex, Tier, Vehicle, World } from './types';
import { seedTransit } from './transit';
import { AMBULANCE_BASES, CITIES, CLINIC_IDS, COMMUNITIES, COUNCIL_IDS, COURT_IDS, POLICE_IDS, TAXI_RANK_IDS, cityOf, doorOf, landmark, residentialOf, roomByKind, tierOf } from './world';

export type { EssentialPost };

// ─── Jobs ─────────────────────────────────────────────────────────────────

export interface JobSpec {
  id: JobId;
  label: string;
  workplace: string | null;
  /** ZAR / month, 2024 levels (proxy: public-service pay scales + QLFS medians). */
  income: number;
  minEducation: Education;
  minAge: number;
  /** Essential-role headcount to guarantee at t0. */
  essential: number;
  /** Occupational injury hazard per year. */
  injuryHazard: number;
  /**
   * Restricts the role to one sex. Used only for the pastorate: this
   * congregation holds the complementarian position, so the pastor is a man.
   * Every other role in the community is open to both.
   */
  sex?: Sex;
}

export const JOBS: Record<JobId, JobSpec> = {
  pastor: { id: 'pastor', label: 'Pastor', workplace: 'church', income: 18_000, minEducation: 'tertiary', minAge: 32, essential: 1, injuryHazard: 0.01, sex: 'M' },
  doctor: { id: 'doctor', label: 'Doctor', workplace: 'clinic', income: 62_000, minEducation: 'postgrad', minAge: 29, essential: 1, injuryHazard: 0.01 },
  nurse: { id: 'nurse', label: 'Nurse', workplace: 'clinic', income: 26_000, minEducation: 'tertiary', minAge: 23, essential: 2, injuryHazard: 0.02 },
  teacher: { id: 'teacher', label: 'Teacher', workplace: 'school', income: 27_000, minEducation: 'tertiary', minAge: 23, essential: 2, injuryHazard: 0.01 },
  police: { id: 'police', label: 'Police officer', workplace: 'police', income: 23_000, minEducation: 'matric', minAge: 21, essential: 2, injuryHazard: 0.06 },
  magistrate: { id: 'magistrate', label: 'Magistrate', workplace: 'court', income: 58_000, minEducation: 'postgrad', minAge: 35, essential: 1, injuryHazard: 0.005 },
  clerk: { id: 'clerk', label: 'Court clerk', workplace: 'court', income: 15_000, minEducation: 'matric', minAge: 20, essential: 1, injuryHazard: 0.005 },
  shopkeeper: { id: 'shopkeeper', label: 'Shopkeeper', workplace: 'market', income: 21_000, minEducation: 'secondary', minAge: 25, essential: 1, injuryHazard: 0.02 },
  vendor: { id: 'vendor', label: 'Market vendor', workplace: 'market', income: 5_500, minEducation: 'none', minAge: 18, essential: 1, injuryHazard: 0.02 },
  farmer: { id: 'farmer', label: 'Farmer', workplace: 'farm', income: 24_000, minEducation: 'secondary', minAge: 25, essential: 1, injuryHazard: 0.07 },
  farmhand: { id: 'farmhand', label: 'Farm worker', workplace: 'farm', income: 5_200, minEducation: 'none', minAge: 18, essential: 1, injuryHazard: 0.08 },
  builder: { id: 'builder', label: 'Builder', workplace: 'workshop', income: 16_000, minEducation: 'secondary', minAge: 20, essential: 1, injuryHazard: 0.09 },
  office: { id: 'office', label: 'Office worker', workplace: 'office', income: 21_000, minEducation: 'matric', minAge: 19, essential: 0, injuryHazard: 0.005 },
  attorney: { id: 'attorney', label: 'Attorney', workplace: 'rpractice', income: 46_000, minEducation: 'postgrad', minAge: 28, essential: 1, injuryHazard: 0.005 },
  accountant: { id: 'accountant', label: 'Accountant', workplace: 'rpractice', income: 38_000, minEducation: 'tertiary', minAge: 26, essential: 1, injuryHazard: 0.005 },
  dmo: { id: 'dmo', label: 'District medical officer', workplace: 'medical', income: 72_000, minEducation: 'postgrad', minAge: 32, essential: 1, injuryHazard: 0.01 },
  combanker: { id: 'combanker', label: 'Commercial-bank officer', workplace: 'combank', income: 33_000, minEducation: 'tertiary', minAge: 26, essential: 2, injuryHazard: 0.005 },
  taxidriver: { id: 'taxidriver', label: 'Taxi driver', workplace: 'ptaxi', income: 9_800, minEducation: 'primary', minAge: 21, essential: 2, injuryHazard: 0.05 },
  domestic: { id: 'domestic', label: 'Domestic worker', workplace: null, income: 5_400, minEducation: 'none', minAge: 18, essential: 0, injuryHazard: 0.02 },
  surgeon: { id: 'surgeon', label: 'Surgeon', workplace: 'hospital', income: 98_000, minEducation: 'postgrad', minAge: 33, essential: 2, injuryHazard: 0.01 },
  executive: { id: 'executive', label: 'Executive', workplace: 'towers', income: 150_000, minEducation: 'postgrad', minAge: 35, essential: 2, injuryHazard: 0.005 },
  engineer: { id: 'engineer', label: 'Engineer', workplace: 'office', income: 58_000, minEducation: 'tertiary', minAge: 25, essential: 0, injuryHazard: 0.02 },
  civilservant: { id: 'civilservant', label: 'Civil servant', workplace: 'govt', income: 28_000, minEducation: 'matric', minAge: 21, essential: 4, injuryHazard: 0.005 },
  centralbanker: { id: 'centralbanker', label: 'Reserve Bank officer', workplace: 'reservebank', income: 62_000, minEducation: 'postgrad', minAge: 28, essential: 2, injuryHazard: 0.005 },
  librarian: { id: 'librarian', label: 'Librarian', workplace: 'nh-library', income: 22_000, minEducation: 'tertiary', minAge: 23, essential: 1, injuryHazard: 0.005 },
  pilot: { id: 'pilot', label: 'Pilot', workplace: 'ap-terminal', income: 74_000, minEducation: 'tertiary', minAge: 26, essential: 2, injuryHazard: 0.01 },
  busdriver: { id: 'busdriver', label: 'Bus driver', workplace: 'terminus', income: 11_500, minEducation: 'primary', minAge: 21, essential: 4, injuryHazard: 0.04 },
  // Own-account: a driver-partner on the Hamba app in a car rented from Unity Fleet Rentals. The income here is only a
  // first guess; from the first month it is last month's takings less commission, fuel and rent (finance/transport.ts).
  ehailer: { id: 'ehailer', label: 'E-hailing driver', workplace: 'home', income: 6_500, minEducation: 'primary', minAge: 21, essential: 0, injuryHazard: 0.05 },
  banker: { id: 'banker', label: 'Bank officer', workplace: 'bank', income: 19_500, minEducation: 'matric', minAge: 22, essential: 1, injuryHazard: 0.005 },
  homemaker: { id: 'homemaker', label: 'Homemaker', workplace: null, income: 0, minEducation: 'none', minAge: 18, essential: 0, injuryHazard: 0.01 },
  unemployed: { id: 'unemployed', label: 'Unemployed', workplace: null, income: 0, minEducation: 'none', minAge: 18, essential: 0, injuryHazard: 0.01 },
  retired: { id: 'retired', label: 'Retired', workplace: null, income: 0, minEducation: 'none', minAge: 60, essential: 0, injuryHazard: 0.01 },
  student: { id: 'student', label: 'Student', workplace: null, income: 0, minEducation: 'none', minAge: 5, essential: 0, injuryHazard: 0.01 },
  child: { id: 'child', label: 'Child', workplace: null, income: 0, minEducation: 'none', minAge: 0, essential: 0, injuryHazard: 0.01 },
};

export const EDUCATION_ORDER: Education[] = ['none', 'primary', 'secondary', 'matric', 'tertiary', 'postgrad'];
export function eduRank(e: Education): number {
  return EDUCATION_ORDER.indexOf(e);
}
export function eduAtLeast(e: Education, min: Education): boolean {
  return eduRank(e) >= eduRank(min);
}

/** Income multiplier for education beyond the job minimum, and experience. */
export function incomeFor(rng: Rng, job: JobId, education: Education, age: number): number {
  const spec = JOBS[job];
  if (spec.income === 0) return 0;
  const eduBonus = 1 + 0.06 * Math.max(0, eduRank(education) - eduRank(spec.minEducation));
  const exp = clamp((age - spec.minAge) / 25, 0, 1);
  const expBonus = 0.8 + 0.4 * exp;
  return Math.round(spec.income * eduBonus * expBonus * clamp(rng.normal(1, 0.12), 0.7, 1.4));
}

export function stageFor(age: number): LifeStage {
  if (age < 1) return 'infant';
  if (age < 5) return 'toddler';
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'youngAdult';
  if (age < 45) return 'adult';
  if (age < 60) return 'middleAge';
  if (age < 75) return 'senior';
  return 'elder';
}

// ─── Health priors (SADHS 2016, Stats SA NCD 2022, HSRC SABSSM 2024; see docs/ASSUMPTIONS.md) ──

export function conditionPrevalence(cond: ConditionId, age: number, sex: Sex, profile: ScenarioParams['healthProfile'], hiv: boolean): number {
  const dev = profile === 'developed';
  switch (cond) {
    case 'hypertension':
      if (age < 18) return 0.004;
      if (age < 30) return dev ? 0.04 : 0.06;
      if (age < 45) return dev ? 0.12 : 0.21;
      if (age < 60) return dev ? 0.3 : 0.43;
      return dev ? 0.5 : 0.55;
    case 'diabetes':
      if (age < 18) return 0.002;
      if (age < 30) return 0.015;
      if (age < 45) return dev ? 0.04 : 0.07;
      if (age < 60) return dev ? 0.09 : 0.14;
      return (dev ? 0.15 : 0.18) * (sex === 'F' ? 1.1 : 1);
    case 'hiv-on-art':
    case 'hiv-untreated': {
      if (!hiv || dev) return cond === 'hiv-on-art' ? 0.001 : 0.0005;
      const prev = age < 15 ? 0.015 : age < 25 ? 0.06 : sex === 'F' ? 0.19 : 0.12;
      const rural = profile === 'sa-rural' ? 1.1 : 1;
      return prev * rural * (cond === 'hiv-on-art' ? 0.78 : 0.22);
    }
    case 'asthma':
      return age < 18 ? 0.08 : 0.05;
    case 'copd':
      if (age < 40) return 0.005;
      if (age < 60) return 0.035;
      return 0.09;
    case 'cvd':
      if (age < 40) return 0.01;
      if (age < 60) return 0.06;
      return 0.17;
    case 'disability':
      if (age < 15) return 0.01;
      if (age < 60) return 0.03;
      return 0.1;
  }
}

export const CONDITIONS: ConditionId[] = ['hypertension', 'diabetes', 'hiv-on-art', 'hiv-untreated', 'asthma', 'copd', 'cvd', 'disability'];

export function baseVitality(rng: Rng, age: number, conditions: ConditionId[]): number {
  let v = 0.92 - Math.max(0, age - 40) * 0.006;
  for (const c of conditions) v -= c === 'hiv-untreated' ? 0.15 : c === 'cvd' ? 0.1 : c === 'copd' ? 0.08 : 0.04;
  return clamp(v + rng.normal(0, 0.05), 0.2, 0.98);
}

// ─── Person factory ───────────────────────────────────────────────────────

export interface NewPersonOpts {
  sex: Sex;
  ageYears: number;
  householdId: string;
  surname: string;
  big5?: BigFive;
  education?: Education;
  eduMix?: EducationMix;
  faith?: number;
  bornHere?: boolean;
  parentIds?: string[];
}

export function createPerson(ctx: Ctx, o: NewPersonOpts): Person {
  const rng = ctx.rng.stream('population');
  const world = ctx.world;
  const id = ctx.nextId('person');
  const used = new Set<string>();
  for (const pid of world.households[o.householdId]?.memberIds ?? []) used.add(world.people[pid]?.firstName ?? '');
  const firstName = pickFirstName(rng, o.sex, used, o.surname);
  const big5 = o.big5 ?? sampleBigFive(rng);
  const archetype = archetypeOf(big5);
  const age = Math.floor(o.ageYears);
  const birthDay = Math.round(world.day - o.ageYears * DAYS_PER_YEAR);
  const conditions: ConditionId[] = [];
  const hrng = ctx.rng.stream('health');
  for (const c of CONDITIONS) {
    if (c === 'hiv-untreated' && conditions.includes('hiv-on-art')) continue;
    if (hrng.bernoulli(conditionPrevalence(c, age, o.sex, ctx.params.healthProfile, ctx.params.hivEnabled))) conditions.push(c);
  }
  const education = o.education ?? educationForAge(rng, ctx.params, age, o.eduMix);
  const p: Person = {
    id,
    firstName,
    surname: o.surname,
    heritage: heritageOf(o.surname),
    sex: o.sex,
    birthDay,
    age,
    stage: stageFor(age),
    householdId: o.householdId,
    big5,
    archetype,
    shape: SHAPE_FOR[archetype],
    education,
    schooling: 'none',
    job: age < 5 ? 'child' : age < 18 ? 'student' : 'unemployed',
    workplaceId: null,
    income: 0,
    marital: 'single',
    partnerId: null,
    parentIds: o.parentIds ?? [],
    childIds: [],
    health: { state: 'healthy', vitality: baseVitality(hrng, age, conditions), illnesses: [], conditions, lastClinicDay: -999, hospitalDaysLeft: 0, restDaysLeft: 0, admissions: 0, hospitalId: null, admittedDay: -1 },
    mood: clamp(rng.normal(0.2, 0.2), -1, 1),
    stress: clamp(rng.normal(0.25, 0.12), 0, 1),
    energy: 0.9,
    faith: clamp(o.faith ?? rng.normal(faithMeanFor(world.buildings[world.households[o.householdId]?.houseId ?? '']?.community, ctx.params.churchAttendance), 0.1), 0.02, 0.995),
    reputation: clamp(rng.normal(0.2, 0.2), -1, 1),
    criminalRecord: 0,
    pregnancy: null,
    grief: null,
    relationships: {},
    loc: { x: 0, y: 0, buildingId: null, roomId: null, spotId: null },
    plan: [],
    planIdx: -1,
    target: null,
    path: [],
    inVehicleId: null,
    driver: false,
    heading: 0,
    conversationId: null,
    alive: true,
    deathDay: null,
    causeOfDeath: null,
    emigrated: false,
    history: [],
    romanceCooldown: 0,
    wanderTimer: 0,
    alertTimer: 0,
    bornHere: o.bornHere ?? false,
    arrivedDay: world.day,
    leftDay: null,
    away: null,
    lastBirthDay: null,
    socialToday: 0,
    waitingFor: null,
    waitingLine: null,
    alightAt: null,
    waitedMin: 0,
  };
  world.people[id] = p;
  return p;
}

export function educationForAge(rng: Rng, params: ScenarioParams, age: number, mix?: EducationMix): Education {
  if (age < 6) return 'none';
  if (age < 13) return 'primary';
  if (age < 18) return 'secondary';
  const m = mix ?? params.educationMix;
  return rng.weighted<Education>([
    ['none', m.none],
    ['primary', m.primary],
    ['secondary', m.secondary],
    ['matric', m.matric],
    ['tertiary', age >= 21 ? m.tertiary : m.tertiary * 0.3],
    ['postgrad', age >= 24 ? m.postgrad : 0],
  ]);
}

export function link(world: World, a: string, b: string, kindAB: Person['relationships'][string]['kind'], kindBA: Person['relationships'][string]['kind'], strength: number, day: number): void {
  const pa = world.people[a];
  const pb = world.people[b];
  if (!pa || !pb) return;
  pa.relationships[b] = { kind: kindAB, strength, since: day, lastInteraction: day };
  pb.relationships[a] = { kind: kindBA, strength, since: day, lastInteraction: day };
}

export function marry(world: World, a: Person, b: Person, day: number): void {
  a.marital = 'married';
  b.marital = 'married';
  a.partnerId = b.id;
  b.partnerId = a.id;
  link(world, a.id, b.id, 'spouse', 'spouse', 0.8, day);
}

export function addChild(world: World, parent: Person, child: Person, day: number): void {
  if (!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
  if (!child.parentIds.includes(parent.id)) child.parentIds.push(parent.id);
  link(world, parent.id, child.id, 'child', 'parent', 0.85, day);
  for (const sid of parent.childIds) {
    if (sid !== child.id && world.people[sid]) link(world, sid, child.id, 'sibling', 'sibling', 0.6, day);
  }
}

// ─── Household composition ────────────────────────────────────────────────

export type HouseholdType = 'family' | 'couple' | 'singleParent' | 'multigen' | 'elderly' | 'single';

function householdTypeWeights(profile: AgeProfileId): Array<[HouseholdType, number]> {
  if (profile === 'young') return [['family', 0.58], ['couple', 0.16], ['singleParent', 0.14], ['multigen', 0.06], ['elderly', 0.02], ['single', 0.04]];
  if (profile === 'ageing') return [['family', 0.3], ['couple', 0.14], ['singleParent', 0.08], ['multigen', 0.18], ['elderly', 0.22], ['single', 0.08]];
  return [['family', 0.46], ['couple', 0.12], ['singleParent', 0.12], ['multigen', 0.14], ['elderly', 0.09], ['single', 0.07]];
}

export function newHousehold(ctx: Ctx, name: string, houseId: string, day: number): Household {
  const id = ctx.nextId('household');
  const hh: Household = {
    id,
    name,
    houseId,
    memberIds: [],
    headId: null,
    savings: 0,
    debt: 0,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    vehicleId: null,
    extraVehicleIds: [],
    insurance: { funeral: false, life: false, medical: false },
    homeschool: false,
    faith: faithMeanFor(ctx.world.buildings[houseId]?.community, ctx.params.churchAttendance),
    formedDay: day,
    dissolvedDay: null,
    poor: false,
    arrears: 0,
    ledger: [],
  };
  ctx.world.households[id] = hh;
  const house = ctx.world.buildings[houseId];
  if (house) house.householdId = id;
  return hh;
}

export function addMember(world: World, hh: Household, p: Person): void {
  if (!hh.memberIds.includes(p.id)) hh.memberIds.push(p.id);
  p.householdId = hh.id;
  if (!hh.headId) hh.headId = p.id;
}

export function removeMember(world: World, hh: Household, pid: string): void {
  hh.memberIds = hh.memberIds.filter((id) => id !== pid);
  if (hh.headId === pid) hh.headId = hh.memberIds.find((id) => (world.people[id]?.age ?? 0) >= 18) ?? hh.memberIds[0] ?? null;
}

export const TAXIS_PER_RANK = 4;

export function createVehicle(ctx: Ctx, householdId: string | null, kind: Vehicle['kind'], x: number, y: number, baseId: string | null = null): Vehicle {
  const id = ctx.nextId('vehicle');
  const v: Vehicle = { id, householdId, kind, x, y, heading: 0, path: [], occupantIds: [], homeX: x, homeY: y, moving: false, driverId: null, destBuildingId: null, odometerKm: 0, baseId, returning: false, stage: null, boardIds: [], lineId: null, stopIdx: 0, dir: 1, dwell: 0, speed: 0, trackPos: 0, airborne: false, idleSince: 0 };
  ctx.world.vehicles[id] = v;
  return v;
}

/** The farms, workshops and spazas carry their owners' names. */
export function nameAfterOwners(world: World): void {
  const people = alivePeople(world);
  for (const id of ['farm', 'nh-farm']) {
    const farmer = people.find((p) => p.job === 'farmer' && p.workplaceId === id);
    if (farmer && world.buildings[id]) world.buildings[id].name = id === 'farm' ? `${farmer.surname} Farm` : `${farmer.surname} Market Garden`;
  }
  for (const id of ['workshop', 'it-workshop']) {
    const builder = people.find((p) => p.job === 'builder' && p.workplaceId === id);
    if (builder && world.buildings[id]) world.buildings[id].name = id === 'workshop' ? `${builder.surname}'s Workshop` : `${builder.surname}'s Welding & Repairs`;
  }
  for (const id of SPAZA_IDS) {
    const keeper = people.find((p) => p.job === 'shopkeeper' && p.workplaceId === id);
    if (keeper && world.buildings[id]) world.buildings[id].name = id === 'nh-spaza' ? `${keeper.surname}'s Superette` : keeper.sex === 'F' ? `Mama ${keeper.firstName}'s Spaza` : `${keeper.surname}'s Spaza`;
  }
}

export { parkingSpot };

/** Compose one household of the given type; ages come from the age profile. */
export function composeHouseholdPublic(ctx: Ctx, hh: Household, type: HouseholdType, surname: string, eduMix?: EducationMix): void {
  composeHousehold(ctx, hh, type, surname, eduMix);
}

function composeHousehold(ctx: Ctx, hh: Household, type: HouseholdType, surname: string, eduMix?: EducationMix): void {
  const rng = ctx.rng.stream('population');
  const world = ctx.world;
  const day = world.day;
  const P = ctx.params;
  const young = P.ageProfile === 'young';
  const ageing = P.ageProfile === 'ageing';
  const faith = clamp(rng.normal(faithMeanFor(world.buildings[hh.houseId]?.community, P.churchAttendance), 0.08), 0.02, 0.995);
  hh.faith = faith;
  const kidsCount = () => Math.max(0, Math.round(rng.normal(young ? 2.4 : ageing ? 1.6 : 2.1, 1)));
  const makeCouple = (motherAge: number) => {
    const fatherAge = motherAge + clamp(rng.normal(3, 3), -4, 12);
    const mother = createPerson(ctx, { eduMix, sex: 'F', ageYears: motherAge, householdId: hh.id, surname, faith: clamp(faith + rng.normal(0, 0.08), 0.02, 0.99) });
    const father = createPerson(ctx, { eduMix, sex: 'M', ageYears: fatherAge, householdId: hh.id, surname, faith: clamp(faith + rng.normal(0, 0.08), 0.02, 0.99) });
    addMember(world, hh, father);
    addMember(world, hh, mother);
    marry(world, father, mother, day - Math.round(rng.range(1, 20) * DAYS_PER_YEAR));
    return { mother, father };
  };
  const makeKids = (mother: Person, father: Person | null, n: number, maxAge: number) => {
    if (maxAge < 0.3) return;
    let age = clamp(rng.range(0.45, 1) * Math.min(maxAge, 24), 0.3, maxAge);
    for (let i = 0; i < n; i++) {
      if (age < 0.3) break;
      const sex: Sex = rng.bernoulli(P.maleShareAtBirth) ? 'M' : 'F';
      const child = createPerson(ctx, { eduMix,
        sex,
        ageYears: age,
        householdId: hh.id,
        surname,
        big5: inheritBigFive(rng, mother.big5, father?.big5 ?? null),
        faith: clamp(faith + rng.normal(0, 0.1), 0.02, 0.99),
        bornHere: true,
        parentIds: [],
      });
      addMember(world, hh, child);
      addChild(world, mother, child, day);
      if (father) addChild(world, father, child, day);
      age -= rng.range(1.5, 4.5);
    }
  };
  switch (type) {
    case 'family': {
      const motherAge = clamp(rng.normal(young ? 33 : ageing ? 43 : 38, 8), 22, 54);
      const { mother, father } = makeCouple(motherAge);
      makeKids(mother, father, Math.max(1, kidsCount()), motherAge - 18);
      break;
    }
    case 'couple': {
      const motherAge = rng.bernoulli(0.5) ? clamp(rng.normal(27, 3), 21, 34) : clamp(rng.normal(52, 5), 45, 62);
      makeCouple(motherAge);
      break;
    }
    case 'singleParent': {
      const parentSex: Sex = rng.bernoulli(0.85) ? 'F' : 'M';
      const parentAge = clamp(rng.normal(36, 6), 24, 50);
      const parent = createPerson(ctx, { eduMix, sex: parentSex, ageYears: parentAge, householdId: hh.id, surname, faith });
      parent.marital = rng.bernoulli(0.45) ? 'widowed' : rng.bernoulli(0.6) ? 'divorced' : 'single';
      addMember(world, hh, parent);
      makeKids(parent, null, Math.max(1, Math.round(rng.normal(1.8, 0.8))), parentAge - 18);
      if (rng.bernoulli(0.5)) {
        // Grandmother lives in
        const gran = createPerson(ctx, { eduMix, sex: 'F', ageYears: parentAge + clamp(rng.normal(25, 4), 19, 34), householdId: hh.id, surname, faith: clamp(faith + 0.1, 0, 0.99) });
        gran.marital = 'widowed';
        addMember(world, hh, gran);
        addChild(world, gran, parent, day);
      }
      break;
    }
    case 'multigen': {
      const motherAge = clamp(rng.normal(34, 5), 24, 45);
      const { mother, father } = makeCouple(motherAge);
      makeKids(mother, father, Math.max(1, kidsCount()), motherAge - 18);
      const grandAge = motherAge + clamp(rng.normal(26, 4), 20, 34);
      const gran = createPerson(ctx, { eduMix, sex: 'F', ageYears: grandAge, householdId: hh.id, surname, faith: clamp(faith + 0.1, 0, 0.99) });
      addMember(world, hh, gran);
      addChild(world, gran, father, day);
      if (rng.bernoulli(0.55)) {
        const grandpa = createPerson(ctx, { eduMix, sex: 'M', ageYears: grandAge + clamp(rng.normal(3, 3), -3, 10), householdId: hh.id, surname, faith });
        addMember(world, hh, grandpa);
        marry(world, grandpa, gran, day - Math.round(35 * DAYS_PER_YEAR));
        addChild(world, grandpa, father, day);
      } else gran.marital = 'widowed';
      break;
    }
    case 'elderly': {
      const wifeAge = clamp(rng.normal(70, 5), 62, 84);
      const { mother } = makeCouple(wifeAge);
      if (rng.bernoulli(0.35)) {
        // an adult child still at home
        const kid = createPerson(ctx, { eduMix, sex: rng.bernoulli(0.5) ? 'M' : 'F', ageYears: clamp(wifeAge - rng.range(28, 40), 22, 45), householdId: hh.id, surname, big5: inheritBigFive(rng, mother.big5, null), faith, bornHere: true });
        addMember(world, hh, kid);
        addChild(world, mother, kid, day);
      }
      break;
    }
    case 'single': {
      const sex: Sex = rng.bernoulli(0.55) ? 'M' : 'F';
      const age = clamp(rng.normal(34, 9), 22, 68);
      const p = createPerson(ctx, { eduMix, sex, ageYears: age, householdId: hh.id, surname, faith });
      if (age > 50) p.marital = rng.bernoulli(0.6) ? 'widowed' : 'divorced';
      addMember(world, hh, p);
      break;
    }
  }
}

// ─── Jobs & schooling assignment ──────────────────────────────────────────

export function communityOfPerson(world: World, p: Person): CommunityId {
  const hh = world.households[p.householdId];
  return (hh && world.buildings[hh.houseId]?.community) || 'ebenezer';
}

export function cityOfPerson(world: World, p: Person): CityId {
  return cityOf(communityOfPerson(world, p));
}

export function tierOfPerson(world: World, p: Person): Tier {
  return tierOf(communityOfPerson(world, p));
}

/** The wealth profile a settlement's households are drawn from. */
export function profileFor(P: ScenarioParams, community: CommunityId | null | undefined): CommunityProfile {
  const tier = tierOf(community);
  return tier === 'civic' ? P.tiers.middle : P.tiers[tier];
}

/**
 * The fallback job mix of a settlement's adults by tier, after the essential
 * posts are filled: the estates run on executives and professionals, the
 * townships on piece work and the taxi rank.
 */
function jobMixFor(P: ScenarioParams, tier: Tier, canOffice: boolean, tertiary: boolean, postgrad: boolean, homemakerW: number): Array<[JobId, number]> {
  switch (tier) {
    case 'ultra':
      return [['executive', postgrad ? 0.32 : tertiary ? 0.12 : 0.01], ['engineer', tertiary ? 0.16 : 0.01], ['attorney', postgrad ? 0.1 : 0], ['accountant', tertiary ? 0.1 : 0], ['office', canOffice ? 0.2 : 0.04], ['homemaker', homemakerW], ['unemployed', P.tiers.ultra.unemployment]];
    case 'affluent':
      return [['office', canOffice ? 0.42 : 0.06], ['engineer', tertiary ? 0.14 : 0.01], ['accountant', tertiary ? 0.08 : 0], ['attorney', postgrad ? 0.06 : 0], ['executive', postgrad ? 0.06 : 0], ['homemaker', homemakerW], ['builder', 0.02], ['unemployed', P.tiers.affluent.unemployment]];
    case 'comfortable':
      return [['office', canOffice ? 0.5 : 0.08], ['engineer', tertiary ? 0.08 : 0.01], ['accountant', tertiary ? 0.05 : 0], ['vendor', 0.02], ['builder', 0.04], ['homemaker', homemakerW], ['unemployed', P.tiers.comfortable.unemployment]];
    case 'middle':
      return [['office', canOffice ? 0.32 : 0.05], ['homemaker', homemakerW], ['vendor', 0.12], ['farmhand', 0.12], ['builder', canOffice ? 0.05 : 0.1], ['unemployed', P.healthProfile === 'developed' ? 0.07 : P.tiers.middle.unemployment]];
    case 'working':
      return [['office', canOffice ? 0.15 : 0.03], ['homemaker', homemakerW * 0.9], ['vendor', 0.15], ['farmhand', 0.18], ['builder', canOffice ? 0.04 : 0.08], ['taxidriver', 0.04], ['busdriver', 0.02], ['ehailer', 0.03], ['unemployed', P.tiers.working.unemployment]];
    default:
      return [['office', canOffice ? 0.07 : 0.02], ['homemaker', homemakerW * 0.8], ['vendor', 0.16], ['farmhand', 0.2], ['builder', canOffice ? 0.03 : 0.06], ['taxidriver', 0.03], ['busdriver', 0.02], ['ehailer', 0.02], ['unemployed', P.tiers['low-income'].unemployment]];
  }
}

export function assignJobs(ctx: Ctx): void {
  const rng = ctx.rng.stream('population');
  const world = ctx.world;
  const P = ctx.params;
  const adults = alivePeople(world).filter((p) => p.age >= 18);
  const pool = rng.shuffle([...adults]);
  const taken = new Set<string>();
  const houseOf = (p: Person) => world.households[p.householdId];
  // Essential posts: choose the best-qualified available adult, preferring the
  // post's own settlement, then its own city, relaxing education if nobody
  // qualifies (a small city promotes from within). The centre's posts are open
  // to every city, so the hospital and the government draw from all three.
  for (const post of ESSENTIAL_POSTS()) {
    const spec = JOBS[post.job];
    const fromHere = (p: Person) => (!post.community || communityOfPerson(world, p) === post.community) && (!post.city || cityOfPerson(world, p) === post.city);
    const eligible = (p: Person) => !taken.has(p.id) && p.age < P.retirementAge && (!spec.sex || p.sex === spec.sex) && fromHere(p);
    let cand = pool.filter((p) => eligible(p) && p.age >= spec.minAge && eduAtLeast(p.education, spec.minEducation));
    if (!cand.length) cand = pool.filter((p) => eligible(p) && p.age >= Math.max(20, spec.minAge - 6));
    if (!cand.length && post.community) cand = pool.filter((p) => !taken.has(p.id) && p.age < P.retirementAge && (!spec.sex || p.sex === spec.sex) && (!post.city || cityOfPerson(world, p) === post.city) && p.age >= Math.max(20, spec.minAge - 6));
    if (!cand.length && (post.community || post.city)) cand = pool.filter((p) => !taken.has(p.id) && p.age < P.retirementAge && (!spec.sex || p.sex === spec.sex) && p.age >= Math.max(20, spec.minAge - 6));
    if (!cand.length) continue;
    // Prefer one essential earner per household so roles spread across the
    // region; the top of the ladder (the towers, the surgeons, the Reserve
    // Bank) is filled from the estates and the affluent suburbs before the
    // townships, as it would be.
    const wantsWealth = spec.income >= 50_000 && !post.community && !post.city;
    cand.sort((a, b) => (wantsWealth ? affluence(communityOfPerson(world, b)) - affluence(communityOfPerson(world, a)) : 0) || Number(hasEssential(houseOf(a), world)) - Number(hasEssential(houseOf(b), world)));
    const chosen = cand[0];
    if (!eduAtLeast(chosen.education, spec.minEducation)) chosen.education = spec.minEducation;
    setJob(ctx, chosen, post.job, post.workplace ?? undefined);
    taken.add(chosen.id);
  }
  // Everyone else
  for (const p of pool) {
    if (taken.has(p.id)) continue;
    if (p.age >= P.retirementAge) {
      setJob(ctx, p, 'retired');
      continue;
    }
    const hh = houseOf(p);
    const partner = p.partnerId ? world.people[p.partnerId] : null;
    const youngKids = hh.memberIds.map((id) => world.people[id]).filter((c) => c && c.age < 6).length;
    const canOffice = eduAtLeast(p.education, 'matric');
    const homemakerW = p.sex === 'F' && partner && (youngKids > 0 || rng.bernoulli(0.3)) ? 0.25 : 0.03;
    const job = rng.weighted<JobId>(jobMixFor(P, tierOfPerson(world, p), canOffice, eduAtLeast(p.education, 'tertiary'), eduAtLeast(p.education, 'postgrad'), homemakerW));
    setJob(ctx, p, job);
  }
  hireDomesticWorkers(ctx, rng, taken);
}

/**
 * The estates and the affluent suburbs hire domestic workers from the
 * working-class and low-income settlements — their own city's first, then
 * anyone's, since the taxis run — one each, paid through the books like any
 * employee.
 */
function hireDomesticWorkers(ctx: Ctx, rng: Rng, taken: Set<string>): void {
  const world = ctx.world;
  const richHomes = Object.values(world.households).filter((hh) => {
    if (hh.dissolvedDay) return false;
    const tier = tierOf(world.buildings[hh.houseId]?.community);
    return (tier === 'ultra' || tier === 'affluent') && householdIncome(world, hh) > 45_000;
  });
  const cands = alivePeople(world).filter((p) => {
    const tier = tierOfPerson(world, p);
    return !taken.has(p.id) && p.age >= 18 && p.age < 60 && (p.job === 'unemployed' || p.job === 'homemaker') && (tier === 'working' || tier === 'low-income');
  });
  for (const hh of richHomes) {
    if (!cands.length) break;
    if (!rng.bernoulli(0.75)) continue;
    const city = cityOf(world.buildings[hh.houseId]?.community);
    const i = Math.max(0, cands.findIndex((p) => cityOfPerson(world, p) === city));
    const w = cands.splice(i, 1)[0];
    setJob(ctx, w, 'domestic', hh.houseId);
    taken.add(w.id);
  }
}

function hasEssential(hh: Household | undefined, world: World): boolean {
  if (!hh) return false;
  return hh.memberIds.some((id) => {
    const j = world.people[id]?.job;
    return j && JOBS[j].essential > 0 && world.people[id].workplaceId;
  });
}

/**
 * Pay scale by post: the spaza is a survivalist owner-operation and the market
 * and deli pay managers below the notional scale, matching QLFS retail medians.
 */
export function payScaleFor(job: JobId, workplaceId: string | null): number {
  if (job === 'shopkeeper' && workplaceId && SPAZA_IDS.includes(workplaceId)) return 0.32;
  if (job === 'shopkeeper' && workplaceId && MARKET_IDS.includes(workplaceId)) return 0.7;
  if (job === 'shopkeeper' && workplaceId && DELI_IDS.includes(workplaceId)) return 0.9;
  // The settlement counters open mornings only; Ebenezer's is the head office.
  if (job === 'banker' && workplaceId && COUNTER_IDS.includes(workplaceId)) return 0.65;
  return 1;
}

export function setJob(ctx: Ctx, p: Person, job: JobId, workplaceId?: string | null): void {
  const rng = ctx.rng.stream('population');
  p.job = job;
  p.workplaceId = workplaceId !== undefined ? workplaceId : JOBS[job].workplace === null ? null : defaultWorkplace(ctx.world, p, job);
  p.income = Math.round(incomeFor(rng, job, p.education, p.age) * payScaleFor(job, p.workplaceId));
}

export function assignSchooling(ctx: Ctx, p: Person): void {
  const hh = ctx.world.households[p.householdId];
  if (p.age < 5) p.schooling = 'none';
  else if (p.age < 6) p.schooling = 'preschool';
  else if (p.age < 18 && !(p.age >= 17 && p.education === 'matric')) p.schooling = hh?.homeschool ? 'homeschool' : 'school';
  else p.schooling = 'none';
  if (p.age >= 5 && p.age < 18) p.job = 'student';
  if (p.age < 5) p.job = 'child';
}

export function decideHomeschool(ctx: Ctx, hh: Household): void {
  const rng = ctx.rng.stream('population');
  const world = ctx.world;
  const members = hh.memberIds.map((id) => world.people[id]);
  const kids = members.filter((p) => p.age >= 6 && p.age < 18);
  if (!kids.length) {
    hh.homeschool = false;
    return;
  }
  const hasHomeParent = members.some((p) => p.age >= 18 && (p.job === 'homemaker' || p.job === 'teacher' || p.job === 'pastor'));
  const educated = members.some((p) => p.age >= 18 && eduAtLeast(p.education, 'tertiary'));
  let pHome = ctx.params.homeschoolShare;
  if (hasHomeParent) pHome *= 2.2;
  if (educated) pHome *= 1.4;
  if (hh.faith > 0.85) pHome *= 1.3;
  hh.homeschool = rng.bernoulli(clamp(pHome, 0, 0.9));
}

// ─── Social fabric ────────────────────────────────────────────────────────

export function seedRelationships(ctx: Ctx): void {
  const rng = ctx.rng.stream('social');
  const world = ctx.world;
  const people = alivePeople(world);
  const day = world.day;
  // Neighbours: adjacent plots
  const byPlot = new Map<number, Household>();
  for (const id in world.households) {
    const hh = world.households[id];
    const house = world.buildings[hh.houseId];
    if (house?.plot) byPlot.set(house.plot, hh);
  }
  for (const [plot, hh] of byPlot) {
    for (const other of [byPlot.get(plot + 1), byPlot.get(plot - 1)]) {
      if (!other) continue;
      for (const a of hh.memberIds) for (const b of other.memberIds) if (world.people[a].age >= 12 && world.people[b].age >= 12 && !world.people[a].relationships[b]) link(world, a, b, 'neighbour', 'neighbour', rng.range(0.1, 0.5), day);
    }
  }
  // Colleagues
  const byWork = new Map<string, Person[]>();
  for (const p of people) if (p.workplaceId) (byWork.get(p.workplaceId) ?? byWork.set(p.workplaceId, []).get(p.workplaceId)!).push(p);
  for (const group of byWork.values()) for (const a of group) for (const b of group) if (a !== b && !a.relationships[b.id]) link(world, a.id, b.id, 'colleague', 'colleague', rng.range(0.2, 0.6), day);
  // Friends: 1-4 per person, same life-stage band, personality similarity
  for (const p of people) {
    if (p.age < 4) continue;
    const n = 1 + Math.round(3 * (0.65 * p.big5.E + 0.35 * p.big5.A) * rng.next());
    const cands = people.filter((q) => q !== p && q.householdId !== p.householdId && Math.abs(q.age - p.age) <= (p.age < 18 ? 3 : 12) && !p.relationships[q.id]);
    rng.shuffle(cands);
    for (const q of cands.slice(0, n)) link(world, p.id, q.id, 'friend', 'friend', rng.range(0.3, 0.8), day);
  }
  // Grandparents ↔ grandchildren (through parent links)
  for (const p of people) {
    for (const pid of p.parentIds) {
      const parent = world.people[pid];
      if (!parent) continue;
      for (const gid of parent.parentIds) {
        if (world.people[gid] && !p.relationships[gid]) link(world, gid, p.id, 'grandchild', 'grandparent', 0.7, day);
      }
    }
  }
}

// ─── Whole-community build ────────────────────────────────────────────────

export function populateCommunity(ctx: Ctx): void {
  const rng = ctx.rng.stream('population');
  const world = ctx.world;
  const P = ctx.params;
  const houses = Object.values(world.buildings)
    .filter((b) => b.kind === 'house')
    .sort((a, b) => (a.plot ?? 0) - (b.plot ?? 0));
  // Occupy plots in a fixed, spread-out order per settlement so vacant plots
  // are interleaved. Ebenezer's count is the `households` parameter and its
  // households draw on the baseline education mix; every other settlement
  // takes its tier's profile. The low-income townships seed young.
  const seed: Array<{ order: number[]; count: number; mix: EducationMix; ageProfile: AgeProfileId }> = COMMUNITIES.filter((c) => c.tier !== 'civic').map((c) => ({
    order: c.seedOrder,
    count: c.id === 'ebenezer' ? P.households : Math.min(c.seedHouseholds, c.seedOrder.length),
    mix: c.id === 'ebenezer' ? P.educationMix : P.tiers[c.tier as Exclude<Tier, 'civic'>].educationMix,
    ageProfile: c.tier === 'low-income' ? 'young' : P.ageProfile,
  }));
  const surnames = new Set<string>();
  for (const grp of seed) {
    const weights = householdTypeWeights(grp.ageProfile);
    let placed = 0;
    for (const plot of grp.order) {
      if (placed >= grp.count) break;
      const house = houses.find((b) => b.plot === plot);
      if (!house) continue;
      placed++;
      const surname = pickSurname(rng, surnames);
      surnames.add(surname);
      const hh = newHousehold(ctx, surname, house.id, world.day);
      const type = rng.weighted(weights);
      composeHousehold(ctx, hh, type, surname, grp.mix);
      house.name = `${surname} home`;
    }
  }
  // The farm carries the farmer's name, the workshop the builder's — set after jobs.
  assignJobs(ctx);
  for (const id in world.households) {
    const hh = world.households[id];
    decideHomeschool(ctx, hh);
    for (const pid of hh.memberIds) assignSchooling(ctx, world.people[pid]);
    // Economics at t0, shaped by the settlement's wealth profile (Ebenezer's is the baseline)
    const com = world.buildings[hh.houseId]?.community ?? 'ebenezer';
    const prof = com === 'ebenezer' ? null : profileFor(P, com);
    const [sLo, sHi] = prof?.savingsMonths ?? [0.5, 6];
    hh.savings = Math.round(rng.range(sLo, sHi) * Math.max(3000, householdIncome(world, hh)));
    hh.insurance.funeral = rng.bernoulli(prof?.funeralCoverShare ?? P.funeralCoverShare);
    hh.insurance.life = rng.bernoulli(prof?.lifeCoverShare ?? P.lifeCoverShare);
    hh.insurance.medical = rng.bernoulli((prof?.medicalAidShare ?? P.medicalAidShare) * (householdIncome(world, hh) > 25_000 ? 1.6 : 0.6));
    // The family car — and, in the settlements that run to them, a car of their own for the other drivers.
    const drivers = hh.memberIds.map((p) => world.people[p]).filter((p) => p.age >= 18 && p.age < 80);
    if (drivers.length && rng.bernoulli((prof?.carOwnership ?? P.carOwnership) * (householdIncome(world, hh) > 15_000 ? 1.3 : 0.6))) {
      const house = world.buildings[hh.houseId];
      const park = parkingSpot(house);
      const v = createVehicle(ctx, hh.id, rng.bernoulli(0.3) ? 'bakkie' : 'car', park.x, park.y);
      hh.vehicleId = v.id;
      for (const d of drivers) d.driver = true;
      const secondCar = prof?.secondCarShare ?? P.tiers.affluent.secondCarShare;
      for (let i = 1; i < drivers.length; i++) {
        if (!rng.bernoulli(secondCar)) continue;
        const at = yardSlot(park, 1 + hh.extraVehicleIds.length);
        const own = createVehicle(ctx, hh.id, 'car', at.x, at.y);
        hh.extraVehicleIds.push(own.id);
      }
    }
  }
  nameAfterOwners(world);
  seedRelationships(ctx);
  // Service vehicles: a patrol car at every station, an ambulance at every
  // clinic, two at the hospital's EMS station and one at the airport, a fleet
  // of minibus taxis at every rank — then the buses, the trains and the planes.
  for (const id of POLICE_IDS) {
    const bay = roomByKind(world.buildings[id], 'garage')?.spots[0];
    if (bay) createVehicle(ctx, null, 'police', bay.x, bay.y, id);
  }
  for (const base of AMBULANCE_BASES) {
    const b = world.buildings[base.id];
    const bay = roomByKind(b, 'garage');
    for (let i = 0; i < base.n; i++) {
      const s = bay?.spots[i];
      createVehicle(ctx, null, 'ambulance', s?.x ?? b.entrance.x + 8 + i * 6, s?.y ?? b.entrance.y + (b.entrance.y <= b.y ? -6 : 6), base.id);
    }
  }
  for (const id of TAXI_RANK_IDS) {
    const r = world.buildings[id];
    const yard = roomByKind(r, 'garage');
    // In the yard in two rows, side by side, facing east.
    const cx = yard ? yard.x + yard.w / 2 : r.x + r.w / 2;
    const cy = yard ? yard.y + yard.h / 2 : r.y + r.h / 2;
    for (let i = 0; i < TAXIS_PER_RANK; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      createVehicle(ctx, null, 'taxi', cx + (col - 0.5) * 8, cy + (row - (TAXIS_PER_RANK / 2 - 1) / 2) * 3.4, id);
    }
  }
  seedTransit(ctx, (kind, x, y, baseId) => createVehicle(ctx, null, kind, x, y, baseId));
  refreshRoles(world);
  formCouncil(ctx);
  // Place everyone at home in bed to start (the scheduler moves them at 00:00 + plan).
  for (const p of alivePeople(world)) {
    const house = world.buildings[world.households[p.householdId].houseId];
    const bed = roomByKind(house, 'bedroom');
    const s = bed?.spots[0];
    p.loc = { x: s?.x ?? house.x + 20, y: s?.y ?? house.y + 30, buildingId: house.id, roomId: bed?.id ?? null, spotId: s?.id ?? null };
  }
  // Wire baseline life events
  for (const p of alivePeople(world)) p.history.push({ day: world.day, kind: 'household', text: `Living at ${world.buildings[world.households[p.householdId].houseId].name} with the ${world.households[p.householdId].name} household.` });
}

export function householdIncome(world: World, hh: Household): number {
  return hh.memberIds.reduce((s, id) => s + (world.people[id]?.alive && !world.people[id]?.emigrated ? world.people[id].income : 0), 0);
}

export function refreshRoles(world: World): void {
  const people = alivePeople(world);
  // Prefer someone present: these ids drive preaching, mediation, policing and
  // the bench, so they must point at a person who can turn up.
  const present = people.filter((p) => !p.away);
  const find = (job: JobId, wp?: string) => present.find((p) => p.job === job && (!wp || p.workplaceId === wp))?.id ?? null;
  const all = (job: JobId, wp?: string) => present.filter((p) => p.job === job && (!wp || p.workplaceId === wp)).map((p) => p.id);
  const pastorByChurch: Record<string, string | null> = {};
  for (const churchId of CHURCH_IDS) pastorByChurch[churchId] = find('pastor', churchId);
  const doctorByClinic: Record<string, string | null> = {};
  for (const id of CLINIC_IDS) doctorByClinic[id] = find('doctor', id);
  const dmoByCity: Record<string, string | null> = {};
  for (const c of CITIES) if (c.kind === 'city') dmoByCity[c.id] = find('dmo', landmark(residentialOf(c.id)[0], 'medical'));
  const magistrateByCourt: Record<string, string | null> = {};
  for (const id of COURT_IDS) magistrateByCourt[id] = find('magistrate', id);
  const policeByStation: Record<string, string[]> = {};
  for (const id of POLICE_IDS) policeByStation[id] = all('police', id);
  world.roles = {
    pastorId: pastorByChurch.church ?? find('pastor'),
    doctorId: doctorByClinic.clinic ?? find('doctor'),
    dmoId: dmoByCity.emmaus ?? find('dmo'),
    nurseIds: all('nurse'),
    policeIds: all('police'),
    magistrateId: magistrateByCourt.court ?? find('magistrate'),
    teacherIds: all('teacher'),
    pastorByChurch,
    doctorByClinic,
    dmoByCity,
    magistrateByCourt,
    policeByStation,
    surgeonIds: all('surgeon'),
  };
}

// ─── The city councils ────────────────────────────────────────────────────
//
// Each city elects six portfolio seats modelled on the Scelo council —
// finance, accounts & audit, risk & actuarial, legal, community wellbeing and
// an independent red team — plus its District Medical Officer ex officio for
// health. Selection is by aptitude (job, education, personality) from the
// city's own residents, with a representation rule: every settlement holds at
// least one elected seat and none holds more than three. The magistrates never
// sit (separation of powers), and neither does a DMO in an elected seat.

export const COUNCIL_TITLES: Record<CouncilRole, string> = {
  finance: 'Finance & investment',
  accountant: 'Accounts & audit',
  actuary: 'Risk & actuarial',
  lawyer: 'Legal & governance',
  psychologist: 'Community wellbeing',
  redteam: 'Independent challenge (red team)',
  health: 'Health (District Medical Officer, ex officio)',
};

const ELECTED_ROLES: CouncilRole[] = ['finance', 'accountant', 'actuary', 'lawyer', 'psychologist', 'redteam'];

function councilScore(role: CouncilRole, p: Person): number {
  const edu = eduRank(p.education);
  let score = edu * 0.5 + clamp((p.age - 30) / 30, 0, 1);
  switch (role) {
    case 'finance':
      if (p.job === 'banker' || p.job === 'combanker') score += 4;
      else if (p.job === 'accountant') score += 3;
      else if (p.job === 'office') score += 1.5;
      break;
    case 'accountant':
      if (p.job === 'accountant') score += 5;
      else if ((p.job === 'banker' || p.job === 'combanker' || p.job === 'office') && eduAtLeast(p.education, 'tertiary')) score += 2;
      break;
    case 'actuary':
      if (eduAtLeast(p.education, 'postgrad')) score += 3;
      else if (eduAtLeast(p.education, 'tertiary')) score += 1;
      if (p.job === 'accountant' || p.job === 'combanker' || p.job === 'banker' || p.job === 'teacher') score += 2;
      score += p.big5.C + p.big5.O;
      break;
    case 'lawyer':
      if (p.job === 'attorney') score += 5;
      else if (p.job === 'clerk') score += 2;
      break;
    case 'psychologist':
      if (eduAtLeast(p.education, 'tertiary')) score += 2;
      score += p.big5.A * 2 + p.big5.E * 0.5;
      if (p.job === 'nurse' || p.job === 'teacher' || p.job === 'pastor') score += 1.5;
      break;
    case 'redteam':
      if (!eduAtLeast(p.education, 'matric')) return -Infinity;
      score += p.big5.O * 2 + (1 - p.big5.A) * 1.5 + p.big5.C * 0.5;
      break;
    case 'health':
      return p.job === 'dmo' ? 10 : -Infinity;
  }
  return score;
}

function councilEligible(world: World, p: Person, taken: Set<string>): boolean {
  return p.alive && !p.emigrated && !taken.has(p.id) && p.age >= 25 && p.age <= 72 && p.job !== 'magistrate' && p.job !== 'dmo';
}

function bestFor(world: World, role: CouncilRole, taken: Set<string>, city: CityId, community?: CommunityId): { p: Person; score: number } | null {
  let best: { p: Person; score: number } | null = null;
  for (const p of alivePeople(world)) {
    if (!councilEligible(world, p, taken)) continue;
    if (cityOfPerson(world, p) !== city) continue;
    if (community && communityOfPerson(world, p) !== community) continue;
    const score = councilScore(role, p);
    if (score === -Infinity) continue;
    // Ties break on person id so the outcome is independent of iteration whims.
    if (!best || score > best.score || (score === best.score && p.id < best.p.id)) best = { p, score };
  }
  return best;
}

function seatCounts(seats: CouncilSeat[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of seats) if (s.personId && s.community) counts[s.community] = (counts[s.community] ?? 0) + 1;
  return counts;
}

/** The cities that elect a council. */
const COUNCIL_CITIES: CityId[] = CITIES.filter((c) => c.kind === 'city').map((c) => c.id);

/** Build one city's council from scratch. */
function formCityCouncil(ctx: Ctx, city: CityId): CouncilSeat[] {
  const world = ctx.world;
  const day = world.day;
  const residential = residentialOf(city);
  const taken = new Set<string>();
  for (const s of world.council) if (s.city !== city && s.personId) taken.add(s.personId);
  const seats: CouncilSeat[] = [];
  for (const role of ELECTED_ROLES) {
    const pick = bestFor(world, role, taken, city);
    seats.push({ city, role, title: COUNCIL_TITLES[role], personId: pick?.p.id ?? null, community: pick ? communityOfPerson(world, pick.p) : null, sinceDay: day });
    if (pick) taken.add(pick.p.id);
  }
  // Representation repair: every settlement at least one elected seat…
  for (let guard = 0; guard < 6; guard++) {
    const counts = seatCounts(seats);
    const missing = residential.find((c) => !counts[c]);
    if (!missing) break;
    // …by re-awarding the weakest seat of the best-represented settlement.
    const donor = [...seats].filter((s) => s.personId && s.community && (counts[s.community] ?? 0) > 1).sort((a, b) => councilScore(a.role, world.people[a.personId!]) - councilScore(b.role, world.people[b.personId!]))[0];
    if (!donor) break;
    const cand = bestFor(world, donor.role, taken, city, missing);
    if (!cand) break;
    if (donor.personId) taken.delete(donor.personId);
    donor.personId = cand.p.id;
    donor.community = missing;
    donor.sinceDay = day;
    taken.add(cand.p.id);
  }
  // …and none more than three.
  for (let guard = 0; guard < 6; guard++) {
    const counts = seatCounts(seats);
    const over = residential.find((c) => (counts[c] ?? 0) > 3);
    if (!over) break;
    const donor = [...seats].filter((s) => s.personId && s.community === over).sort((a, b) => councilScore(a.role, world.people[a.personId!]) - councilScore(b.role, world.people[b.personId!]))[0];
    if (!donor) break;
    const under = residential.filter((c) => (counts[c] ?? 0) < 3 && c !== over);
    let swapped = false;
    for (const c of under) {
      const cand = bestFor(world, donor.role, taken, city, c);
      if (cand) {
        if (donor.personId) taken.delete(donor.personId);
        donor.personId = cand.p.id;
        donor.community = c;
        donor.sinceDay = day;
        taken.add(cand.p.id);
        swapped = true;
        break;
      }
    }
    if (!swapped) break;
  }
  const dmoId = world.roles.dmoByCity[city] ?? null;
  const dmo = dmoId ? world.people[dmoId] : null;
  seats.push({ city, role: 'health', title: COUNCIL_TITLES.health, personId: dmo?.id ?? null, community: dmo ? communityOfPerson(world, dmo) : null, sinceDay: day });
  return seats;
}

/** Build every city's council from scratch (at t0, or if they ever empty out). */
export function formCouncil(ctx: Ctx): void {
  const world = ctx.world;
  world.council = [];
  for (const city of COUNCIL_CITIES) {
    const seats = formCityCouncil(ctx, city);
    world.council.push(...seats);
    const named = seats.filter((s) => s.personId).map((s) => `${fullName(world.people[s.personId!])} (${COUNCIL_TITLES[s.role]}, ${world.buildings[world.households[world.people[s.personId!].householdId]?.houseId ?? '']?.community ?? '—'})`);
    ctx.emit({ kind: 'household', severity: 'info', text: `The ${CITIES.find((c) => c.id === city)!.name} council is constituted: ${named.join('; ')}.`, buildingId: COUNCIL_IDS[city] ?? undefined });
  }
}

/** Fill vacated seats (death, emigration); keeps the representation rule as far as candidates allow. */
export function refreshCouncil(ctx: Ctx): void {
  const world = ctx.world;
  if (!world.council.length) {
    if (Object.keys(world.people).length) formCouncil(ctx);
    return;
  }
  const taken = new Set<string>();
  for (const s of world.council) if (s.personId && world.people[s.personId]?.alive && !world.people[s.personId]?.emigrated) taken.add(s.personId);
  for (const seat of world.council) {
    const holder = seat.personId ? world.people[seat.personId] : null;
    const cityDmo = world.roles.dmoByCity[seat.city] ?? null;
    if (holder && holder.alive && !holder.emigrated && (seat.role !== 'health' || holder.id === cityDmo)) continue;
    if (seat.role === 'health') {
      const dmo = cityDmo ? world.people[cityDmo] : null;
      seat.personId = dmo?.id ?? null;
      seat.community = dmo ? communityOfPerson(world, dmo) : null;
      seat.sinceDay = world.day;
      continue;
    }
    const residential = residentialOf(seat.city);
    const counts = seatCounts(world.council.filter((x) => x !== seat && x.city === seat.city && ELECTED_ROLES.includes(x.role)));
    const missing = residential.find((c) => !counts[c]);
    const pick = (missing ? bestFor(world, seat.role, taken, seat.city, missing) : null) ?? bestFor(world, seat.role, taken, seat.city);
    if (seat.personId) taken.delete(seat.personId);
    seat.personId = pick?.p.id ?? null;
    seat.community = pick ? communityOfPerson(world, pick.p) : null;
    seat.sinceDay = world.day;
    if (pick) {
      taken.add(pick.p.id);
      ctx.emit({ kind: 'household', severity: 'info', text: `${fullName(pick.p)} takes the ${CITIES.find((c) => c.id === seat.city)!.name} council's ${COUNCIL_TITLES[seat.role]} seat.`, personIds: [pick.p.id], buildingId: COUNCIL_IDS[seat.city] ?? undefined });
    }
  }
}

export function councilSeatOf(world: World, personId: string): CouncilSeat | null {
  return world.council.find((s) => s.personId === personId) ?? null;
}

/** One city's council seats. */
export function councilOf(world: World, city: CityId): CouncilSeat[] {
  return world.council.filter((s) => s.city === city);
}

export { fullName };
