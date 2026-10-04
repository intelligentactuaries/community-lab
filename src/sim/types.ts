// The entity model. Everything here is plain data (no classes, no Maps) so a
// world can be structured-cloned to the renderer, JSON-serialised to disk,
// and diffed in tests. See docs/ODD.md §2 "Entities, state variables, scales".

import type { FinanceState } from './finance/state';
import type { Heritage } from './heritage';
import type { Season } from './time';

export type Sex = 'M' | 'F';

/** Big Five (OCEAN), each in [0,1]. */
export interface BigFive {
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
}

/**
 * Dominant-trait archetype. The SHAPE is the archetype's visual identity
 * (inspired by Dellinger's Psycho-Geometrics, where shape = communication
 * style) while the underlying model stays the Big Five.
 */
/**
 * The region: three cities, each of three settlements around a civic centre,
 * and the shared centre between them (the CBD, the recreation precinct and
 * the hospital campus). A settlement's id is a key; its wealth is its tier.
 */
export type CityId = 'emmaus' | 'newhaven' | 'ithemba' | 'unity' | 'airport';
export type CommunityId =
  | 'ebenezer' | 'hebron' | 'kanana' | 'crossing'
  | 'bellevue' | 'oakdale' | 'westbrook' | 'central'
  | 'bethesda' | 'siyakha' | 'nazareth' | 'crossroads'
  | 'cbd' | 'precinct' | 'campus' | 'airfield';
/** Wealth profile of a settlement (see params.tiers); 'civic' zones have no households. */
export type Tier = 'ultra' | 'affluent' | 'comfortable' | 'middle' | 'working' | 'low-income' | 'civic';

export type Archetype = 'harmoniser' | 'organiser' | 'driver' | 'thinker' | 'sentinel' | 'balanced';
export type Shape = 'circle' | 'square' | 'triangle' | 'hexagon' | 'diamond' | 'pentagon';

export type LifeStage = 'infant' | 'toddler' | 'child' | 'teen' | 'youngAdult' | 'adult' | 'middleAge' | 'senior' | 'elder';
export type Education = 'none' | 'primary' | 'secondary' | 'matric' | 'tertiary' | 'postgrad';
export type Schooling = 'none' | 'preschool' | 'school' | 'homeschool' | 'tertiary';
export type JobId =
  | 'pastor'
  | 'doctor'
  | 'nurse'
  | 'teacher'
  | 'police'
  | 'magistrate'
  | 'clerk'
  | 'shopkeeper'
  | 'vendor'
  | 'farmer'
  | 'farmhand'
  | 'builder'
  | 'office'
  | 'banker'
  | 'attorney'
  | 'accountant'
  | 'dmo'
  | 'combanker'
  | 'taxidriver'
  | 'domestic'
  | 'surgeon'
  | 'executive'
  | 'engineer'
  | 'civilservant'
  | 'centralbanker'
  | 'librarian'
  | 'pilot'
  | 'busdriver'
  | 'ehailer'
  | 'homemaker'
  | 'unemployed'
  | 'retired'
  | 'student'
  | 'child';

/** District council portfolios: the Scelo council, sized for a small district, plus health ex officio. */
export type CouncilRole = 'finance' | 'accountant' | 'actuary' | 'lawyer' | 'psychologist' | 'redteam' | 'health';

export interface CouncilSeat {
  /** Which city's council the seat belongs to. */
  city: CityId;
  role: CouncilRole;
  /** Human-readable portfolio name. */
  title: string;
  personId: string | null;
  /** Community the holder lives in (kept for the representation rule and analytics). */
  community: CommunityId | null;
  sinceDay: number;
}

export type MaritalStatus = 'single' | 'courting' | 'engaged' | 'married' | 'divorced' | 'widowed';
export type HealthState = 'healthy' | 'ill' | 'injured' | 'critical' | 'recovering';
export type ConditionId = 'hypertension' | 'diabetes' | 'hiv-on-art' | 'hiv-untreated' | 'asthma' | 'copd' | 'cvd' | 'disability';

export type IllnessKind =
  | 'flu'
  | 'cold'
  | 'gastro'
  | 'pneumonia'
  | 'tb'
  | 'malaria'
  | 'injury'
  | 'fracture'
  | 'heart'
  | 'stroke'
  | 'cancer'
  | 'childhood'
  | 'pregnancy-complication'
  | 'covid';

export interface Illness {
  id: string;
  kind: IllnessKind;
  name: string;
  onsetDay: number;
  /** Planned natural course in days (may end early with treatment). */
  durationDays: number;
  /** 0..1 — drives symptoms, hospital need and case fatality. */
  severity: number;
  contagious: boolean;
  treated: boolean;
  hospitalised: boolean;
  /** Daily probability of death while the illness is active, after treatment effects. */
  dailyFatality: number;
}

export interface Relationship {
  kind: 'spouse' | 'partner' | 'parent' | 'child' | 'sibling' | 'grandparent' | 'grandchild' | 'friend' | 'colleague' | 'neighbour' | 'acquaintance' | 'rival';
  /** -1..1 affinity. */
  strength: number;
  since: number; // day
  lastInteraction: number; // day
}

export interface Pregnancy {
  conceivedDay: number;
  dueDay: number;
  fatherId: string | null;
  twins: boolean;
}

export interface Grief {
  forId: string;
  forName: string;
  untilDay: number;
  intensity: number; // 0..1
}

export type ActivityKind =
  | 'council'
  | 'sleep'
  | 'wake'
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'work'
  | 'school'
  | 'homeschool'
  | 'church'
  | 'fellowship'
  | 'biblestudy'
  | 'youth'
  | 'choir'
  | 'shop'
  | 'visit'
  | 'play'
  | 'sport'
  | 'rest'
  | 'chores'
  | 'clinic'
  | 'hospital'
  | 'court'
  | 'funeral'
  | 'wedding'
  | 'celebration'
  | 'match'
  | 'concert'
  | 'flight'
  | 'patrol'
  | 'travel'
  | 'idle'
  | 'away';

export interface Activity {
  kind: ActivityKind;
  /** Minutes of the day (0..1440) — a plan is one day. */
  start: number;
  end: number;
  buildingId: string;
  roomId?: string;
  label: string;
  /** Companions (for visits / play) — informational, drives conversations. */
  withIds?: string[];
  /** This person is leading the gathering (the pulpit is theirs, not any pastor's) — or is here to mind a child, and cannot be booked twice. */
  role?: 'lead' | 'minder';
  /** A day trip by air: wheels-up and back-on-the-ground minutes from the timetable. */
  flight?: { dep: number; ret: number };
  /** The patient is fetched by ambulance rather than making their own way. */
  ambulance?: boolean;
}

export interface Location {
  x: number;
  y: number;
  buildingId: string | null;
  roomId: string | null;
  spotId: string | null;
}

export interface LifeEvent {
  day: number;
  kind: EventKind;
  text: string;
}

export interface PersonHealth {
  state: HealthState;
  /** 0..1 general robustness; falls with age, illness, poverty, grief. */
  vitality: number;
  illnesses: Illness[];
  conditions: ConditionId[];
  /** Day the person last saw a doctor. */
  lastClinicDay: number;
  /** Days remaining of hospital admission (0 when not admitted). */
  hospitalDaysLeft: number;
  /** Days of bed rest still needed at home. */
  restDaysLeft: number;
  /** Cumulative hospital admissions (analytics). */
  admissions: number;
  /** Where an inpatient lies: the city clinic's ward, or the central hospital for a referral. */
  hospitalId: string | null;
  /** The day of the current admission (the ambulance fetches them that morning). */
  admittedDay: number;
}

export interface Person {
  id: string;
  firstName: string;
  surname: string;
  /** The people of the family they were born into (from their birth surname; it stays when a surname changes at marriage). */
  heritage?: Heritage;
  sex: Sex;
  /** Absolute day index of birth (negative = born before the scenario start). */
  birthDay: number;
  /** Cached whole years, refreshed daily. */
  age: number;
  stage: LifeStage;
  householdId: string;
  big5: BigFive;
  archetype: Archetype;
  shape: Shape;
  education: Education;
  schooling: Schooling;
  job: JobId;
  workplaceId: string | null;
  /** Monthly gross income, ZAR. */
  income: number;
  marital: MaritalStatus;
  partnerId: string | null;
  parentIds: string[];
  childIds: string[];
  health: PersonHealth;
  /** -1..1. */
  mood: number;
  /** 0..1 */
  stress: number;
  /** 0..1, rebuilt by sleep. */
  energy: number;
  /** 0..1 religious commitment — church attendance, mediation response. */
  faith: number;
  /** -1..1 community standing. */
  reputation: number;
  criminalRecord: number;
  pregnancy: Pregnancy | null;
  grief: Grief | null;
  relationships: Record<string, Relationship>;
  loc: Location;
  /** Today's plan (rebuilt every day). */
  plan: Activity[];
  /** Index into plan of the activity in progress. */
  planIdx: number;
  /** Pathing target and waypoints in world metres (micro mode). */
  target: { x: number; y: number; buildingId: string | null; roomId: string | null; spotId: string | null } | null;
  path: Array<{ x: number; y: number }>;
  /** True while riding in a vehicle (hidden from the walking layer). */
  inVehicleId: string | null;
  /** True for licensed adult drivers in a household with a car. */
  driver: boolean;
  /** Facing angle (radians) for rendering. */
  heading: number;
  conversationId: string | null;
  alive: boolean;
  deathDay: number | null;
  causeOfDeath: string | null;
  /** Left the community (study / work / marriage elsewhere). */
  emigrated: boolean;
  history: LifeEvent[];
  /** Days until the courtship can progress (rate-limits romance events). */
  romanceCooldown: number;
  /** Minutes remaining in the current micro-activity idle wander. */
  wanderTimer: number;
  /** Renders as a small "!" when > 0 (just involved in an incident). */
  alertTimer: number;
  bornHere: boolean;
  /**
   * Day they became a resident of the province: day 0 for the founding population, the day of birth for a baby
   * born here, the day of arrival for anyone who moved in. With leftDay and deathDay it bounds the days they are
   * exposed to risk, which is how the experience exports (experience.ts) are built, person by person.
   */
  arrivedDay: number;
  /** Day they emigrated; null while resident, and for anyone who died here. */
  leftDay: number | null;
  /** Temporarily off the map (prison, city hospital, study leave) — day of return. */
  away: { untilDay: number; reason: string } | null;
  /** Days since last birth for the mother (null = never). */
  lastBirthDay: number | null;
  /** Counts of interactions today (micro mode) for relationship upkeep. */
  socialToday: number;
  /** Standing at the gate for the minibus taxi or ambulance with this id. */
  waitingFor: string | null;
  /** Waiting at a stop for the next bus or train of this line, and the stop to get off at. */
  waitingLine: string | null;
  alightAt: string | null;
  /** Minutes stood at the stop so far; past a limit they give up and take a taxi or walk. */
  waitedMin: number;
}

export interface Household {
  id: string;
  name: string;
  houseId: string;
  memberIds: string[];
  headId: string | null;
  /** ZAR: deposits at the Mutual Bank (mirror of the household's ledger). */
  savings: number;
  /** ZAR: outstanding loans from the Mutual Bank. */
  debt: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  /** The family car. */
  vehicleId: string | null;
  /** Individual cars beyond the family one, in the households that run to them. */
  extraVehicleIds: string[];
  insurance: { funeral: boolean; life: boolean; medical: boolean };
  homeschool: boolean;
  /** Month-level economics history for the household chart. */
  faith: number;
  formedDay: number;
  dissolvedDay: number | null;
  /** Below the poverty line last month. */
  poor: boolean;
  /** Months of arrears on scheme premiums (lapses at 3). */
  arrears: number;
  /** Monthly ledger for the household chart. */
  ledger: Array<{ month: number; income: number; expenses: number; savings: number; tax: number; debt: number }>;
}

export type BuildingKind =
  | 'house'
  | 'church'
  | 'school'
  | 'clinic'
  | 'police'
  | 'court'
  | 'market'
  | 'hall'
  | 'farm'
  | 'office'
  | 'workshop'
  | 'bank'
  | 'council'
  | 'combank'
  | 'medical'
  | 'cemetery'
  | 'park'
  | 'busstop'
  | 'library'
  | 'hospital'
  | 'govt'
  | 'reservebank'
  | 'mall'
  | 'stadium'
  | 'concert'
  | 'sports'
  | 'terminus'
  | 'towers'
  | 'station'
  | 'terminal'
  | 'runway'
  | 'hangar';

export interface Spot {
  id: string;
  kind: 'bed' | 'seat' | 'desk' | 'pulpit' | 'pew' | 'stove' | 'table' | 'counter' | 'cell' | 'bench' | 'stall' | 'grave' | 'bench-out' | 'generic' | 'exam' | 'ward' | 'goal' | 'altar';
  /** World metres (absolute). */
  x: number;
  y: number;
  /** A double bed (a married couple's), not a single. */
  double?: boolean;
}

export interface Room {
  id: string;
  name: string;
  /** Absolute world rectangle in metres. */
  x: number;
  y: number;
  w: number;
  h: number;
  spots: Spot[];
  kind: 'bedroom' | 'kitchen' | 'living' | 'bathroom' | 'yard' | 'nave' | 'hall' | 'classroom' | 'office' | 'ward' | 'consult' | 'reception' | 'cell' | 'courtroom' | 'shop' | 'field' | 'pitch' | 'graves' | 'workshop' | 'stop' | 'garage' | 'pen' | 'theatre' | 'stand' | 'auditorium' | 'stage' | 'library';
}

export interface Building {
  id: string;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Gate (houses) or door in world metres: where the road journey ends. */
  entrance: { x: number; y: number };
  /** Houses: the front door, distinct from the gate. */
  door?: { x: number; y: number };
  /** Nearest road-network node id. */
  roadNode: string;
  rooms: Room[];
  /** Which settlement the building belongs to. */
  community: CommunityId;
  /** For houses: the household living there. */
  householdId: string | null;
  /** Plot number for houses (1..12+). */
  plot: number | null;
  /** Building light is on (night rendering). */
  lit: boolean;
}

export interface RoadNode {
  id: string;
  x: number;
  y: number;
}

export interface RoadEdge {
  a: string;
  b: string;
  /** Metres. */
  length: number;
  name: string;
  /** Carriageway width in metres (streets 7, the highways wider). */
  width: number;
}

export interface Vehicle {
  id: string;
  householdId: string | null;
  kind: 'car' | 'bakkie' | 'police' | 'ambulance' | 'bus' | 'taxi' | 'train' | 'plane' | 'ride';
  x: number;
  y: number;
  heading: number;
  path: Array<{ x: number; y: number }>;
  occupantIds: string[];
  /** Where it is parked when idle. */
  homeX: number;
  homeY: number;
  moving: boolean;
  driverId: string | null;
  /** Micro-mode destination building. */
  destBuildingId: string | null;
  odometerKm: number;
  /** Service vehicles: the station they run from; taxis: the rank they belong to. */
  baseId: string | null;
  /** A taxi driving back to its rank empty. */
  returning: boolean;
  /** A taxi's or ambulance's leg: out to collect, the ride itself, or the run home; null when idle at base. */
  stage: 'pickup' | 'ride' | 'return' | null;
  /** Who a taxi or ambulance is on its way to collect. */
  boardIds: string[];
  /** Buses and trains: the line they run, the stop they are at or bound for, the direction along a shuttle line, and minutes left standing at a stop. */
  lineId: string | null;
  stopIdx: number;
  dir: 1 | -1;
  dwell: number;
  /** Trains and planes: the speed of the moment, m/min (drives the streak), and a train's distance along its guideway. */
  speed: number;
  trackPos: number;
  /** A plane in the air (off the map, not drawn). */
  airborne: boolean;
  /** Sim minute this vehicle last came to rest, for service vehicles that should head home when idle. */
  idleSince: number;
  /** The heading it will stand at when it reaches the end of its way (a bay along the road), and at home. */
  parkHeading?: number | null;
  homeHeading?: number;
  /** E-hailing: the driver-partner who rents this car, whether they are online for fares, and the running trip's quoted fare and surge. */
  rideDriverId?: string | null;
  online?: boolean;
  fare?: number;
  surge?: number;
}

export type EventSeverity = 'info' | 'joy' | 'sad' | 'alert' | 'danger';
export type EventKind =
  | 'birth'
  | 'death'
  | 'funeral'
  | 'courtship'
  | 'engagement'
  | 'wedding'
  | 'divorce'
  | 'illness'
  | 'recovery'
  | 'hospital'
  | 'discharge'
  | 'school-start'
  | 'graduation'
  | 'job'
  | 'retirement'
  | 'emigration'
  | 'immigration'
  | 'household'
  | 'dispute'
  | 'fight'
  | 'mediation'
  | 'crime'
  | 'intruder'
  | 'arrest'
  | 'court'
  | 'weather'
  | 'holiday'
  | 'church'
  | 'birthday'
  | 'accident'
  | 'economy'
  | 'insurance'
  | 'pregnancy';

export interface SimEvent {
  id: number;
  day: number;
  minute: number;
  kind: EventKind;
  severity: EventSeverity;
  text: string;
  personIds: string[];
  householdId?: string;
  buildingId?: string;
  x?: number;
  y?: number;
  data?: Record<string, unknown>;
}

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'heatwave' | 'cold-snap' | 'fog' | 'snow';

/**
 * An operator's "what if the weather were like this?" — a deliberate
 * intervention on the generated weather, not part of the assumption basis.
 * It is applied after generation, announced in the event ledger, and either
 * held until released or dropped at the next day step.
 */
export interface WeatherOverride {
  condition: WeatherCondition;
  tempMax: number;
  tempMin: number;
  rainMm: number;
  windKmh: number;
  hold: boolean;
  /** Day it was set, for the ledger. */
  setDay: number;
}

export interface Weather {
  day: number;
  season: Season;
  tempMin: number;
  tempMax: number;
  rainMm: number;
  condition: WeatherCondition;
  windKmh: number;
  /** Compass point the wind blows from, 0 = N clockwise in sixteenths (12 = W). */
  windDir: number;
}

export interface WeatherLogEntry {
  day: number;
  tempMin: number;
  tempMax: number;
  rainMm: number;
  condition: WeatherCondition;
  windKmh: number;
  windDir: number;
}

export interface ConversationLine {
  speakerId: string;
  text: string;
  /** Sim minute when spoken. */
  minute: number;
  /** Sung by the whole congregation rather than said by the speaker (see Hymn). */
  chorus?: boolean;
}

/**
 * A hymn in progress at a service. A hymn has no turns — everyone singing says
 * the same words at the same moment — so it sits beside the sermon rather than
 * inside it, and the renderer puts the line over every singer at once.
 */
export interface Hymn {
  /** Number as announced from the pulpit ("hymn number 142"). */
  number: number;
  title: string;
  /** The verse being sung, one line every couple of minutes. */
  verse: string[];
  /** Line being sung now; -1 between the announcement and the first line. */
  lineIdx: number;
  /** Sim minute the current line went up. */
  lineMinute: number;
  /** Everyone joining in: the pastor, and the congregants who sing. */
  singerIds: string[];
  /** In the pew but not singing — too small, too ill, or simply not the singing sort. */
  silentIds: string[];
}

export interface Conversation {
  id: string;
  participantIds: string[];
  buildingId: string | null;
  x: number;
  y: number;
  startMinute: number;
  endMinute: number;
  topic: string;
  lines: ConversationLine[];
  /** Whether an LLM has been asked to script this conversation. */
  llm: 'none' | 'pending' | 'streaming' | 'done' | 'failed';
  tone: 'warm' | 'neutral' | 'tense' | 'grief' | 'joy' | 'gossip' | 'prayer';
  /** Sermons only: the hymn the congregation is singing right now, if any. */
  hymn?: Hymn | null;
  /** Sermons only: sim minute the pastor calls the next hymn. */
  nextHymnMinute?: number;
}

export type IntruderKind = 'burglar' | 'pickpocket' | 'troublemaker' | 'stray-dog' | 'snake' | 'stranger' | 'con-artist' | 'stock-thief' | 'wildfire';

export interface Intruder {
  id: string;
  kind: IntruderKind;
  name: string;
  x: number;
  y: number;
  heading: number;
  path: Array<{ x: number; y: number }>;
  targetBuildingId: string | null;
  state: 'approaching' | 'acting' | 'fleeing' | 'caught' | 'gone' | 'neutralised';
  spawnedMinute: number;
  minutesLeft: number;
  spottedByIds: string[];
  incidentId: string | null;
}

export type IncidentKind = 'burglary' | 'theft' | 'assault' | 'dispute' | 'fight' | 'domestic' | 'drunk-disorderly' | 'animal' | 'snake' | 'fire' | 'fraud' | 'stock-theft' | 'road-accident' | 'stranger' | 'vandalism';

export interface Incident {
  id: string;
  kind: IncidentKind;
  day: number;
  minute: number;
  x: number;
  y: number;
  buildingId: string | null;
  involvedIds: string[];
  intruderId: string | null;
  status: 'active' | 'responding' | 'resolved' | 'escaped';
  responderIds: string[];
  outcome: string;
  /** Sim minute the response started. */
  respondedMinute: number | null;
  resolvedMinute: number | null;
  courtCaseId: string | null;
  handledBy: 'police' | 'pastor' | 'neighbours' | 'doctor' | 'self' | null;
  /** ZAR loss for insurance / economy analytics. */
  loss: number;
}

export interface CourtCase {
  id: string;
  /** The magistrate's court that hears it: the accused's city's. */
  courtId: string;
  incidentId: string;
  accusedId: string;
  accusedName: string;
  charge: string;
  filedDay: number;
  hearingDay: number;
  verdict: 'pending' | 'guilty' | 'not-guilty' | 'dismissed' | 'settled';
  sentence: string | null;
  fine: number;
}

export interface InsuranceLedger {
  /** ZAR reserve of the community funeral & life scheme. */
  reserve: number;
  premiumsIn: number;
  claimsOut: number;
  claimCount: number;
  policies: number;
  /** Month-level surplus path for the risk-theory chart. */
  surplusPath: Array<{ month: number; reserve: number; premiums: number; claims: number }>;
  ruined: boolean;
  ruinMonth: number | null;
}

export interface AgeBandExposure {
  band: string;
  lo: number;
  hi: number;
  /** Person-years. */
  exposureM: number;
  exposureF: number;
  deathsM: number;
  deathsF: number;
  /** Sum over days of the daily hazard (expected deaths on the assumed basis). */
  expectedM: number;
  expectedF: number;
}

export interface StatsSnapshot {
  day: number;
  isoDate: string;
  population: number;
  households: number;
  births: number; // cumulative
  deaths: number;
  marriages: number;
  divorces: number;
  emigrations: number;
  immigrations: number;
  employedAdults: number;
  workingAge: number;
  unemployedAdults: number;
  children: number;
  elderly: number;
  ill: number;
  inHospital: number;
  meanMood: number;
  meanIncome: number;
  poorHouseholds: number;
  churchAttendanceLastSunday: number;
  incidentsCum: number;
  arrestsCum: number;
  insuranceReserve: number;
  temp: number;
  rainMm: number;
  season: Season;
  meanVitality: number;
  homeschooled: number;
  atSchool: number;
  /** Per-settlement and per-city split (population, households, mean household income, poor households). */
  byCommunity: Record<string, { population: number; households: number; meanIncome: number; poor: number }>;
  byCity: Record<string, { population: number; households: number; meanIncome: number; poor: number }>;
  /** Finance block (0 until the first month closes). */
  inflation: number;
  repo: number;
  gdpNominal: number;
  gdpReal: number;
  unemploymentRate: number;
  bankDeposits: number;
  bankLoans: number;
  taxRevenue: number;
}

export interface SimStats {
  births: number;
  deaths: number;
  marriages: number;
  divorces: number;
  emigrations: number;
  immigrations: number;
  incidents: number;
  arrests: number;
  disputes: number;
  fights: number;
  mediations: number;
  illnesses: number;
  hospitalisations: number;
  recoveries: number;
  funerals: number;
  weddings: number;
  courtCases: number;
  convictions: number;
  roadAccidents: number;
  conversations: number;
  churchServices: number;
  /** Hymns sung through to the end of the verse. */
  hymnsSung: number;
  /** Referrals to the central hospital (surgery and specialist care). */
  surgeries: number;
  /** Minibus-taxi trips taken between the cities and the centre. */
  taxiRides: number;
  /** E-hailing trips requested on the Hamba app (animated day), and the fares quoted for them (R). */
  rideTrips: number;
  rideFares: number;
  /** Bus and hypersonic-train boardings, flights flown from the airport, and ambulance call-outs. */
  busRides: number;
  trainRides: number;
  flights: number;
  airTrips: number;
  ambulanceRuns: number;
  /** Deaths by cause label. */
  deathsByCause: Record<string, number>;
  /** Deaths by mechanism: the table hazard, an illness episode, an accident, a maternal death. */
  deathsBySource: Record<'table' | 'illness' | 'accident' | 'maternal', number>;
  /** Table-hazard deaths by age band (calibration diagnostics). */
  tableDeathsByBand: Record<string, number>;
  /** Deaths by age band label. */
  deathsByBand: Record<string, number>;
  /** Illness episodes by kind. */
  illnessByKind: Record<string, number>;
  /** Illness onsets by month index (0..11) for seasonality. */
  illnessByMonth: number[];
  /** Births by mother's age band. */
  birthsByMotherBand: Record<string, number>;
  /** Woman-years of exposure by 5-year band (15-49) for realised ASFR. */
  womanYearsByBand: Record<string, number>;
  /** Σ ASFR(age)·dt over woman-days: births expected on the fertility basis. */
  expectedBirths: number;
  exposures: AgeBandExposure[];
  /** Monthly snapshots. */
  series: StatsSnapshot[];
  /** Per-year period summaries. */
  yearly: Array<{
    year: number;
    population: number;
    births: number;
    deaths: number;
    cbr: number;
    cdr: number;
    tfr: number;
    e0M: number | null;
    e0F: number | null;
    marriages: number;
    aeRatio: number | null;
  }>;
  incidentsByKind: Record<string, number>;
  /** Sunday attendance: `population` counts the residents of the church-going cities only. */
  weeklyChurch: Array<{ day: number; attendance: number; population: number; byCity: Record<string, number> }>;
  /** Daily weather as it happened (the last 400 days), for the weather chart. */
  weatherLog: WeatherLogEntry[];
  hospitalVisits: number;
  clinicVisits: number;
  kmDriven: number;
}

export interface Gathering {
  kind: 'funeral' | 'wedding' | 'celebration';
  buildingId: string;
  day: number;
  start: number;
  end: number;
  forIds: string[];
  label: string;
}

export interface WorldMeta {
  widthM: number;
  heightM: number;
  latitude: number;
  hemisphere: 'south' | 'north';
  placeName: string;
}

export interface World {
  meta: WorldMeta;
  people: Record<string, Person>;
  households: Record<string, Household>;
  buildings: Record<string, Building>;
  roads: { nodes: Record<string, RoadNode>; edges: RoadEdge[] };
  vehicles: Record<string, Vehicle>;
  conversations: Record<string, Conversation>;
  intruders: Record<string, Intruder>;
  incidents: Record<string, Incident>;
  courtCases: Record<string, CourtCase>;
  events: SimEvent[];
  weather: Weather;
  insurance: InsuranceLedger;
  /** Ledgers, bank, tax office and the macro/micro series. */
  finance: FinanceState;
  stats: SimStats;
  /** Absolute sim minute. */
  minute: number;
  day: number;
  minuteOfDay: number;
  /** Day index of the last processed day-step. */
  lastDayStep: number;
  lastMonthStep: number;
  lastYearStep: number;
  nextIds: { person: number; household: number; event: number; conversation: number; intruder: number; incident: number; court: number; illness: number; vehicle: number };
  /** Buildings with a scheduled gathering today (funeral / wedding). */
  todayGatherings: Gathering[];
  /** Gatherings booked for future days (funerals, weddings). */
  scheduledGatherings: Gathering[];
  /** Intruder visits booked for today (minute of day, kind); resolved in micro or macro mode. */
  scheduledIntruders: Array<{ minute: number; kind: IntruderKind; done: boolean }>;
  /** Court cases heard today (filled by courtDayStep, consumed by applyCourtAttendance). */
  todayHearings: string[];
  /** Cemetery graves (rendering + funerals). */
  graves: Array<{ personId: string; name: string; day: number; x: number; y: number }>;
  /** Public holidays today etc. */
  holiday: string | null;
  /** Operator-forced weather, if any (see WeatherOverride). */
  weatherOverride: WeatherOverride | null;
  /** Names of the persons currently holding key roles (fast lookup). */
  roles: {
    /** Emmaus's (the first city's) office-holders, kept for the older call sites; the maps below cover the region. */
    pastorId: string | null;
    doctorId: string | null;
    /** The district medical officer at the Emmaus Medical Centre (decision-maker for health, holds the council's health seat). */
    dmoId: string | null;
    nurseIds: string[];
    policeIds: string[];
    magistrateId: string | null;
    teacherIds: string[];
    /** Serving pastor per church building id. */
    pastorByChurch: Record<string, string | null>;
    /** Doctor per clinic building id (the central hospital included). */
    doctorByClinic: Record<string, string | null>;
    /** District medical officer per city. */
    dmoByCity: Record<string, string | null>;
    /** Magistrate per court building id. */
    magistrateByCourt: Record<string, string | null>;
    /** Officers per police station id (the provincial headquarters included). */
    policeByStation: Record<string, string[]>;
    /** The surgeons at the central hospital. */
    surgeonIds: string[];
  };
  /** Every city's council: six elected portfolio seats plus health ex officio, each seat tagged with its city. */
  council: CouncilSeat[];
  /** Reproduction of the scenario basis (hash of the parameters). */
  basisHash: string;
}
