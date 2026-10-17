// The atlas: everything the engine needs to know about the place it runs in.
// Cities and settlements, the roads, the buildings and what each is for, the
// businesses that keep books, the posts a community cannot do without, the bus
// lines, the Hyperline and the airport.
//
// The built-in Unity Province is one atlas (layout/province.ts, drawn by hand);
// a world made in the Community Builder is another, derived from its plan
// (plan/derive.ts). A Simulation installs its own atlas before it runs, and the
// rest of the engine reads the installed one through world.ts and
// institutions.ts, so the same code runs any world.

import type { Segment, PlotSpec } from './layout/plots';
import type { WorldPlan } from './plan/types';
import type { CommunityProfile } from './params';
import type { Building, CityId, CommunityId, JobId, Tier } from './types';

// ─── Places ─────────────────────────────────────────────────────────────────

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
  /** Two or three words under the name on the map ("the rich city"). */
  tagline?: string;
}

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
  /** Households seated at t0 (the baseline settlement's count is the `households` parameter). */
  seedHouseholds: number;
  /** The settlement's own departures from its tier's profile (a built world's; the province has none). */
  profile?: Partial<CommunityProfile>;
}

export type LandmarkKind = 'church' | 'shop' | 'bank' | 'park' | 'busstop' | 'hall' | 'cemetery' | 'school' | 'clinic' | 'police' | 'court' | 'council' | 'medical' | 'taxi' | 'workshop' | 'office' | 'farm' | 'library';

export type Landmarks = Partial<Record<LandmarkKind, string>>;

export interface BusLine {
  id: string;
  name: string;
  /** Stops in order; buses shuttle back and forth along the list. */
  stops: string[];
}

export interface StationSpec {
  /** Building id. */
  id: string;
  name: string;
  /** Where the train draws up, on the guideway beside the platform. */
  x: number;
  y: number;
  /** Distance along the guideway from its first end. */
  t: number;
}

export interface ExitSpec {
  id: string;
  x: number;
  y: number;
  node: string;
}

/** The runway centreline and thresholds, for the planes' taxi, take-off and landing paths. */
export interface RunwaySpec {
  x: number;
  north: number;
  south: number;
  taxiwayX: number;
  taxiwayY: number;
}

// ─── Institutions ───────────────────────────────────────────────────────────

export interface EssentialPost {
  job: JobId;
  /** Building the post is tied to (defaults to the job's default workplace in the holder's city). */
  workplace?: string;
  /** Filled from this settlement's residents (relaxed only if nobody there qualifies). */
  community?: CommunityId;
  /** Filled from this city's residents (the centre hires from every city). */
  city?: CityId;
}

export type BusinessKind = 'market' | 'shop' | 'farm' | 'workshop' | 'office' | 'church' | 'practice' | 'taxi' | 'combank' | 'mall' | 'transit' | 'platform' | 'fleet' | 'airport';

export interface BusinessSpec {
  /** Building id and entity id. */
  id: string;
  /** Name of an entity that has no building of its own (else the building's name is used). */
  name?: string;
  kind: BusinessKind;
  city: CityId;
  regime: 'cit' | 'sbc' | 'turnover' | 'pbo' | 'exempt';
  vatRegistered: boolean;
  sdl: boolean;
  /** The household of whoever holds this job at this workplace owns the business (dividends). */
  ownerJob?: JobId;
  /** Opening balances by account: float (1020), stock (1200), property and equipment (1500). */
  opening: Record<string, number>;
  openingMemo: string;
  /** Retail: cost of sales share, monthly overhead (ZAR, CPI-indexed), straight-line depreciation per month, walk-in trade from passing travellers. */
  cogs?: number;
  overhead?: number;
  dep?: number;
  walkIn?: number;
  /** Share of a household's food and goods bought at this shop rather than in town. */
  localFood?: number;
  localGoods?: number;
  /** Churches: utilities and other running costs per month. */
  util?: number;
  other?: number;
  /** Farms: monthly output at base prices with the farmer alone, and per hand. */
  outputBase?: number;
  outputPerHand?: number;
  /** Practices and offices: what a professional bills the region per month; offices bill a multiple of wages. */
  retainer?: number;
  /** Taxi associations: town-route fares per driver per month. */
  routeFares?: number;
  /** Commercial banks: monthly fees from the public purse, the Mutual Bank and treasury income. */
  publicFees?: number;
  correspondentFees?: number;
  treasury?: number;
  running?: number;
  /** Offices: fees invoiced on top of the wage multiple, administration and utilities per month (ZAR, CPI-indexed), and the invoice's memo. */
  fees?: number;
  admin?: number;
  utilities?: number;
  invoiceMemo?: string;
  /** A head office or a corporate tower: no maintenance contract with its city's workshop. */
  corporate?: boolean;
  /** Practices: the cities whose firms brief these chambers (default: its own). Commercial banks: the cities whose firms bank here. */
  clientCities?: CityId[];
}

/** A job and where it is done when no post names a building: across the region, or per city. */
export interface JobSites {
  region: Partial<Record<JobId, string>>;
  city: Record<string, Partial<Record<JobId, string>>>;
}

/** The region's own venues the daily routines reach for (null where the world has none). */
export interface Venues {
  grandpark: string | null;
  sports: string | null;
  mall: string | null;
  stadium: string | null;
  concert: string | null;
  /** Where the e-hailing trip-length model measures town from. */
  centre: string | null;
  /** The Hyperline station at the centre of the region (the e-hailing model's long trips start there). */
  centralStation: string | null;
}

// ─── The atlas ──────────────────────────────────────────────────────────────

export interface Atlas {
  /** 'unity-province' for the built-in province, else the plan's id. */
  id: string;
  /** The world's name (the top bar and the prompts); null keeps the scenario's place name. */
  name: string | null;
  /** The region's name (the Mutual Bank, the burial society); null keeps the scenario's region name. */
  region: string | null;
  /** The plan the atlas was derived from (null for the built-in province). */
  plan: WorldPlan | null;
  /** Fingerprint of the plan ('' for the built-in province), folded into the basis hash. */
  hash: string;
  width: number;
  height: number;
  cities: CitySpec[];
  communities: CommunitySpec[];
  /** Where an unknown place defaults to (the original village's settlement and city). */
  defaultCommunity: CommunityId;
  defaultCity: CityId;
  /** The settlement whose households follow the scenario's own household count, education mix and cover (else every settlement follows its tier). */
  baseline: CommunityId | null;
  /** Every road segment (centre lines and widths). */
  segments: Segment[];
  plots: PlotSpec[];
  /** Builds the world's buildings afresh (a run mutates names, households and lights). */
  buildings: () => Record<string, Building>;
  /** What a settlement keeps for itself, what a city keeps for all its settlements, and what serves the whole region. */
  settlementLandmarks: Record<string, Landmarks>;
  cityLandmarks: Record<string, Landmarks>;
  regionLandmarks: Landmarks;
  /** Where a settlement has more than one church, shop, park, stop or counter, each house uses its nearest (by house id). */
  houseLandmarks: Record<string, Landmarks>;
  /** A purpose nobody nearer serves falls back to this city's institution. */
  fallbackCity: CityId | null;
  churchIds: string[];
  clinicIds: string[];
  courtIds: string[];
  policeIds: string[];
  councilIds: Record<string, string | null>;
  taxiRankIds: string[];
  centralHospital: string | null;
  ambulanceBases: Array<{ id: string; n: number }>;
  airportTerminal: string | null;
  busHub: string | null;
  busLines: BusLine[];
  /** The Hyperline: the guideway polyline and its stations in line order (both empty where there is none). */
  track: Array<{ x: number; y: number }>;
  stations: StationSpec[];
  runway: RunwaySpec | null;
  exits: ExitSpec[];
  businesses: BusinessSpec[];
  /** Workplaces whose staff the state pays. */
  publicWorkplaces: string[];
  /** Pay scales: survivalist spazas, the general dealers, the delis; the Mutual Bank's settlement counters (its head office pays in full). */
  spazaIds: string[];
  marketIds: string[];
  deliIds: string[];
  counterIds: string[];
  /** The Mutual Bank's head office (it carries the bank's name). */
  bankHq: string | null;
  chambersByCity: Record<string, string | null>;
  combankByCity: Record<string, string | null>;
  essentialPosts: EssentialPost[];
  jobSites: JobSites;
  /** The market through which fresh produce clears, and the farm that supplies it (null where there is none). */
  produceMarket: string | null;
  produceFarm: string | null;
  venues: Venues;
  /** Ambient public services per month (ZAR at base prices): the cities' clinics, schools, police, courts and councils, and the centre's institutions. */
  publicServicesCost: number;
  publicServicesMemo: string;
  /**
   * The size of this world's economy against the province's (1 there): the
   * operators set up for the whole province (the e-hailing app's servers, the
   * transit operator's overheads, riders from beyond the households) scale with it.
   */
  marketScale: number;
  /** Owner-named businesses: the building takes the owner's surname ("Botha's Workshop"). */
  ownerNames: Array<{ id: string; job: JobId; pattern: string; female?: string }>;
}

// ─── The installed atlas ────────────────────────────────────────────────────

let active: Atlas | null = null;
let epoch = 0;
const listeners: Array<(a: Atlas) => void> = [];

/** The atlas the engine is running on. */
export function activeAtlas(): Atlas {
  if (!active) throw new Error('No atlas installed');
  return active;
}

/** Bumped on every install, so caches keyed on the world can tell it changed. */
export function atlasEpoch(): number {
  return epoch;
}

/** Make an atlas the one the engine (and the renderer) reads. */
export function installAtlas(a: Atlas): void {
  if (active === a) return;
  active = a;
  epoch++;
  for (const fn of listeners) fn(a);
}

/** Run something whenever a different atlas is installed (the registries in world.ts and institutions.ts). */
export function onAtlas(fn: (a: Atlas) => void): void {
  listeners.push(fn);
  if (active) fn(active);
}

// ─── Pure lookups on an atlas ───────────────────────────────────────────────

export function cityOfIn(a: Atlas, community: CommunityId | null | undefined): CityId {
  if (!community) return a.defaultCity;
  return a.communities.find((c) => c.id === community)?.city ?? a.defaultCity;
}

/** The building a household uses for a purpose: its house's nearest where its settlement has several, else its settlement's. */
export function landmarkForHouseIn(a: Atlas, houseId: string | null | undefined, community: CommunityId | null | undefined, kind: LandmarkKind): string | null {
  const own = houseId ? a.houseLandmarks[houseId]?.[kind] : undefined;
  return own ?? landmarkIn(a, community, kind);
}

/**
 * The building a community uses for a purpose: its own where it has one, else
 * its city's, else (for anything but a church) the fallback city's or the
 * region's. A church is null where a settlement has none to go to.
 */
export function landmarkIn(a: Atlas, community: CommunityId | null | undefined, kind: LandmarkKind): string | null {
  const com = community ?? a.defaultCommunity;
  const own = a.settlementLandmarks[com]?.[kind];
  if (own) return own;
  const city = a.cityLandmarks[cityOfIn(a, com)]?.[kind];
  if (city) return city;
  if (kind === 'church') return null;
  const fb = a.fallbackCity ? a.cityLandmarks[a.fallbackCity]?.[kind] : undefined;
  return fb ?? a.regionLandmarks[kind] ?? null;
}
