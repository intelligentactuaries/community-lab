// The region's institutions: which building serves which purpose for whom,
// who staffs it, and how the businesses among them keep their books. The
// layouts say where things are; this file says what they are for.

import { activeAtlas, onAtlas, type BusinessKind, type BusinessSpec, type EssentialPost } from './atlas';
import type { CityId, CommunityId, JobId, Person, World } from './types';
import { CHURCH_IDS, CITIES, cityOf, defaultCommunity, landmark, tierOf } from './world';

// ─── Staffing ───────────────────────────────────────────────────────────────

export type { BusinessKind, BusinessSpec, EssentialPost } from './atlas';

/** The chambers a city's attorneys and accountants practise from (null where none serves it). */
export const CHAMBERS_BY_CITY: Record<CityId, string | null> = {};
/** The commercial bank a city's firms bank with. */
export const COMBANK_BY_CITY: Record<CityId, string | null> = {};

/** Survivalist spazas, the general dealers, the delis; the Mutual Bank's settlement counters (its head office pays in full). */
export const SPAZA_IDS: string[] = [];
export const MARKET_IDS: string[] = [];
export const DELI_IDS: string[] = [];
export const COUNTER_IDS: string[] = [];

/** Every business, congregation and operator that keeps books, and the same by id. */
export const BUSINESSES: BusinessSpec[] = [];
export const BUSINESS: Record<string, BusinessSpec> = {};

/** Public institutions: the state pays their staff. */
export const PUBLIC_WORKPLACES = new Set<string>();

onAtlas((a) => {
  for (const k of Object.keys(CHAMBERS_BY_CITY)) delete CHAMBERS_BY_CITY[k];
  Object.assign(CHAMBERS_BY_CITY, a.chambersByCity);
  for (const k of Object.keys(COMBANK_BY_CITY)) delete COMBANK_BY_CITY[k];
  Object.assign(COMBANK_BY_CITY, a.combankByCity);
  SPAZA_IDS.splice(0, SPAZA_IDS.length, ...a.spazaIds);
  MARKET_IDS.splice(0, MARKET_IDS.length, ...a.marketIds);
  DELI_IDS.splice(0, DELI_IDS.length, ...a.deliIds);
  COUNTER_IDS.splice(0, COUNTER_IDS.length, ...a.counterIds);
  BUSINESSES.splice(0, BUSINESSES.length, ...a.businesses);
  for (const k of Object.keys(BUSINESS)) delete BUSINESS[k];
  for (const b of a.businesses) BUSINESS[b.id] = b;
  PUBLIC_WORKPLACES.clear();
  for (const id of a.publicWorkplaces) PUBLIC_WORKPLACES.add(id);
});

/**
 * Every post the region cannot do without, city by city and then the centre:
 * a congregation without its pastor, a clinic without a nurse or a court
 * without a magistrate is not a community. The list comes with the world.
 */
export function ESSENTIAL_POSTS(): EssentialPost[] {
  return activeAtlas().essentialPosts;
}

/** Where someone with a job works when no post names a building: their own city's institution of that kind (null where the world has none). */
export function defaultWorkplace(world: World, p: Person, job: JobId): string | null {
  const hh = world.households[p.householdId];
  const com = (hh && world.buildings[hh.houseId]?.community) || defaultCommunity();
  const city = cityOf(com);
  const site = (j: JobId) => activeAtlas().jobSites.city[city]?.[j] ?? activeAtlas().jobSites.region[j] ?? null;
  switch (job) {
    case 'pastor':
      return landmark(com, 'church');
    case 'doctor':
    case 'nurse':
      return landmark(com, 'clinic');
    case 'teacher':
      return landmark(com, 'school');
    case 'police':
      return landmark(com, 'police');
    case 'magistrate':
    case 'clerk':
      return landmark(com, 'court');
    case 'shopkeeper':
    case 'vendor':
      return landmark(com, 'shop');
    case 'farmer':
    case 'farmhand':
      return landmark(com, 'farm');
    case 'builder':
      return landmark(com, 'workshop');
    case 'office':
    case 'engineer':
      return landmark(com, 'office');
    case 'attorney':
    case 'accountant':
      return CHAMBERS_BY_CITY[city] ?? null;
    case 'dmo':
      return landmark(com, 'medical');
    case 'combanker':
      return COMBANK_BY_CITY[city] ?? null;
    case 'taxidriver':
      return landmark(com, 'taxi');
    case 'banker':
      return landmark(com, 'bank');
    case 'surgeon':
    case 'executive':
    case 'civilservant':
    case 'centralbanker':
    case 'librarian':
    case 'pilot':
    case 'busdriver':
      return site(job);
    case 'ehailer':
      // A driver-partner's day starts and ends with the rented car at their own gate.
      return hh?.houseId ?? null;
    default:
      return null;
  }
}

/** Mean church-attendance propensity for a settlement's residents: the scenario's, or the secular city's low floor. */
export function faithMeanFor(community: CommunityId | null | undefined, churchAttendance: number): number {
  const city = CITIES.find((c) => c.id === cityOf(community));
  return city?.faith ?? churchAttendance;
}

export function isReligiousCity(city: CityId): boolean {
  return CITIES.find((c) => c.id === city)?.religious ?? true;
}

/** The businesses in a city (for its chambers' and commercial bank's clients). */
export function businessesIn(city: CityId, kinds?: BusinessKind[]): BusinessSpec[] {
  return BUSINESSES.filter((b) => b.city === city && (!kinds || kinds.includes(b.kind)));
}

/** The shop a settlement's households buy at, with its local-spend shares. */
export function shopOf(community: CommunityId | null | undefined): BusinessSpec {
  const id = landmark(community, 'shop');
  const pm = activeAtlas().produceMarket;
  return (id && BUSINESS[id]) || (pm && BUSINESS[pm]) || BUSINESSES.find((b) => b.kind === 'market' || b.kind === 'shop' || b.kind === 'mall')!;
}

/** How rich a settlement is, on a 0 (low-income) to 1 (the estates) scale, for the small things that scale with it. */
export function affluence(community: CommunityId | null | undefined): number {
  switch (tierOf(community)) {
    case 'ultra':
      return 1;
    case 'affluent':
      return 0.85;
    case 'comfortable':
      return 0.65;
    case 'middle':
      return 0.45;
    case 'working':
      return 0.25;
    case 'low-income':
      return 0.08;
    default:
      return 0.5;
  }
}

export { CHURCH_IDS };
