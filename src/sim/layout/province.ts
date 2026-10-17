// Unity Province, the built-in world: three cities, the centre they share and
// the airport, drawn by hand in the files beside this one. This module gathers
// them into an atlas, with every institutional choice stated rather than
// derived — which church each settlement attends, whose chambers brief which
// city's firms, the posts every city fills first — so the province runs
// exactly as it always has.
//
//   Emmaus (0..1400 × 0..1120, NW)         the original district, now the rich city
//   Newhaven (3000..4400 × 0..1120, NE)    the secular city
//   Ithemba (1500..2900 × 2300..3420, S)   the poor, church-going city
//   Unity Centre (between them)            hospital campus · CBD & government · Unity Park
//   The airport (3725..4400 × 1200..3000)  terminal, tower, hangar and runway, SE

import { landmarkIn, type Atlas, type BusLine, type BusinessSpec, type CitySpec, type CommunitySpec, type EssentialPost, type ExitSpec, type LandmarkKind, type Landmarks } from '../atlas';
import type { CityId, CommunityId } from '../types';
import { AIRPORT_SEGMENTS, RUNWAY, airportBuildings } from './airport';
import { resetSpots } from './builders';
import { EMMAUS_SEGMENTS, emmausBuildings, emmausPlots } from './emmaus';
import { STATIONS, TRACK, hyperlineBuildings } from './hyperline';
import { ITHEMBA_SEGMENTS, ithembaBuildings, ithembaPlots } from './ithemba';
import { NEWHAVEN_SEGMENTS, newhavenBuildings, newhavenPlots } from './newhaven';
import type { PlotSpec, Segment } from './plots';
import { CENTRAL_X, UNITY_SEGMENTS, unityBuildings } from './unity';

export const PROVINCE_ID = 'unity-province';
export const PROVINCE_W = 4400;
export const PROVINCE_H = 3420;

// ─── Cities and settlements ─────────────────────────────────────────────────

const CITIES: CitySpec[] = [
  { id: 'emmaus', name: 'Emmaus', short: 'Emmaus', kind: 'city', x: 0, y: 0, w: 1400, h: 1120, religious: true, faith: null, blurb: 'the rich city: three churchgoing settlements, from comfortable Kanana to the Hebron estates', tagline: 'the rich city' },
  { id: 'newhaven', name: 'Newhaven', short: 'Newhaven', kind: 'city', x: 3000, y: 0, w: 1400, h: 1120, religious: false, faith: 0.06, blurb: 'the secular city: no church, mosque or temple; a library and a memorial hall instead', tagline: 'the secular city' },
  { id: 'ithemba', name: 'Ithemba', short: 'Ithemba', kind: 'city', x: 1500, y: 2300, w: 1400, h: 1120, religious: true, faith: null, blurb: 'the poor city: three devout townships around a crossroads', tagline: 'the poor city' },
  { id: 'unity', name: 'Unity Centre', short: 'Unity', kind: 'centre', x: 1640, y: 380, w: 1140, h: 1920, religious: false, faith: null, blurb: 'the shared centre: hospital campus, CBD and government, and Unity Park' },
  { id: 'airport', name: 'Unity Provincial Airport', short: 'Airport', kind: 'airport', x: 3725, y: 1200, w: 675, h: 1800, religious: false, faith: null, blurb: "the province's airport: terminal, control tower, hangar and a 1.6 km runway, at the end of the Hyperline", tagline: 'Unity Provincial' },
];

const COMMUNITIES: CommunitySpec[] = [
  // Emmaus
  { id: 'ebenezer', city: 'emmaus', name: 'Ebenezer', short: 'Ebenezer', tier: 'affluent', x: 20, y: 40, w: 640, h: 480, seedOrder: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 7, 15, 8, 16], seedHouseholds: 12 },
  { id: 'hebron', city: 'emmaus', name: 'Hebron Heights', short: 'Hebron', tier: 'ultra', x: 860, y: 60, w: 520, h: 410, seedOrder: [21, 23, 25, 28, 30, 22, 27, 26, 29, 24], seedHouseholds: 8 },
  { id: 'kanana', city: 'emmaus', name: 'Kanana', short: 'Kanana', tier: 'comfortable', x: 400, y: 760, w: 660, h: 340, seedOrder: [41, 44, 47, 50, 53, 42, 45, 48, 51, 54, 43, 46, 49, 52], seedHouseholds: 12 },
  { id: 'crossing', city: 'emmaus', name: 'Emmaus Crossing', short: 'Crossing', tier: 'civic', x: 640, y: 550, w: 360, h: 210, seedOrder: [], seedHouseholds: 0 },
  // Newhaven
  { id: 'bellevue', city: 'newhaven', name: 'Bellevue Heights', short: 'Bellevue', tier: 'affluent', x: 3020, y: 60, w: 520, h: 410, seedOrder: [101, 103, 105, 108, 110, 102, 107, 106, 109, 104], seedHouseholds: 8 },
  { id: 'oakdale', city: 'newhaven', name: 'Oakdale', short: 'Oakdale', tier: 'middle', x: 3740, y: 40, w: 640, h: 480, seedOrder: [111, 112, 113, 114, 115, 116, 119, 120, 121, 122, 123, 124, 117, 125, 118, 126], seedHouseholds: 12 },
  { id: 'westbrook', city: 'newhaven', name: 'Westbrook', short: 'Westbrook', tier: 'working', x: 3340, y: 760, w: 700, h: 340, seedOrder: [131, 134, 137, 140, 143, 132, 135, 138, 141, 144, 133, 136, 139, 142], seedHouseholds: 12 },
  { id: 'central', city: 'newhaven', name: 'Newhaven Central', short: 'Central', tier: 'civic', x: 3320, y: 550, w: 440, h: 210, seedOrder: [], seedHouseholds: 0 },
  // Ithemba
  { id: 'bethesda', city: 'ithemba', name: 'Bethesda', short: 'Bethesda', tier: 'working', x: 1520, y: 2900, w: 640, h: 480, seedOrder: [201, 202, 203, 204, 205, 206, 209, 210, 211, 212, 213, 214, 207, 215, 208, 216], seedHouseholds: 12 },
  { id: 'siyakha', city: 'ithemba', name: 'Siyakha', short: 'Siyakha', tier: 'low-income', x: 2360, y: 2950, w: 520, h: 410, seedOrder: [221, 224, 227, 230, 233, 222, 225, 228, 231, 234, 223, 226, 229, 232], seedHouseholds: 12 },
  { id: 'nazareth', city: 'ithemba', name: 'Nazareth', short: 'Nazareth', tier: 'low-income', x: 1900, y: 2320, w: 660, h: 340, seedOrder: [241, 244, 247, 250, 253, 242, 245, 248, 251, 254, 243, 246, 249, 252], seedHouseholds: 12 },
  { id: 'crossroads', city: 'ithemba', name: 'Ithemba Crossroads', short: 'Crossroads', tier: 'civic', x: 1980, y: 2662, w: 420, h: 218, seedOrder: [], seedHouseholds: 0 },
  // Unity Centre
  { id: 'campus', city: 'unity', name: 'Hospital campus', short: 'Campus', tier: 'civic', x: 1880, y: 400, w: 460, h: 320, seedOrder: [], seedHouseholds: 0 },
  { id: 'cbd', city: 'unity', name: 'Unity CBD', short: 'CBD', tier: 'civic', x: 1690, y: 1230, w: 1040, h: 490, seedOrder: [], seedHouseholds: 0 },
  { id: 'precinct', city: 'unity', name: 'Unity Park', short: 'Park', tier: 'civic', x: 1650, y: 1810, w: 1120, h: 470, seedOrder: [], seedHouseholds: 0 },
  // The airport
  { id: 'airfield', city: 'airport', name: 'Unity Provincial Airport', short: 'Airport', tier: 'civic', x: 3728, y: 1220, w: 664, h: 1760, seedOrder: [], seedHouseholds: 0 },
];

// ─── Roads, plots and buildings ─────────────────────────────────────────────

const SEGMENTS: Segment[] = [...EMMAUS_SEGMENTS, ...NEWHAVEN_SEGMENTS, ...ITHEMBA_SEGMENTS, ...UNITY_SEGMENTS, ...AIRPORT_SEGMENTS];

function provincePlots(): PlotSpec[] {
  return [...emmausPlots(), ...newhavenPlots(), ...ithembaPlots()];
}

function provinceBuildings() {
  resetSpots();
  return { ...emmausBuildings(), ...newhavenBuildings(), ...ithembaBuildings(), ...unityBuildings(), ...hyperlineBuildings(), ...airportBuildings() };
}

/** Province exit / entry points (migrants, intruders, the long-distance taxis) with their road nodes. */
const EXITS: ExitSpec[] = [
  { id: 'west', x: 0, y: 280, node: 'n0_280' },
  { id: 'east', x: 4400, y: 280, node: 'n4400_280' },
  { id: 'north', x: CENTRAL_X, y: 0, node: `n${CENTRAL_X}_0` },
  { id: 'south', x: 1600, y: 3420, node: 'n1600_3420' },
];

// ─── Landmarks: what each settlement and city calls its own ─────────────────

/** What a settlement keeps for itself: its congregation, shop, bank counter, park and bus stop. */
const SETTLEMENT_LANDMARKS: Record<CommunityId, Landmarks> = {
  ebenezer: { church: 'church', shop: 'market', bank: 'bank', park: 'park', busstop: 'busstop' },
  hebron: { church: 'rchurch', shop: 'rshop', bank: 'rbank', park: 'rpark', busstop: 'busstop' },
  kanana: { church: 'pchurch', shop: 'pshop', bank: 'pbank', park: 'ppitch', busstop: 'pbusstop' },
  crossing: { shop: 'market', bank: 'combank', park: 'plaza', busstop: 'busstop' },
  bellevue: { shop: 'nh-deli', bank: 'nh-rbank', park: 'nh-green', busstop: 'nh-busstop' },
  oakdale: { shop: 'nh-market', bank: 'nh-bank', park: 'nh-park', busstop: 'nh-busstop' },
  westbrook: { shop: 'nh-spaza', bank: 'nh-pbank', park: 'nh-grounds', busstop: 'nh-pbusstop' },
  central: { shop: 'nh-market', bank: 'nh-combank', park: 'nh-plaza', busstop: 'nh-busstop' },
  bethesda: { church: 'it-church', shop: 'it-market', bank: 'it-bank', park: 'it-park', busstop: 'it-busstop' },
  siyakha: { church: 'it-schurch', shop: 'it-sspaza', bank: 'it-sbank', park: 'it-sgrounds', busstop: 'it-busstop' },
  nazareth: { church: 'it-nchurch', shop: 'it-nspaza', bank: 'it-nbank', park: 'it-ngrounds', busstop: 'it-nbusstop' },
  crossroads: { shop: 'it-market', bank: 'it-bank', park: 'it-plaza', busstop: 'it-busstop' },
  campus: { shop: 'un-pharmacy', park: 'grandpark', busstop: 'un-hstop' },
  cbd: { shop: 'mall', bank: 'reservebank', park: 'un-square', busstop: 'terminus' },
  precinct: { shop: 'mall', park: 'grandpark', busstop: 'un-pstop' },
  airfield: { shop: 'ap-terminal', bank: 'nh-combank', park: 'un-gardens', busstop: 'ap-busstop' },
};

/** What a city keeps for all its settlements: school, clinic, police station, court, council, medical centre, cemetery, hall, taxi rank, workshop, offices and farm. */
const CITY_LANDMARKS: Record<CityId, Landmarks> = {
  emmaus: { school: 'school', clinic: 'clinic', police: 'police', court: 'court', council: 'council', medical: 'medical', cemetery: 'cemetery', hall: 'hall', taxi: 'ptaxi', workshop: 'workshop', office: 'office', farm: 'farm', shop: 'market', bank: 'bank', park: 'park', busstop: 'busstop' },
  newhaven: { school: 'nh-school', clinic: 'nh-clinic', police: 'nh-police', court: 'nh-court', council: 'nh-council', medical: 'nh-medical', cemetery: 'nh-cemetery', hall: 'nh-hall', taxi: 'nh-taxi', workshop: 'nh-workshop', office: 'nh-office', farm: 'nh-farm', library: 'nh-library', shop: 'nh-market', bank: 'nh-bank', park: 'nh-park', busstop: 'nh-busstop' },
  ithemba: { school: 'it-school', clinic: 'it-clinic', police: 'it-police', court: 'it-court', council: 'it-council', medical: 'it-medical', cemetery: 'it-cemetery', hall: 'it-hall', taxi: 'it-taxi', workshop: 'it-workshop', office: 'it-office', farm: 'it-farm', shop: 'it-market', bank: 'it-bank', park: 'it-park', busstop: 'it-busstop' },
  // The centre has no residents; its staff belong to their home cities. What it does have covers the region.
  unity: { clinic: 'hospital', police: 'un-police', taxi: 'terminus', office: 'towers', shop: 'mall', park: 'grandpark', busstop: 'terminus' },
  // The airport is served from the centre and Newhaven.
  airport: { clinic: 'hospital', police: 'un-police', taxi: 'terminus', office: 'ap-terminal', shop: 'ap-terminal', park: 'un-gardens', busstop: 'ap-busstop', medical: 'nh-medical', court: 'nh-court', council: 'nh-council', school: 'nh-school', cemetery: 'nh-cemetery', hall: 'nh-hall', workshop: 'ap-hangar', farm: 'nh-farm', bank: 'nh-combank' },
};

// ─── Public transport ───────────────────────────────────────────────────────

/** One bus line per city into the centre (by the hospital or the park), and the airport shuttle. */
const BUS_LINES: BusLine[] = [
  { id: 'emmaus', name: 'Emmaus Line', stops: ['pbusstop', 'busstop', 'rbusstop', 'un-hstop', 'terminus'] },
  { id: 'newhaven', name: 'Newhaven Line', stops: ['nh-pbusstop', 'nh-rank', 'nh-rbusstop', 'un-hstop', 'terminus'] },
  { id: 'ithemba', name: 'Ithemba Line', stops: ['it-sbusstop', 'it-busstop', 'it-nbusstop', 'un-pstop', 'terminus'] },
  { id: 'airport', name: 'Airport Shuttle', stops: ['terminus', 'ap-busstop'] },
];

// ─── The institutions ───────────────────────────────────────────────────────

/** The chambers a city's attorneys and accountants practise from; Ithemba's use the regional chambers at the centre. */
const CHAMBERS_BY_CITY: Record<CityId, string> = { emmaus: 'rpractice', newhaven: 'nh-chambers', ithemba: 'un-chambers', unity: 'un-chambers', airport: 'nh-chambers' };
/** The commercial bank a city's firms bank with. */
const COMBANK_BY_CITY: Record<CityId, string> = { emmaus: 'combank', newhaven: 'nh-combank', ithemba: 'combank', unity: 'combank', airport: 'nh-combank' };

const BUSINESSES: BusinessSpec[] = [
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
  { id: 'combank', kind: 'combank', city: 'emmaus', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 450_000, '1500': 1_100_000 }, openingMemo: 'Opening balances: working capital, systems and premises', publicFees: 26_000, correspondentFees: 22_000, treasury: 55_000, running: 14_000, dep: 1_100_000 / 120, clientCities: ['emmaus', 'ithemba', 'unity'] },
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
  { id: 'it-office', kind: 'office', city: 'ithemba', regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 60_000, '1500': 120_000 }, openingMemo: 'Opening balances: grant funding and equipment', dep: 120_000 / 120, fees: 4_000, invoiceMemo: 'Grant income and services invoiced (standard-rated)' },
  { id: 'it-church', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 30_000, '1500': 900_000 }, openingMemo: 'Opening balances: building fund and church property', util: 1_800, other: 1_000 },
  { id: 'it-schurch', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 12_000, '1500': 320_000 }, openingMemo: 'Opening balances: offering float and the hall', util: 900, other: 500 },
  { id: 'it-nchurch', kind: 'church', city: 'ithemba', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': 7_000, '1500': 150_000 }, openingMemo: 'Opening balances: offering float, tent and stand', util: 600, other: 300 },
  { id: 'it-taxi', kind: 'taxi', city: 'ithemba', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 30_000, '1500': 620_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 15_000, dep: 620_000 / 96 },
  // ── The centre ──
  { id: 'mall', kind: 'mall', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 600_000, '1200': 1_400_000, '1500': 3_500_000 }, openingMemo: 'Opening balances: float, stock across the shops, the building and fittings', cogs: 0.66, overhead: 24_000, dep: 3_500_000 / 240, walkIn: 40_000, localFood: 0.5, localGoods: 0.55 },
  { id: 'towers', kind: 'office', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 400_000, '1500': 900_000 }, openingMemo: 'Opening balances: working capital and the corporate floors', dep: 900_000 / 120, fees: 30_000, admin: 18_000, utilities: 10_000, corporate: true },
  { id: 'un-chambers', kind: 'practice', city: 'unity', regime: 'cit', vatRegistered: true, sdl: true, ownerJob: 'attorney', opening: { '1020': 180_000, '1500': 450_000 }, openingMemo: 'Opening balances: working capital, library and equipment', retainer: 56_000, running: 7_000, dep: 450_000 / 120, clientCities: ['ithemba'] },
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

/** Public institutions: the state pays their staff. */
const PUBLIC_WORKPLACES = ['clinic', 'school', 'police', 'court', 'medical', 'council', 'nh-clinic', 'nh-school', 'nh-police', 'nh-court', 'nh-medical', 'nh-council', 'nh-library', 'nh-hall', 'nh-youth', 'nh-rank', 'it-clinic', 'it-school', 'it-police', 'it-court', 'it-medical', 'it-council', 'it-post', 'it-hall', 'it-skills', 'it-rank', 'hospital', 'un-ambulance', 'govt', 'reservebank', 'un-police', 'stadium', 'concert', 'un-sports', 'grandpark', 'un-gardens', 'un-square', 'hall', 'ap-terminal', 'ap-tower', 'ap-hangar', 'ap-fire'];

/** Survivalist spazas, the general dealers, the delis and the mall. */
const SPAZA_IDS = ['pshop', 'nh-spaza', 'it-sspaza', 'it-nspaza'];
const MARKET_IDS = ['market', 'nh-market', 'it-market'];
const DELI_IDS = ['rshop', 'nh-deli'];
/** Ebenezer's is the Mutual Bank's head office; every other counter opens mornings only. */
const COUNTER_IDS = ['rbank', 'pbank', 'nh-bank', 'nh-rbank', 'nh-pbank', 'it-bank', 'it-sbank', 'it-nbank'];

/**
 * Every post the region cannot do without, city by city and then the centre:
 * a congregation without its pastor, a clinic without a nurse or a court
 * without a magistrate is not a community. The list is built from the
 * layouts, so a city with no church simply has no pastorate.
 */
function provinceEssentialPosts(a: Atlas): EssentialPost[] {
  const landmark = (com: CommunityId, kind: LandmarkKind) => landmarkIn(a, com, kind);
  const out: EssentialPost[] = [];
  // The best-paid posts in the region are filled first, so they draw the best-qualified.
  for (let i = 0; i < 2; i++) out.push({ job: 'executive', workplace: 'towers' });
  for (let i = 0; i < 2; i++) out.push({ job: 'surgeon', workplace: 'hospital' });
  for (let i = 0; i < 2; i++) out.push({ job: 'centralbanker', workplace: 'reservebank' });
  for (let i = 0; i < 2; i++) out.push({ job: 'pilot', workplace: 'ap-terminal' });
  for (const city of a.cities) {
    if (city.kind !== 'city') continue;
    const coms = a.communities.filter((c) => c.city === city.id);
    const residential = coms.filter((c) => c.tier !== 'civic');
    const first = residential[0].id;
    const L = (k: LandmarkKind) => landmark(first, k)!;
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
    for (const c of residential) out.push({ job: 'shopkeeper', workplace: landmark(c.id, 'shop')!, community: c.id });
    for (const c of residential) out.push({ job: 'banker', workplace: landmark(c.id, 'bank')!, community: c.id });
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

/** The buildings of one landmark kind across the province, in settlement order. */
function landmarksOfKindIn(a: Atlas, kind: LandmarkKind): string[] {
  const out: string[] = [];
  for (const c of a.communities) {
    const id = landmarkIn(a, c.id, kind);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

let cached: Atlas | null = null;

/** The built-in province (built once; its buildings are built afresh for every run). */
export function provinceAtlas(): Atlas {
  if (cached) return cached;
  const a: Atlas = {
    id: PROVINCE_ID,
    name: null,
    region: null,
    plan: null,
    hash: '',
    width: PROVINCE_W,
    height: PROVINCE_H,
    cities: CITIES,
    communities: COMMUNITIES,
    defaultCommunity: 'ebenezer',
    defaultCity: 'emmaus',
    baseline: 'ebenezer',
    segments: SEGMENTS,
    plots: provincePlots(),
    buildings: provinceBuildings,
    settlementLandmarks: SETTLEMENT_LANDMARKS,
    cityLandmarks: CITY_LANDMARKS,
    regionLandmarks: {},
    houseLandmarks: {},
    fallbackCity: 'emmaus',
    churchIds: [],
    clinicIds: ['clinic', 'nh-clinic', 'it-clinic', 'hospital'],
    courtIds: ['court', 'nh-court', 'it-court'],
    policeIds: ['police', 'nh-police', 'it-police', 'un-police'],
    councilIds: { emmaus: 'council', newhaven: 'nh-council', ithemba: 'it-council', unity: null, airport: null },
    taxiRankIds: ['ptaxi', 'nh-taxi', 'it-taxi', 'terminus'],
    centralHospital: 'hospital',
    ambulanceBases: [{ id: 'clinic', n: 1 }, { id: 'nh-clinic', n: 1 }, { id: 'it-clinic', n: 1 }, { id: 'un-ambulance', n: 2 }, { id: 'ap-fire', n: 1 }],
    airportTerminal: 'ap-terminal',
    busHub: 'terminus',
    busLines: BUS_LINES,
    track: TRACK,
    stations: STATIONS,
    runway: { ...RUNWAY },
    exits: EXITS,
    businesses: BUSINESSES,
    publicWorkplaces: PUBLIC_WORKPLACES,
    spazaIds: SPAZA_IDS,
    marketIds: MARKET_IDS,
    deliIds: DELI_IDS,
    counterIds: COUNTER_IDS,
    bankHq: 'bank',
    chambersByCity: CHAMBERS_BY_CITY,
    combankByCity: COMBANK_BY_CITY,
    essentialPosts: [],
    jobSites: {
      region: { surgeon: 'hospital', executive: 'towers', civilservant: 'govt', centralbanker: 'reservebank', librarian: 'nh-library', pilot: 'ap-terminal', busdriver: 'terminus' },
      city: { ithemba: { civilservant: 'it-post' } },
    },
    produceMarket: 'market',
    produceFarm: 'farm',
    venues: { grandpark: 'grandpark', sports: 'un-sports', mall: 'mall', stadium: 'stadium', concert: 'concert', centre: 'mall', centralStation: 'st-unity' },
    marketScale: 1,
    publicServicesCost: 48_000 * 3 + 95_000,
    publicServicesMemo: "Public services: three cities' clinics, schools, police, courts and councils; the central hospital, Government House, the Reserve Bank and Unity Park",
    ownerNames: [
      { id: 'farm', job: 'farmer', pattern: '{surname} Farm' },
      { id: 'nh-farm', job: 'farmer', pattern: '{surname} Market Garden' },
      { id: 'workshop', job: 'builder', pattern: "{surname}'s Workshop" },
      { id: 'it-workshop', job: 'builder', pattern: "{surname}'s Welding & Repairs" },
      { id: 'pshop', job: 'shopkeeper', pattern: "{surname}'s Spaza", female: "Mama {first}'s Spaza" },
      { id: 'nh-spaza', job: 'shopkeeper', pattern: "{surname}'s Superette" },
      { id: 'it-sspaza', job: 'shopkeeper', pattern: "{surname}'s Spaza", female: "Mama {first}'s Spaza" },
      { id: 'it-nspaza', job: 'shopkeeper', pattern: "{surname}'s Spaza", female: "Mama {first}'s Spaza" },
    ],
  };
  a.churchIds = landmarksOfKindIn(a, 'church');
  a.essentialPosts = provinceEssentialPosts(a);
  cached = a;
  return a;
}
