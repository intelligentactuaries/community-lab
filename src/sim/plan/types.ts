// A world plan: a community as the Community Builder saves it. Plain JSON, so
// a plan can be stored, exported, sent to the server for a Monte Carlo batch
// and hashed into the run's basis. Coordinates are metres, y pointing south.
//
// A plan says where things are and what they are (an asset id per building);
// the engine derives what they are for — which church a settlement attends,
// who staffs the clinic, which businesses keep books — in plan/derive.ts.
// Anything a plan states explicitly under `institutions` is kept as stated
// (the built-in province states everything, so it runs exactly as drawn).

import type { BusLine, BusinessSpec, EssentialPost, ExitSpec, JobSites, Landmarks, RunwaySpec, StationSpec, Venues } from '../atlas';
import type { Facing } from '../layout/builders';
import type { Building, Tier } from '../types';

export const PLAN_FORMAT = 'community-lab.world/1' as const;

export interface PlanCity {
  id: string;
  name: string;
  short: string;
  kind: 'city' | 'centre' | 'airport';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mean church-attendance propensity of residents; null takes the scenario's. */
  faith?: number | null;
  /** Whether residents keep a congregation at all (derived from the churches when absent). */
  religious?: boolean;
  blurb?: string;
  tagline?: string;
}

export interface PlanSettlement {
  id: string;
  city: string;
  name: string;
  short: string;
  /** Wealth profile (the scenario's `tiers`); 'civic' zones have no households. */
  tier: Tier;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Households seated at t0 (default: four plots in five; the rest are left for newcomers). */
  households?: number | null;
  /** Plot numbers in seating order (default: spread out, so vacancies interleave). */
  seedOrder?: number[];
  /** Its people's own departures from the tier's profile: unemployment, cars, cover, savings, schooling. */
  profile?: Partial<import('../params').CommunityProfile>;
}

export interface PlanRoad {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Carriageway width in metres (streets 7). */
  width?: number;
}

export interface PlanBuilding {
  id: string;
  /** What it is: an asset of the catalogue (plan/assets.ts). */
  asset: string;
  name: string;
  /** The settlement it belongs to (its zone; the nearest one when it stands outside every zone). */
  settlement: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The side its door faces. */
  facing: Facing;
  /** Asset options: a church's size, a police station's cells, an office's floors, a market's square out front. */
  options?: Record<string, string | number | boolean>;
  /** Houses: the plot number (unique in the world). */
  plot?: number | null;
  /** A hand-drawn building kept verbatim (the province's originals): rooms, furniture, door and gate as drawn, moved with the footprint. */
  raw?: Building;
}

/** Everything a plan may state about its institutions; whatever it leaves out is derived. */
export interface PlanInstitutions {
  settlementLandmarks: Record<string, Landmarks>;
  cityLandmarks: Record<string, Landmarks>;
  regionLandmarks: Landmarks;
  houseLandmarks: Record<string, Landmarks>;
  fallbackCity: string | null;
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
  stations: StationSpec[];
  runway: RunwaySpec | null;
  exits: ExitSpec[];
  businesses: BusinessSpec[];
  publicWorkplaces: string[];
  spazaIds: string[];
  marketIds: string[];
  deliIds: string[];
  counterIds: string[];
  bankHq: string | null;
  chambersByCity: Record<string, string | null>;
  combankByCity: Record<string, string | null>;
  essentialPosts: EssentialPost[];
  jobSites: JobSites;
  produceMarket: string | null;
  produceFarm: string | null;
  venues: Venues;
  publicServicesCost: number;
  publicServicesMemo: string;
  marketScale: number;
  ownerNames: Array<{ id: string; job: import('../types').JobId; pattern: string; female?: string }>;
}

export interface WorldPlan {
  format: typeof PLAN_FORMAT;
  /** Stable id ('unity-province' for the built-in province). */
  id: string;
  /** The world's name: the top bar, the prompts. */
  name: string;
  /** The region's name: the Mutual Bank, the burial society. */
  region: string;
  description?: string;
  size: { w: number; h: number };
  cities: PlanCity[];
  settlements: PlanSettlement[];
  roads: PlanRoad[];
  buildings: PlanBuilding[];
  /** The Hyperline's guideway as a polyline of axis-aligned runs; stations are buildings beside it. */
  track?: Array<{ x: number; y: number }>;
  /** Bus lines (stop ids in order); derived when absent. */
  busLines?: BusLine[];
  /** The settlement whose households follow the scenario's household count, education mix and cover; null: every settlement follows its tier. */
  baseline?: string | null;
  /** Where an unknown place defaults to. */
  defaultSettlement?: string;
  /** Explicit institution tables (the province's); anything absent is derived. */
  institutions?: Partial<PlanInstitutions>;
  meta?: { createdAt?: string; updatedAt?: string; origin?: string; version?: number };
}
