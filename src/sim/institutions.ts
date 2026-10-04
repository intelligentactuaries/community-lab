// The region's institutions: which building serves which purpose for whom,
// who staffs it, and how the businesses among them keep their books. The
// layouts say where things are; this file says what they are for.

import type { CityId, CommunityId, JobId, Person, World } from './types';
import { CHURCH_IDS, CITIES, COMMUNITIES, cityOf, landmark, tierOf } from './world';

// ─── Staffing ───────────────────────────────────────────────────────────────

export interface EssentialPost {
  job: JobId;
  /** Building the post is tied to (defaults to the job's default workplace in the holder's city). */
  workplace?: string;
  /** Filled from this settlement's residents (relaxed only if nobody there qualifies). */
  community?: CommunityId;
  /** Filled from this city's residents (the centre hires from every city). */
  city?: CityId;
}

/** The chambers a city's attorneys and accountants practise from; Ithemba's use the regional chambers at the centre. */
export const CHAMBERS_BY_CITY: Record<CityId, string> = { emmaus: 'rpractice', newhaven: 'nh-chambers', ithemba: 'un-chambers', unity: 'un-chambers', airport: 'nh-chambers' };
/** The commercial bank a city's firms bank with. */
export const COMBANK_BY_CITY: Record<CityId, string> = { emmaus: 'combank', newhaven: 'nh-combank', ithemba: 'combank', unity: 'combank', airport: 'nh-combank' };

/**
 * Every post the region cannot do without, city by city and then the centre:
 * a congregation without its pastor, a clinic without a nurse or a court
 * without a magistrate is not a community. The list is built from the
 * layouts, so a city with no church simply has no pastorate.
 */
export function essentialPosts(): EssentialPost[] {
  const out: EssentialPost[] = [];
  // The best-paid posts in the region are filled first, so they draw the best-qualified.
  for (let i = 0; i < 2; i++) out.push({ job: 'executive', workplace: 'towers' });
  for (let i = 0; i < 2; i++) out.push({ job: 'surgeon', workplace: 'hospital' });
  for (let i = 0; i < 2; i++) out.push({ job: 'centralbanker', workplace: 'reservebank' });
  for (let i = 0; i < 2; i++) out.push({ job: 'pilot', workplace: 'ap-terminal' });
  for (const city of CITIES) {
    if (city.kind !== 'city') continue;
    const coms = COMMUNITIES.filter((c) => c.city === city.id);
    const residential = coms.filter((c) => c.tier !== 'civic');
    const first = residential[0].id;
    const L = (k: Parameters<typeof landmark>[1]) => landmark(first, k as 'shop');
    for (const c of residential) {
      const ch = landmark(c.id, 'church');
      if (ch) out.push({ job: 'pastor', workplace: ch, community: c.id });
    }
    out.push({ job: 'dmo', workplace: L('medical'), city: city.id });
    out.push({ job: 'doctor', workplace: L('clinic'), city: city.id });
    out.push({ job: 'magistrate', workplace: L('court'), city: city.id });
    out.push({ job: 'clerk', workplace: L('court'), city: city.id });
    if (city.id !== 'ithemba') {
      out.push({ job: 'attorney', workplace: CHAMBERS_BY_CITY[city.id], city: city.id });
      out.push({ job: 'accountant', workplace: CHAMBERS_BY_CITY[city.id], city: city.id });
      out.push({ job: 'combanker', workplace: COMBANK_BY_CITY[city.id], city: city.id });
      out.push({ job: 'combanker', workplace: COMBANK_BY_CITY[city.id], city: city.id });
    }
    for (let i = 0; i < 2; i++) out.push({ job: 'nurse', workplace: L('clinic'), city: city.id });
    for (let i = 0; i < 3; i++) out.push({ job: 'teacher', workplace: L('school'), city: city.id });
    for (let i = 0; i < 3; i++) out.push({ job: 'police', workplace: L('police'), city: city.id });
    for (const c of residential) out.push({ job: 'shopkeeper', workplace: landmark(c.id, 'shop'), community: c.id });
    for (const c of residential) out.push({ job: 'banker', workplace: landmark(c.id, 'bank'), community: c.id });
    out.push({ job: 'taxidriver', workplace: L('taxi'), city: city.id });
    out.push({ job: 'taxidriver', workplace: L('taxi'), city: city.id });
    out.push({ job: 'farmer', workplace: L('farm'), city: city.id });
    out.push({ job: 'builder', workplace: L('workshop'), city: city.id });
    out.push({ job: 'vendor', workplace: L('shop'), city: city.id });
    out.push({ job: 'farmhand', workplace: L('farm'), city: city.id });
    if (city.id === 'newhaven') out.push({ job: 'librarian', workplace: 'nh-library', city: city.id });
    if (city.id === 'ithemba') for (let i = 0; i < 2; i++) out.push({ job: 'civilservant', workplace: 'it-post', city: city.id });
  }
  // Unity Transit's drivers, from anywhere in the province.
  for (let i = 0; i < 4; i++) out.push({ job: 'busdriver', workplace: 'terminus' });
  // The rest of the centre hires from every city.
  out.push({ job: 'doctor', workplace: 'hospital' });
  for (let i = 0; i < 4; i++) out.push({ job: 'nurse', workplace: 'hospital' });
  for (let i = 0; i < 4; i++) out.push({ job: 'civilservant', workplace: 'govt' });
  for (let i = 0; i < 3; i++) out.push({ job: 'police', workplace: 'un-police' });
  for (let i = 0; i < 2; i++) out.push({ job: 'shopkeeper', workplace: 'mall' });
  for (let i = 0; i < 2; i++) out.push({ job: 'vendor', workplace: 'mall' });
  for (let i = 0; i < 2; i++) out.push({ job: 'office', workplace: 'stadium' });
  for (let i = 0; i < 2; i++) out.push({ job: 'office', workplace: 'concert' });
  for (let i = 0; i < 2; i++) out.push({ job: 'taxidriver', workplace: 'terminus' });
  out.push({ job: 'attorney', workplace: 'un-chambers' });
  out.push({ job: 'accountant', workplace: 'un-chambers' });
  return out;
}

let postsCache: EssentialPost[] | null = null;
export function ESSENTIAL_POSTS(): EssentialPost[] {
  return (postsCache ??= essentialPosts());
}

/** Where someone with a job works when no post names a building: their own city's institution of that kind. */
export function defaultWorkplace(world: World, p: Person, job: JobId): string | null {
  const hh = world.households[p.householdId];
  const com = (hh && world.buildings[hh.houseId]?.community) || 'ebenezer';
  const city = cityOf(com);
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
      return CHAMBERS_BY_CITY[city];
    case 'dmo':
      return landmark(com, 'medical');
    case 'combanker':
      return COMBANK_BY_CITY[city];
    case 'taxidriver':
      return landmark(com, 'taxi');
    case 'banker':
      return landmark(com, 'bank');
    case 'surgeon':
      return 'hospital';
    case 'executive':
      return 'towers';
    case 'civilservant':
      return city === 'ithemba' ? 'it-post' : 'govt';
    case 'centralbanker':
      return 'reservebank';
    case 'librarian':
      return 'nh-library';
    case 'pilot':
      return 'ap-terminal';
    case 'busdriver':
      return 'terminus';
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

// ─── Retail pay ─────────────────────────────────────────────────────────────

/** Survivalist spazas, the general dealers, the delis and the mall. */
export const SPAZA_IDS = ['pshop', 'nh-spaza', 'it-sspaza', 'it-nspaza'];
export const MARKET_IDS = ['market', 'nh-market', 'it-market'];
export const DELI_IDS = ['rshop', 'nh-deli'];
/** Ebenezer's is the Mutual Bank's head office; every other counter opens mornings only. */
export const COUNTER_IDS = ['rbank', 'pbank', 'nh-bank', 'nh-rbank', 'nh-pbank', 'it-bank', 'it-sbank', 'it-nbank'];

// ─── The books ──────────────────────────────────────────────────────────────

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
}

export const BUSINESSES: BusinessSpec[] = [
  // ── Emmaus ──
  { id: 'market', kind: 'market', city: 'emmaus', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 40_000, '1200': 90_000, '1500': 150_000 }, openingMemo: 'Opening balances: float, stock and shop fittings', cogs: 0.7, overhead: 2_800, dep: 150_000 / 120, walkIn: 4_000, localFood: 0.8, localGoods: 0.5 },
  { id: 'farm', kind: 'farm', city: 'emmaus', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'farmer', opening: { '1020': 50_000, '1200': 120_000, '1500': 600_000 }, openingMemo: 'Opening balances: float, livestock and standing crops, tractor and implements', outputBase: 60_000, outputPerHand: 22_000, dep: 600_000 / 180 },
  { id: 'workshop', kind: 'workshop', city: 'emmaus', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'builder', opening: { '1020': 15_000, '1500': 80_000 }, openingMemo: 'Opening balances: float and tools', dep: 80_000 / 60 },
  { id: 'office', kind: 'office', city: 'emmaus', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 120_000, '1500': 300_000 }, openingMemo: 'Opening balances: working capital and equipment', dep: 300_000 / 120 },
  { id: 'church', kind: 'church', city: 'emmaus', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 60_000, '1500': 1_500_000 }, openingMemo: 'Opening balances: building fund and church property', util: 2_500, other: 1_500 },
  { id: 'rchurch', kind: 'church', city: 'emmaus', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 140_000, '1500': 2_600_000 }, openingMemo: 'Opening balances: building fund and chapel property', util: 3_200, other: 2_200 },
  { id: 'pchurch', kind: 'church', city: 'emmaus', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 9_000, '1500': 180_000 }, openingMemo: 'Opening balances: offering float, tent and stand', util: 700, other: 350 },
  { id: 'rshop', kind: 'shop', city: 'emmaus', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 70_000, '1200': 150_000, '1500': 260_000 }, openingMemo: 'Opening balances: float, stock and shopfitting', cogs: 0.62, overhead: 2_200, dep: 260_000 / 120, walkIn: 6_000, localFood: 0.85, localGoods: 0.5 },
  { id: 'pshop', kind: 'shop', city: 'emmaus', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 5_000, '1200': 15_000, '1500': 22_000 }, openingMemo: 'Opening balances: float, stock and the container', cogs: 0.72, overhead: 450, dep: 22_000 / 60, localFood: 0.9, localGoods: 0.7 },
  { id: 'rpractice', kind: 'practice', city: 'emmaus', regime: 'cit', vatRegistered: true, sdl: true, ownerJob: 'attorney', opening: { '1020': 160_000, '1500': 420_000 }, openingMemo: 'Opening balances: working capital, library and equipment', retainer: 52_000, running: 6_500, dep: 420_000 / 120 },
  { id: 'ptaxi', kind: 'taxi', city: 'emmaus', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 40_000, '1500': 700_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 15_000, dep: 700_000 / 96 },
  { id: 'combank', kind: 'combank', city: 'emmaus', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 450_000, '1500': 1_100_000 }, openingMemo: 'Opening balances: working capital, systems and premises', publicFees: 26_000, correspondentFees: 22_000, treasury: 55_000, running: 14_000, dep: 1_100_000 / 120 },
  // ── Newhaven ──
  { id: 'nh-market', kind: 'shop', city: 'newhaven', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 40_000, '1200': 90_000, '1500': 150_000 }, openingMemo: 'Opening balances: float, stock and shop fittings', cogs: 0.7, overhead: 2_800, dep: 150_000 / 120, walkIn: 4_000, localFood: 0.8, localGoods: 0.5 },
  { id: 'nh-deli', kind: 'shop', city: 'newhaven', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 70_000, '1200': 150_000, '1500': 260_000 }, openingMemo: 'Opening balances: float, stock and shopfitting', cogs: 0.62, overhead: 2_200, dep: 260_000 / 120, walkIn: 5_000, localFood: 0.85, localGoods: 0.5 },
  { id: 'nh-spaza', kind: 'shop', city: 'newhaven', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 6_000, '1200': 18_000, '1500': 30_000 }, openingMemo: 'Opening balances: float, stock and fittings', cogs: 0.72, overhead: 500, dep: 30_000 / 60, localFood: 0.88, localGoods: 0.65 },
  { id: 'nh-farm', kind: 'farm', city: 'newhaven', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'farmer', opening: { '1020': 45_000, '1200': 90_000, '1500': 480_000 }, openingMemo: 'Opening balances: float, nursery stock, tunnels and a tractor', outputBase: 48_000, outputPerHand: 20_000, dep: 480_000 / 180 },
  { id: 'nh-workshop', kind: 'workshop', city: 'newhaven', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'builder', opening: { '1020': 18_000, '1500': 110_000 }, openingMemo: 'Opening balances: float, tools and the spray booth', dep: 110_000 / 60 },
  { id: 'nh-office', kind: 'office', city: 'newhaven', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 140_000, '1500': 320_000 }, openingMemo: 'Opening balances: working capital and equipment', dep: 320_000 / 120 },
  { id: 'nh-chambers', kind: 'practice', city: 'newhaven', regime: 'cit', vatRegistered: true, sdl: true, ownerJob: 'attorney', opening: { '1020': 150_000, '1500': 400_000 }, openingMemo: 'Opening balances: working capital, library and equipment', retainer: 50_000, running: 6_000, dep: 400_000 / 120 },
  { id: 'nh-taxi', kind: 'taxi', city: 'newhaven', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 40_000, '1500': 700_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 15_000, dep: 700_000 / 96 },
  { id: 'nh-combank', kind: 'combank', city: 'newhaven', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 400_000, '1500': 1_000_000 }, openingMemo: 'Opening balances: working capital, systems and premises', publicFees: 22_000, correspondentFees: 12_000, treasury: 48_000, running: 13_000, dep: 1_000_000 / 120 },
  // ── Ithemba ──
  { id: 'it-market', kind: 'shop', city: 'ithemba', regime: 'sbc', vatRegistered: true, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 25_000, '1200': 60_000, '1500': 90_000 }, openingMemo: 'Opening balances: float, stock and shop fittings', cogs: 0.72, overhead: 2_000, dep: 90_000 / 120, walkIn: 2_500, localFood: 0.85, localGoods: 0.6 },
  { id: 'it-sspaza', kind: 'shop', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 4_000, '1200': 12_000, '1500': 18_000 }, openingMemo: 'Opening balances: float, stock and the container', cogs: 0.74, overhead: 400, dep: 18_000 / 60, localFood: 0.9, localGoods: 0.7 },
  { id: 'it-nspaza', kind: 'shop', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 4_000, '1200': 12_000, '1500': 18_000 }, openingMemo: 'Opening balances: float, stock and the container', cogs: 0.74, overhead: 400, dep: 18_000 / 60, localFood: 0.9, localGoods: 0.7 },
  { id: 'it-farm', kind: 'farm', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'farmer', opening: { '1020': 12_000, '1200': 40_000, '1500': 160_000 }, openingMemo: 'Opening balances: float, goats and maize, a second-hand tractor', outputBase: 32_000, outputPerHand: 14_000, dep: 160_000 / 180 },
  { id: 'it-workshop', kind: 'workshop', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'builder', opening: { '1020': 8_000, '1500': 45_000 }, openingMemo: 'Opening balances: float and welding gear', dep: 45_000 / 60 },
  { id: 'it-office', kind: 'office', city: 'ithemba', regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 60_000, '1500': 120_000 }, openingMemo: 'Opening balances: grant funding and equipment', dep: 120_000 / 120 },
  { id: 'it-church', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 30_000, '1500': 900_000 }, openingMemo: 'Opening balances: building fund and church property', util: 1_800, other: 1_000 },
  { id: 'it-schurch', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 12_000, '1500': 320_000 }, openingMemo: 'Opening balances: offering float and the hall', util: 900, other: 500 },
  { id: 'it-nchurch', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 7_000, '1500': 150_000 }, openingMemo: 'Opening balances: offering float, tent and stand', util: 600, other: 300 },
  { id: 'it-taxi', kind: 'taxi', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 30_000, '1500': 620_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 15_000, dep: 620_000 / 96 },
  // ── The centre ──
  { id: 'mall', kind: 'mall', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 600_000, '1200': 1_400_000, '1500': 3_500_000 }, openingMemo: 'Opening balances: float, stock across the shops, the building and fittings', cogs: 0.66, overhead: 24_000, dep: 3_500_000 / 240, walkIn: 40_000, localFood: 0.5, localGoods: 0.55 },
  { id: 'towers', kind: 'office', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 400_000, '1500': 900_000 }, openingMemo: 'Opening balances: working capital and the corporate floors', dep: 900_000 / 120 },
  { id: 'un-chambers', kind: 'practice', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, ownerJob: 'attorney', opening: { '1020': 180_000, '1500': 450_000 }, openingMemo: 'Opening balances: working capital, library and equipment', retainer: 56_000, running: 7_000, dep: 450_000 / 120 },
  { id: 'terminus', kind: 'taxi', city: 'unity', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 50_000, '1500': 760_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 18_000, dep: 760_000 / 96 },
  { id: 'un-pharmacy', kind: 'shop', city: 'unity', regime: 'sbc', vatRegistered: true, sdl: false, opening: { '1020': 30_000, '1200': 80_000, '1500': 120_000 }, openingMemo: 'Opening balances: float, dispensary stock and fittings', cogs: 0.68, overhead: 3_000, dep: 120_000 / 120, walkIn: 12_000, localFood: 0, localGoods: 0 },
  // ── Getting about (finance/transport.ts) ──
  // The province's bus and Hyperline operator: a public entity exempt from income tax (s10(1)(cA)); passenger fares by
  // road and rail are VAT-exempt (s12(g)), so it is not a vendor. The buses, the guideway and the trains are provincial
  // assets made available to it; only the running of the network sits in its books, topped up by the operations grant.
  { id: 'transit', name: 'Unity Transit', kind: 'transit', city: 'unity', regime: 'exempt', vatRegistered: false, sdl: true, opening: { '1020': 1_400_000 }, openingMemo: 'Opening balances: working capital from the provincial transport department (the fleet and the Hyperline are provincial assets)' },
  // The e-hailing app: an agent for its driver-partners, earning a 25% service fee and a booking fee (standard-rated).
  { id: 'hamba', name: 'Hamba (e-hailing app)', kind: 'platform', city: 'unity', regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 120_000, '1500': 60_000 }, openingMemo: 'Opening balances: working capital and the app platform', dep: 60_000 / 36 },
  // Rents small cars to driver-partners by the week; a car-rental business may claim input VAT on its cars (s17(2)(c)).
  { id: 'fleet', name: 'Unity Fleet Rentals', kind: 'fleet', city: 'unity', regime: 'sbc', vatRegistered: true, sdl: false, opening: { '1020': 120_000 }, openingMemo: 'Opening balances: working capital (the cars are brought in at cost)' },
  // The airport company (a state-owned company, taxed and a VAT vendor): landing fees and the passenger service charge from the airline, and the kiosk concession.
  { id: 'airportco', name: 'Unity Provincial Airport Company', kind: 'airport', city: 'airport', regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 450_000, '1500': 2_400_000 }, openingMemo: 'Opening balances: working capital, terminal systems and ground equipment (the runway is provincial)', dep: 2_400_000 / 240 },
];

export const BUSINESS: Record<string, BusinessSpec> = Object.fromEntries(BUSINESSES.map((b) => [b.id, b]));

/** Public institutions: the state pays their staff. */
export const PUBLIC_WORKPLACES = new Set<string>(['clinic', 'school', 'police', 'court', 'medical', 'council', 'nh-clinic', 'nh-school', 'nh-police', 'nh-court', 'nh-medical', 'nh-council', 'nh-library', 'nh-hall', 'nh-youth', 'nh-rank', 'it-clinic', 'it-school', 'it-police', 'it-court', 'it-medical', 'it-council', 'it-post', 'it-hall', 'it-skills', 'it-rank', 'hospital', 'un-ambulance', 'govt', 'reservebank', 'un-police', 'stadium', 'concert', 'un-sports', 'grandpark', 'un-gardens', 'un-square', 'hall', 'ap-terminal', 'ap-tower', 'ap-hangar', 'ap-fire']);

/** The businesses in a city (for its chambers' and commercial bank's clients). */
export function businessesIn(city: CityId, kinds?: BusinessKind[]): BusinessSpec[] {
  return BUSINESSES.filter((b) => b.city === city && (!kinds || kinds.includes(b.kind)));
}

/** The shop a settlement's households buy at, with its local-spend shares. */
export function shopOf(community: CommunityId | null | undefined): BusinessSpec {
  return BUSINESS[landmark(community, 'shop')] ?? BUSINESS.market;
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
