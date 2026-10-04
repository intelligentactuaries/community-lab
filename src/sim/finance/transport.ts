// Transport economics of the province: what it costs to get about and who
// earns it. Every month:
//
//   1. Fares are set. The minibus-taxi associations raise theirs when diesel and
//      costs have climbed far enough since the last rise (and seldom lower
//      them); Unity Transit's bus and Hyperline fares move each July by CPI + 1%
//      (CPI only when unemployment is up); the airline's fuel surcharge follows
//      Jet A1; and the Hamba app re-prices its rate card from the economy: the
//      driver's costs (fuel, the weekly car rent that moves with the prime rate,
//      the minimum wage) set a floor, and the state of demand (the output gap,
//      real income growth, unemployment) shades it up or down.
//   2. Households choose how to travel. A household without a car spends a
//      share of its budget on getting about that grows with the relative price
//      of fares (price elasticity 0.35) and splits its trips across the minibus
//      taxi, the bus, the Hyperline and e-hailing by a multinomial logit on
//      generalised time (minutes plus fare over the household's value of time),
//      so the estates choose speed and the townships choose price. A household
//      with a car buys petrol at the regulated pump price (short-run elasticity
//      0.25) and takes the odd e-hailing trip.
//   3. The e-hailing market clears. Driver-partners supply online hours; riders
//      (residents, visitors off the planes, and regional trips) demand driver
//      time; when demand exceeds supply the app surges until it no longer does.
//   4. The operators' books: fares in, fuel, electricity, maintenance and the
//      rent out; the platform's service fee; the fleet's cars on vehicle finance
//      from the Mutual Bank; the airport company's landing fees and passenger
//      service charges; the operations grant that keeps Unity Transit running.
//
// Calibration and sources: docs/ASSUMPTIONS.md, "Transport economics".

import type { Ctx } from '../ctx';
import { alivePeople, clamp, householdMembers } from '../ctx';
import { BUSINESS, affluence } from '../institutions';
import { freeYardSlot } from '../parking';
import { createVehicle } from '../population';
import { BUSES_PER_LINE, BUS_DWELL, BUS_HOURS, BUS_LAYOVER, BUS_SPEED, FLIGHTS, PLANE_SEATS, TRAINS, TRAIN_DWELL, TRAIN_HOURS, TRAIN_LAYOVER } from '../transit';
import type { CommunityId, Household, Person, World } from '../types';
import { BUS_LINES, COMMUNITY, STATIONS, roadDistance } from '../world';
import { movement, natural, r2 } from './accounts';
import { pmt, prepayLoan, requestLoan } from './bank';
import type { MarketsState } from './markets';
import { levyPerLitre } from './markets';
import { BANK, GOV, ROW, deposits, hhEntity, pay, payBatch, postInternal, type BatchItem } from './posting';
import type { FinanceState } from './state';

// ─── Parameters ─────────────────────────────────────────────────────────────

/** The platform's service fee on the fare (Uber South Africa 25%, Bolt 20–25%). */
export const COMMISSION = 0.25;
/** Hamba's rate card at a tariff index of 1 (January 2026). Uber's Gauteng card: R8/km, R0.80/min. */
export const RIDE_UNIT = { base: 12, perKm: 7.2, perMin: 0.7, minimum: 32 };
/** Booking fee per trip (incl. VAT), CPI-indexed; not surged. */
const BOOKING_FEE = 4.5;
/** Small hatchback, urban cycle with idling (≈6.8 l/100 km). */
export const RIDE_L_PER_KM = 0.068;
/** Empty kilometres driven per paid kilometre (to the pickup and between fares). */
const DEADHEAD = 0.35;
/** Online hours a full-time driver-partner offers a month (≈ 58 h a week; South African drivers commonly work 10–12 hour days, six days a week), and the most of an online hour spent on trips. */
export const DRIVER_HOURS = 250;
export const U_MAX = 0.72;
/** Utilisation the platform prices for. */
const U_TARGET = 0.6;
/** Airtime, data and the phone mount (R/month, CPI-indexed). */
const DRIVER_PHONE = 350;
/** At most this many driver-partners (the fleet's credit line and the province's size). */
export const MAX_DRIVERS = 12;
/** Ride speed on the province's roads (km/min) and minutes lost at pickup and drop-off. */
const RIDE_KM_PER_MIN = 0.5;
const PICKUP_MIN = 6;

/** Unity Fleet Rentals: the small car it buys, what it keeps back, and its running costs. */
const FLEET_RESIDUAL = 0.3;
const FLEET_LIFE = 48;
const FLEET_LTV = 0.9;
const FLEET_INSURANCE = 1_450; // insurance, tracking and licence, R/month incl. VAT
const FLEET_SERVICE_PER_KM = 0.42; // services and tyres, R/km
const FLEET_KM_MONTH = 4_500;
const FLEET_MARGIN = 0.08;
/** Return the fleet's owners want on the 10% of each car they fund themselves. */
const FLEET_EQUITY_RETURN = 0.15;

/** Unity Transit's timetable costs (January 2026 prices). */
const BUS_L_PER_KM = 0.32;
const BUS_MAINT_PER_KM = 2.8;
/** Traction and guideway systems per train-km; regenerative braking returns most of each launch. */
const TRAIN_KWH_PER_KM = 4.5;
const TRAIN_MAINT_PER_KM = 2.5;
const TRANSIT_ADMIN = 35_000;
const TRANSIT_INSURANCE = 18_000;
/** Boardings a month by riders from beyond the modelled population (the wider province, commuters and visitors). */
const BUS_ROW_BASE = 7_500;
const HYPER_ROW_BASE = 13_000;

/** The airline (a national regional carrier) and the airport company. */
const AIR_FARE_0 = 1_150; // one-way base fare, ex VAT and PSC
const AIR_FUEL_L_PER_PAX = 32; // Jet A1 per passenger per sector for the surcharge
const AIR_LF_0 = 0.62;
const PSC_0 = 190;
const LANDING_0 = 1_100;
const AIRPORT_KWH = 60_000;
const AIRPORT_SECURITY = 140_000;
const AIRPORT_MAINT = 60_000;
const AIRPORT_INSURANCE = 15_000;
const AIRPORT_ADMIN = 25_000;
const AIRPORT_CONCESSION_PER_PAX = 12;

/** Logit on generalised minutes: scale per minute, alternative constants, and the fare-elasticity of the transport budget. */
const THETA = 0.05;
const ASC = { taxi: 0, bus: -0.35, hyper: 0.25, ride: -0.8 };
const BUDGET_ELASTICITY = 0.35;
const FUEL_ELASTICITY = 0.25;
/** Share of a carless household's transport budget spent beyond the province — 60% of it on the long-distance minibus taxi, the rest on intercity coaches — and a car household's on e-hailing. */
const OUT_SHARE = 0.15;
export const OUT_TAXI = 0.6;
const CAR_RIDE_SHARE = 0.04;

// ─── State ──────────────────────────────────────────────────────────────────

export interface RideCard {
  base: number;
  perKm: number;
  perMin: number;
  minimum: number;
  /** Incl. VAT. */
  booking: number;
}

export interface Fares {
  /** Minibus taxi: base + per km, rounded to R0.50 (set by the associations). */
  taxiBase: number;
  taxiPerKm: number;
  /** Unity Transit: flat bus fare; Hyperline boarding charge plus distance. */
  bus: number;
  hyperBoard: number;
  hyperPerKm: number;
  ride: RideCard;
  /** Airline: one-way base fare and fuel surcharge (ex VAT), the passenger service charge and the landing fee (ex VAT). */
  air: number;
  airSurcharge: number;
  psc: number;
  landing: number;
}

export type ModeKey = 'taxi' | 'bus' | 'hyper' | 'ride';

/** A settlement's representative motorised trip: to the centre (Unity Mall, the towers, the hospital and the government). */
export interface SettlementTrip {
  community: CommunityId;
  name: string;
  dKm: number;
  /** Walking metres to and from the bus (null when no line serves both ends), and the kilometres ridden. */
  busWalk: number | null;
  busKm: number;
  /** Walking metres to and from the Hyperline (null when no station is within reach), and the kilometres ridden. */
  hyperWalk: number | null;
  hyperKm: number;
}

export interface RideMonth {
  drivers: number;
  waiting: number;
  onlineHours: number;
  capacityHours: number;
  demandHours: number;
  surge: number;
  /** Share of the demand at the surge that found a car. */
  served: number;
  tripsRes: number;
  tripsRow: number;
  tripsAirport: number;
  tripsRegional: number;
  avgFare: number;
  /** Fares (excl. booking fees), the platform's service fee and booking fees (ex VAT). */
  gross: number;
  commission: number;
  booking: number;
  driverFuel: number;
  driverRent: number;
  driverPhone: number;
  driverNet: number;
  netPerDriver: number;
  netHourly: number;
  reservationHourly: number;
  phi: number;
  phiCost: number;
  demandFactor: number;
  eta: number;
  utilisation: number;
  rentWeekly: number;
  /** Driver-hours demanded at each surge multiplier (for the market diagram). */
  curve: Array<[number, number]>;
  /** How the rate card was set this month. */
  pricing: RidePricing;
}

/** The pricing engine's working: the cost floor, the demand shade, and where the card landed. */
export interface RidePricing {
  /** Target take-home per online hour (1.3 × the minimum wage). */
  target: number;
  fuelPerHour: number;
  fixedPerHour: number;
  tripsPerHour: number;
  /** Mix-weighted fare per trip at a tariff index of 1 (before the booking fee). */
  fareUnit: number;
  phiCost: number;
  gap: number;
  incomeGrowth: number;
  unemploymentDelta: number;
  demand: number;
  want: number;
  phi: number;
}

export interface TransitMonth {
  busKm: number;
  trainKm: number;
  busLitres: number;
  trainKwh: number;
  boardingsBusRes: number;
  boardingsHyperRes: number;
  boardingsBusRow: number;
  boardingsHyperRow: number;
  fareboxRes: number;
  fareboxRow: number;
  costs: number;
  compensation: number;
  subsidy: number;
  /** Fares over running costs, the month and the last twelve. */
  recovery: number;
  recovery12: number;
  /** The SNA 50% test: a market producer when fares cover at least half the costs over the year. */
  market: boolean;
}

export interface AirMonth {
  landings: number;
  seats: number;
  residentTrips: number;
  businessTrips: number;
  rowPax: number;
  loadFactor: number;
  fare: number;
  surcharge: number;
  tickets: number;
  airportRevenue: number;
  airportCosts: number;
}

export interface TransportMonth {
  month: number;
  isoDate: string;
  /** Passenger-fares index and pump-price index (1 = start). */
  fareIndex: number;
  fuelIndex: number;
  spend: { taxi: number; bus: number; hyper: number; ride: number; fuel: number; carOther: number; out: number; air: number };
  trips: { taxi: number; bus: number; hyper: number; ride: number };
  fares: Fares;
  taxiFare: number;
  hyperFare: number;
  rideFare: number;
  ride: RideMonth;
  transit: TransitMonth;
  air: AirMonth;
  /** Trip shares of the carless households by settlement. */
  shares: Record<string, Record<ModeKey, number>>;
  /** Litres bought in the province (for the cost of fuel-levy relief). */
  petrolLitres: number;
  dieselLitres: number;
  levyRevenue: number;
  reliefCost: number;
  events: string[];
}

export interface FleetCar {
  id: string;
  cost: number;
  month: number;
  /** The driver-partner renting it, and the car on the map. */
  driverId: string | null;
  vehicleId: string | null;
  idleMonths: number;
}

export interface TransportState {
  fares: Fares;
  base: Fares;
  /** Hamba's tariff index (rate card = RIDE_UNIT × phi). */
  phi: number;
  rentWeekly: number;
  lastRentReview: number;
  /** The taxi associations' cost index when they last raised fares. */
  taxiCostRef: number;
  taxiLastRise: number;
  lastTransitReview: number;
  lastAirportReview: number;
  fleet: { cars: FleetCar[]; nextId: number; declinedMonth: number; capex: number };
  /** Drivers who signed up and wait for a car (person id → month). */
  waiting: Record<string, number>;
  /** E-hailing trip share by household (the animated day draws on it). */
  hhRide: Record<string, number>;
  geometry: SettlementTrip[] | null;
  /** Day trips by air booked since the last billing: business trips by workplace, leisure trips by household. */
  air: { business: Record<string, number>; leisure: Record<string, number> };
  months: TransportMonth[];
  /** Last month's outcome (drives pricing, entry and exit). */
  last: { netHourly: number; utilisation: number; surge: number; eta: number; mix: { local: number; airport: number; regional: number }; tripsRes: number };
  /** Fares and costs of the transit network, for the rolling SNA test. */
  recoveryHistory: Array<{ fares: number; costs: number }>;
  unemploymentRef: number | null;
}

export function initFares(): Fares {
  return {
    taxiBase: 12,
    taxiPerKm: 1.1,
    bus: 14,
    hyperBoard: 16,
    hyperPerKm: 2.2,
    ride: { base: RIDE_UNIT.base, perKm: RIDE_UNIT.perKm, perMin: RIDE_UNIT.perMin, minimum: RIDE_UNIT.minimum, booking: BOOKING_FEE },
    air: AIR_FARE_0,
    airSurcharge: 0,
    psc: PSC_0,
    landing: LANDING_0,
  };
}

export function initTransport(): TransportState {
  const fares = initFares();
  return {
    fares,
    base: JSON.parse(JSON.stringify(fares)) as Fares,
    phi: 1,
    rentWeekly: 1_850,
    lastRentReview: -1,
    taxiCostRef: 1,
    taxiLastRise: 0,
    lastTransitReview: 0,
    lastAirportReview: 0,
    fleet: { cars: [], nextId: 1, declinedMonth: -99, capex: 0 },
    waiting: {},
    hhRide: {},
    geometry: null,
    air: { business: {}, leisure: {} },
    months: [],
    last: { netHourly: 0, utilisation: 0.5, surge: 1, eta: 7, mix: { local: 0.35, airport: 0.55, regional: 0.1 }, tripsRes: 0 },
    recoveryHistory: [],
    unemploymentRef: null,
  };
}

// ─── Fares ──────────────────────────────────────────────────────────────────

const half = (x: number) => Math.round(x * 2) / 2;

export function taxiFare(f: Fares, dKm: number): number {
  return Math.max(8, half(f.taxiBase + f.taxiPerKm * dKm));
}

export function hyperFare(f: Fares, km: number): number {
  return r2(f.hyperBoard + f.hyperPerKm * km);
}

/** A Hamba fare for a trip: the rate card, the minimum, the surge; the booking fee on top. */
export function rideFare(card: RideCard, dKm: number, surge: number): number {
  const min = dKm / RIDE_KM_PER_MIN;
  return r2(Math.max(card.minimum, card.base + card.perKm * dKm + card.perMin * min) * surge + card.booking);
}

/** The fare before the booking fee (what the driver's 75% applies to). */
function rideFareNet(card: RideCard, dKm: number, surge: number): number {
  return r2(Math.max(card.minimum, card.base + card.perKm * dKm + card.perMin * (dKm / RIDE_KM_PER_MIN)) * surge);
}

export function cardFor(phi: number, cpiF: number): RideCard {
  const k = (x: number) => Math.round(x * phi * 10) / 10;
  return { base: k(RIDE_UNIT.base), perKm: k(RIDE_UNIT.perKm), perMin: Math.round(RIDE_UNIT.perMin * phi * 100) / 100, minimum: Math.round(RIDE_UNIT.minimum * phi), booking: Math.round(BOOKING_FEE * cpiF * 10) / 10 };
}

// ─── Geometry ───────────────────────────────────────────────────────────────

const CENTRE = 'mall';
const REGIONAL_KM = 28;
const AIRPORT_KM = 4.5;

/** Each settlement's representative trip to the centre and its access to the bus and the Hyperline. */
export function settlementTrips(ctx: Ctx): SettlementTrip[] {
  const world = ctx.world;
  const centre = world.buildings[CENTRE];
  const out: SettlementTrip[] = [];
  const byCom = new Map<CommunityId, Array<{ x: number; y: number; node: string }>>();
  for (const id in world.buildings) {
    const b = world.buildings[id];
    if (b.kind !== 'house' || !b.community) continue;
    const arr = byCom.get(b.community) ?? [];
    arr.push({ x: b.entrance.x, y: b.entrance.y, node: b.roadNode });
    byCom.set(b.community, arr);
  }
  for (const [com, houses] of byCom) {
    if (!houses.length || !centre) continue;
    const cx = houses.reduce((s, h) => s + h.x, 0) / houses.length;
    const cy = houses.reduce((s, h) => s + h.y, 0) / houses.length;
    // The house nearest the settlement's middle stands in for the settlement.
    const rep = houses.reduce((a, h) => (Math.hypot(h.x - cx, h.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? h : a), houses[0]);
    const d = roadDistance(ctx.roads, rep.node, centre.roadNode);
    const dKm = r2(Math.max(0.8, Number.isFinite(d) ? d / 1000 : Math.hypot(rep.x - centre.entrance.x, rep.y - centre.entrance.y) / 800));
    // The bus: a line with a stop near the settlement runs to the terminus, a short walk from the centre.
    let busWalk: number | null = null;
    let busKm = dKm;
    const terminus = world.buildings.terminus;
    for (const line of BUS_LINES) {
      if (line.id === 'airport') continue;
      let best: { d: number; id: string } | null = null;
      for (const sid of line.stops) {
        const sb = world.buildings[sid];
        if (!sb) continue;
        const dd = Math.hypot(sb.entrance.x - rep.x, sb.entrance.y - rep.y);
        if (!best || dd < best.d) best = { d: dd, id: sid };
      }
      if (!best || best.d > 900 || !terminus) continue;
      const egress = Math.hypot(terminus.entrance.x - centre.entrance.x, terminus.entrance.y - centre.entrance.y);
      const walk = best.d * 1.3 + egress * 1.3;
      if (busWalk === null || walk < busWalk) {
        busWalk = Math.round(walk);
        const rd = roadDistance(ctx.roads, world.buildings[best.id].roadNode, terminus.roadNode);
        busKm = r2(Number.isFinite(rd) ? rd / 1000 : dKm);
      }
    }
    // The Hyperline: the nearest station to the settlement, and Unity Central to the centre.
    let hyperWalk: number | null = null;
    let hyperKm = dKm;
    const unity = STATIONS.find((s) => s.id === 'st-unity');
    const near = STATIONS.map((s) => ({ s, d: Math.hypot(s.x - rep.x, s.y - rep.y) })).sort((a, b) => a.d - b.d)[0];
    if (near && unity && near.s.id !== unity.id && near.d <= 1_300) {
      const egress = Math.hypot(unity.x - centre.entrance.x, unity.y - centre.entrance.y);
      hyperWalk = Math.round((near.d + egress) * 1.3);
      hyperKm = r2(Math.abs(near.s.t - unity.t) / 1000);
    }
    const spec = COMMUNITY[com];
    out.push({ community: com, name: spec?.name ?? com, dKm, busWalk, busKm, hyperWalk, hyperKm });
  }
  return out;
}

// ─── Mode choice ────────────────────────────────────────────────────────────

export interface ModeOffer {
  mode: ModeKey;
  fare: number;
  minutes: number;
}

/** The four ways to the centre from a settlement at this month's fares (a ride at the given surge). */
export function modeOffers(g: SettlementTrip, f: Fares, card: RideCard, surge: number, eta: number): ModeOffer[] {
  const offers: ModeOffer[] = [{ mode: 'taxi', fare: taxiFare(f, g.dKm), minutes: 8 + g.dKm * 2 + 3 }];
  if (g.busWalk !== null) offers.push({ mode: 'bus', fare: f.bus, minutes: g.busWalk / 80 + 12 + g.busKm / 0.3 });
  if (g.hyperWalk !== null) offers.push({ mode: 'hyper', fare: hyperFare(f, g.hyperKm), minutes: g.hyperWalk / 80 + 3 + 2 });
  offers.push({ mode: 'ride', fare: rideFare(card, g.dKm, surge), minutes: eta + g.dKm / RIDE_KM_PER_MIN });
  return offers;
}

/** Trip shares by multinomial logit on generalised minutes (minutes + fare ÷ value of time per minute). */
export function logitShares(offers: ModeOffer[], vot: number, wealth: number): Record<ModeKey, number> {
  const out: Record<ModeKey, number> = { taxi: 0, bus: 0, hyper: 0, ride: 0 };
  const asc = (m: ModeKey) => ASC[m] + (m === 'taxi' ? -1.2 * wealth : m === 'ride' ? 1.0 * wealth : 0);
  const u = offers.map((o) => asc(o.mode) - THETA * (o.minutes + o.fare / Math.max(0.05, vot)));
  const mx = Math.max(...u);
  const e = u.map((x) => Math.exp(x - mx));
  const s = e.reduce((a, b) => a + b, 0);
  offers.forEach((o, i) => (out[o.mode] = e[i] / s));
  return out;
}

/** Value of time on a trip (R per minute): half the earners' average wage, with a floor for households living on grants. */
export function valueOfTime(world: World, hh: Household, wageIndex: number): number {
  const members = householdMembers(world, hh.id);
  const earners = members.filter((m) => m.income > 0);
  if (!earners.length) return 0.06;
  const wage = earners.reduce((s, m) => s + m.income * wageIndex, 0) / earners.length;
  return Math.max(0.06, (0.5 * wage) / (173 * 60));
}

// ─── The month's plan ───────────────────────────────────────────────────────

/** How a household's transport spending splits this month (fractions of its transport budget). */
export interface HouseholdTransport {
  e: string;
  carless: boolean;
  /** Budget share for transport before the category shares are normalised (the relative-price-adjusted base share). */
  share: number;
  split: { out: number; taxi: number; bus: number; hyper: number; ride: number; fuel: number; carOther: number };
  /** Average fare per trip by mode (for trip counts). */
  fare: Record<ModeKey, number>;
  /** Day trips by air billed to the household (incl. VAT), carved out of other spending. */
  air: number;
  /** The transport budget (R). */
  t: number;
}

export interface TransportPlan {
  byHousehold: Record<string, HouseholdTransport>;
  ride: RideMonth;
  /** Paid kilometres of residents' e-hailing trips. */
  rideKmRes: number;
  rowTrips: { airport: number; regional: number };
  rowFares: { airport: number; regional: number };
  rowPax: number;
  fareIndex: number;
  events: string[];
  shares: Record<string, Record<ModeKey, number>>;
}

export interface BudgetLike {
  hh: Household;
  e: string;
  consumption: number;
  food: number;
  members: Person[];
  hasCar: boolean;
  medical: boolean;
  homeschool: boolean;
}

export interface PlanInputs {
  month: number;
  isoDate: string;
  calMonth: number;
  cpiF: number;
  gap: number;
  inflYoY: number;
  realIncomeGrowth: number;
  unemployment: number;
  nmwHourly: number;
  prime: number;
  wageIndex: number;
  /** The category shares other than transport (they fix how much of the budget transport gets). */
  otherShares: (b: BudgetLike) => number;
}

/**
 * Set this month's fares and rate card, choose modes household by household,
 * and clear the e-hailing market. Postings happen later (consumption, then the
 * operators) from the plan this returns.
 */
export function planTransport(ctx: Ctx, F: FinanceState, budgets: BudgetLike[], inp: PlanInputs): TransportPlan {
  const world = ctx.world;
  const T = F.transport;
  const S = F.markets;
  const events: string[] = [];
  if (!T.geometry) T.geometry = settlementTrips(ctx);
  if (T.unemploymentRef === null) T.unemploymentRef = inp.unemployment;
  else T.unemploymentRef = 0.97 * T.unemploymentRef + 0.03 * inp.unemployment;
  reviewFares(ctx, F, inp, events);
  // ── The platform's rate card ──
  const drivers = activeDrivers(world, T);
  const pricing = ridePricing(F, inp);
  T.phi = pricing.phi;
  T.fares.ride = cardFor(T.phi, inp.cpiF);
  const card = T.fares.ride;
  // ── Demand ──
  const geo = new Map(T.geometry.map((g) => [g.community, g]));
  const fallbackGeo: SettlementTrip = { community: 'ebenezer', name: 'Ebenezer', dKm: 3, busWalk: null, busKm: 3, hyperWalk: null, hyperKm: 3 };
  const baseFares = T.base;
  const baseCard = cardFor(1, 1);
  interface Hh {
    b: BudgetLike;
    g: SettlementTrip;
    vot: number;
    wealth: number;
    t: number; // transport budget (R)
    share: number;
    air: number;
  }
  const hhs: Hh[] = [];
  const airRes = billAirLeisure(F, world, inp.cpiF);
  for (const b of budgets) {
    const com = world.buildings[b.hh.houseId]?.community;
    const g = (com && geo.get(com)) || fallbackGeo;
    const vot = valueOfTime(world, b.hh, inp.wageIndex);
    const wealth = affluence(com);
    let share: number;
    if (b.hasCar) {
      // Relative price of petrol against everything else; short-run elasticity 0.25.
      const rp = S.petrol / S.base.petrol / inp.cpiF;
      share = 0.17 * (0.65 * Math.pow(rp, 1 - FUEL_ELASTICITY) + 0.35);
    } else {
      // Relative price of this household's fares (at base shares), elasticity 0.35.
      const now = modeOffers(g, T.fares, card, T.last.surge, T.last.eta);
      const then = modeOffers(g, baseFares, baseCard, 1, 7);
      const sh = logitShares(then, vot, wealth);
      const pNow = now.reduce((s, o) => s + sh[o.mode] * o.fare, 0);
      const pThen = then.reduce((s, o) => s + sh[o.mode] * o.fare, 0);
      const rp = pThen > 0 ? pNow / pThen / inp.cpiF : 1;
      share = 0.1 * Math.pow(rp, 1 - BUDGET_ELASTICITY);
    }
    // Tickets for a Saturday flown come out of the month's spending first (at most half of what is left after food).
    const air = r2(Math.min(airRes[b.hh.id] ?? 0, 0.5 * Math.max(0, b.consumption - b.food)));
    const t = transportBudget(b.consumption - air, b.food, share, inp.otherShares(b));
    hhs.push({ b, g, vot, wealth, t, share, air });
  }
  // ROW demand: passengers off the planes and trips into the wider region.
  const fareIdxAir = (T.fares.air + T.fares.airSurcharge) / (AIR_FARE_0 * inp.cpiF);
  const lf = clamp(AIR_LF_0 * Math.pow(fareIdxAir, -0.8) * (1 + 1.0 * inp.gap), 0.25, 0.92);
  const daysInMonth = 30.44;
  const seatsOut = FLIGHTS.length * PLANE_SEATS * daysInMonth;
  const residentsOut = Object.values(T.air.business).reduce((s, x) => s + x, 0) + Object.values(T.air.leisure).reduce((s, x) => s + x, 0);
  const rowPax = Math.max(0, Math.round(lf * seatsOut - residentsOut));
  const airportBase = 0.12 * 2 * rowPax;
  const regionalBase = 80 * (1 + 1.2 * inp.gap);
  const fareAirport1 = rideFareNet(card, AIRPORT_KM, 1);
  const fareRegional1 = rideFareNet(card, REGIONAL_KM, 1);
  const fareAirport0 = rideFareNet(baseCard, AIRPORT_KM, 1) * inp.cpiF;
  const fareRegional0 = rideFareNet(baseCard, REGIONAL_KM, 1) * inp.cpiF;
  const hoursPer = (km: number, back = 0) => (PICKUP_MIN + km / RIDE_KM_PER_MIN + back * (km / RIDE_KM_PER_MIN) + 2) / 60;
  // Driver-hours demanded at surge s (and what goes with it).
  const demandAt = (s: number) => {
    let hours = 0;
    let tripsRes = 0;
    let kmRes = 0;
    const perHh: Array<{ sh: Record<ModeKey, number>; trips: number; rideTrips: number; fares: Record<ModeKey, number> }> = [];
    for (const h of hhs) {
      const offers = modeOffers(h.g, T.fares, card, s, T.last.eta);
      const fares: Record<ModeKey, number> = { taxi: 0, bus: 0, hyper: 0, ride: 0 };
      for (const o of offers) fares[o.mode] = o.fare;
      if (h.b.hasCar) {
        const rideSpend = h.t * CAR_RIDE_SHARE;
        const rideTrips = rideSpend / fares.ride;
        hours += rideTrips * hoursPer(h.g.dKm);
        tripsRes += rideTrips;
        kmRes += rideTrips * h.g.dKm;
        perHh.push({ sh: { taxi: 0, bus: 0, hyper: 0, ride: 1 }, trips: rideTrips, rideTrips, fares });
      } else {
        const sh = logitShares(offers, h.vot, h.wealth);
        const pbar = offers.reduce((a, o) => a + sh[o.mode] * o.fare, 0);
        const trips = pbar > 0 ? (h.t * (1 - OUT_SHARE)) / pbar : 0;
        const rideTrips = trips * sh.ride;
        hours += rideTrips * hoursPer(h.g.dKm);
        tripsRes += rideTrips;
        kmRes += rideTrips * h.g.dKm;
        perHh.push({ sh, trips, rideTrips, fares });
      }
    }
    const airport = airportBase * Math.pow((fareAirport1 * s) / fareAirport0, -0.5);
    const regional = regionalBase * Math.pow((fareRegional1 * s) / fareRegional0, -0.8);
    hours += airport * hoursPer(AIRPORT_KM) + regional * hoursPer(REGIONAL_KM, 0.8);
    return { hours, tripsRes, kmRes, airport, regional, perHh };
  };
  // ── Supply: each driver-partner's online hours respond to last month's hourly earnings ──
  const resHourly = reservationHourly(inp.nmwHourly);
  const hoursEach = T.last.netHourly > 0 ? clamp(DRIVER_HOURS * Math.pow(T.last.netHourly / resHourly, 0.4), 100, 300) : DRIVER_HOURS;
  const withCar = drivers.filter((p) => T.fleet.cars.some((c) => c.driverId === p.id));
  const onlineHours = withCar.length * hoursEach;
  const capacity = onlineHours * U_MAX;
  // ── Clearing: the surge rises until the driver-hours demanded fit the fleet ──
  let s = 1;
  let d = demandAt(1);
  if (d.hours > capacity && capacity > 0) {
    let lo = 1;
    let hi = 3;
    const top = demandAt(hi);
    if (top.hours > capacity) {
      s = hi;
      d = top;
    } else {
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (demandAt(mid).hours > capacity) lo = mid;
        else hi = mid;
      }
      s = Math.round(hi * 100) / 100;
      d = demandAt(s);
    }
  }
  const served = capacity <= 0 ? 0 : Math.min(1, capacity / Math.max(1e-9, d.hours));
  const curve: Array<[number, number]> = [];
  for (let k = 0; k <= 12; k++) {
    const sk = 1 + (k * 2) / 12;
    curve.push([r2(sk), r2(demandAt(sk).hours)]);
  }
  const utilisation = onlineHours > 0 ? Math.min(U_MAX, (d.hours * served) / onlineHours) : 0;
  const eta = r2(4 + 14 * Math.pow(utilisation / U_MAX, 2));
  // ── Per-household splits (unserved e-hailing trips fall back to the taxi; a car household drives instead) ──
  const byHousehold: Record<string, HouseholdTransport> = {};
  const shares: Record<string, Record<ModeKey, number>> = {};
  const shareSums: Record<string, { w: number; s: Record<ModeKey, number> }> = {};
  T.hhRide = {};
  d.perHh.forEach((ph, i) => {
    const h = hhs[i];
    const fares = ph.fares;
    if (h.b.hasCar) {
      const rideFrac = CAR_RIDE_SHARE * served;
      const rp = S.petrol / S.base.petrol / inp.cpiF;
      const fuelW = 0.65 * Math.pow(rp, 1 - FUEL_ELASTICITY);
      const fuelFrac = (1 - CAR_RIDE_SHARE) * (fuelW / (fuelW + 0.35));
      byHousehold[h.b.e] = { e: h.b.e, carless: false, share: h.share, split: { out: 0, taxi: 0, bus: 0, hyper: 0, ride: rideFrac, fuel: fuelFrac + CAR_RIDE_SHARE * (1 - served), carOther: 1 - fuelFrac - CAR_RIDE_SHARE }, fare: fares, air: h.air, t: h.t };
      T.hhRide[h.b.hh.id] = 0.03;
    } else {
      // Spending by mode at the demanded shares; the rand meant for rides that found no car goes on taxis, so the
      // rides posted are exactly the rides served.
      const spendW = (m: ModeKey) => ph.sh[m] * fares[m];
      const tot = spendW('taxi') + spendW('bus') + spendW('hyper') + spendW('ride');
      const local = 1 - OUT_SHARE;
      const part = (w: number) => (tot > 0 ? (local * w) / tot : 0);
      byHousehold[h.b.e] = {
        e: h.b.e,
        carless: true,
        share: h.share,
        split: { out: OUT_SHARE, taxi: tot > 0 ? part(spendW('taxi') + spendW('ride') * (1 - served)) : local, bus: part(spendW('bus')), hyper: part(spendW('hyper')), ride: part(spendW('ride') * served), fuel: 0, carOther: 0 },
        fare: fares,
        air: h.air,
        t: h.t,
      };
      // Trip shares for the record and the animated day: unserved rides became taxi trips.
      const sh = { ...ph.sh };
      const lostTrips = sh.ride * (1 - served);
      sh.ride -= lostTrips;
      sh.taxi += lostTrips * (fares.ride / Math.max(1, fares.taxi));
      const norm = sh.taxi + sh.bus + sh.hyper + sh.ride;
      for (const m of ['taxi', 'bus', 'hyper', 'ride'] as ModeKey[]) sh[m] /= norm;
      T.hhRide[h.b.hh.id] = r2(sh.ride * 1000) / 1000;
      const acc = (shareSums[h.g.community] ??= { w: 0, s: { taxi: 0, bus: 0, hyper: 0, ride: 0 } });
      acc.w += ph.trips;
      for (const m of ['taxi', 'bus', 'hyper', 'ride'] as ModeKey[]) acc.s[m] += sh[m] * ph.trips;
    }
  });
  for (const com in shareSums) {
    const a = shareSums[com];
    shares[com] = { taxi: a.w ? a.s.taxi / a.w : 0, bus: a.w ? a.s.bus / a.w : 0, hyper: a.w ? a.s.hyper / a.w : 0, ride: a.w ? a.s.ride / a.w : 0 };
  }
  const tripsRes = d.tripsRes * served;
  const airportTrips = d.airport * served;
  const regionalTrips = d.regional * served;
  const ride: RideMonth = {
    drivers: withCar.length,
    waiting: drivers.length - withCar.length,
    onlineHours: r2(onlineHours),
    capacityHours: r2(capacity),
    demandHours: r2(d.hours),
    surge: s,
    served: r2(served * 1000) / 1000,
    tripsRes: r2(tripsRes),
    tripsRow: r2(airportTrips + regionalTrips),
    tripsAirport: r2(airportTrips),
    tripsRegional: r2(regionalTrips),
    avgFare: 0,
    gross: 0,
    commission: 0,
    booking: 0,
    driverFuel: 0,
    driverRent: 0,
    driverPhone: 0,
    driverNet: 0,
    netPerDriver: 0,
    netHourly: 0,
    reservationHourly: r2(resHourly),
    phi: T.phi,
    phiCost: pricing.phiCost,
    demandFactor: pricing.demand,
    eta,
    utilisation: r2(utilisation * 1000) / 1000,
    rentWeekly: T.rentWeekly,
    curve,
    pricing,
  };
  T.last.surge = s;
  T.last.eta = eta;
  T.last.utilisation = utilisation;
  const fareIndex = passengerFareIndex(T, inp.cpiF);
  return {
    byHousehold,
    ride,
    rideKmRes: d.kmRes * served,
    rowTrips: { airport: airportTrips, regional: regionalTrips },
    rowFares: { airport: rideFare(card, AIRPORT_KM, s), regional: rideFare(card, REGIONAL_KM, s) },
    rowPax,
    fareIndex,
    events,
    shares,
  };
}

/**
 * The rand amount of a household's transport budget: its (price-adjusted) share
 * normalised with the other categories to fill what is left after food, exactly
 * as the consumption postings split the month's spending.
 */
export function transportBudget(spend: number, food: number, share: number, others: number): number {
  if (spend <= 0) return 0;
  const fs = Math.min(0.95, food / spend);
  const k = (1 - fs) / (others + share);
  return Math.max(0, spend * share * k);
}

/** A Laspeyres index of passenger fares against the start (weights: the province's first-year trip mix). */
export function passengerFareIndex(T: TransportState, cpiF: number): number {
  void cpiF;
  const b = T.base;
  const f = T.fares;
  const d = 3;
  const w = { taxi: 0.55, bus: 0.12, hyper: 0.25, ride: 0.08 };
  const bRide = cardFor(1, 1);
  const now = w.taxi * taxiFare(f, d) + w.bus * f.bus + w.hyper * hyperFare(f, d) + w.ride * rideFare(f.ride, d, T.last.surge);
  const then = w.taxi * taxiFare(b, d) + w.bus * b.bus + w.hyper * hyperFare(b, d) + w.ride * rideFare(bRide, d, 1);
  return then > 0 ? now / then : 1;
}

/** Reservation wage per hour for driving: 15% above the minimum wage (the self-employed carry their own risk). */
export function reservationHourly(nmwHourly: number): number {
  return nmwHourly * 1.15;
}

/**
 * Hamba's pricing engine. A cost floor: the rate card at which a driver-partner
 * online DRIVER_HOURS a month at the target utilisation clears 1.3 × the
 * minimum wage per hour after the service fee, fuel, the weekly rent and the
 * phone. A demand shade: exp(0.5·gap + 0.35·real income growth − 0.25·Δunemployment),
 * bounded to ±15%. The target stays within 0.7–2.6 × CPI (a real band). The card
 * moves a third of the way to the target each month, by at most 6%.
 */
export function ridePricing(F: FinanceState, inp: PlanInputs): RidePricing {
  const T = F.transport;
  const S = F.markets;
  const mix = T.last.mix;
  const unit = cardFor(1, 1);
  const tripKm = (mix.local * 3 + mix.airport * AIRPORT_KM) * (1 + DEADHEAD) + mix.regional * REGIONAL_KM * 1.8;
  const tripHours = mix.local * ((PICKUP_MIN + 3 / RIDE_KM_PER_MIN + 2) / 60) + mix.airport * ((PICKUP_MIN + AIRPORT_KM / RIDE_KM_PER_MIN + 2) / 60) + mix.regional * ((PICKUP_MIN + 1.8 * (REGIONAL_KM / RIDE_KM_PER_MIN) + 2) / 60);
  const fareUnit = mix.local * rideFareNet(unit, 3, 1) + mix.airport * rideFareNet(unit, AIRPORT_KM, 1) + mix.regional * rideFareNet(unit, REGIONAL_KM, 1);
  const tripsPerHour = U_TARGET / Math.max(0.05, tripHours);
  const fuelPerHour = tripsPerHour * tripKm * RIDE_L_PER_KM * S.petrol;
  const fixedPerHour = ((T.rentWeekly * 52) / 12 + DRIVER_PHONE * inp.cpiF) / DRIVER_HOURS;
  const target = 1.3 * inp.nmwHourly;
  const phiCost = (target + fuelPerHour + fixedPerHour) / ((1 - COMMISSION) * tripsPerHour * fareUnit);
  const du = inp.unemployment - (T.unemploymentRef ?? inp.unemployment);
  const demand = clamp(Math.exp(0.5 * inp.gap + 0.35 * inp.realIncomeGrowth - 0.25 * du * 10), 0.85, 1.15);
  // Bounds are real: the card is nominal (RIDE_UNIT × phi), so a fixed cap would stop fares
  // following costs once prices have more than doubled and starve the drivers out.
  const want = clamp(phiCost * demand, 0.7 * inp.cpiF, 2.6 * inp.cpiF);
  const step = clamp((want - T.phi) / 3, -0.06 * T.phi, 0.06 * T.phi);
  const k = (x: number) => r2(x * 1000) / 1000;
  return { target: r2(target), fuelPerHour: r2(fuelPerHour), fixedPerHour: r2(fixedPerHour), tripsPerHour: k(tripsPerHour), fareUnit: r2(fareUnit), phiCost: k(phiCost), gap: k(inp.gap), incomeGrowth: k(inp.realIncomeGrowth), unemploymentDelta: k(du), demand: k(demand), want: k(want), phi: k(T.phi + step) };
}

/**
 * The fleet's weekly rent (incl. VAT). The rent must carry the instalment on
 * the 90% of the car financed by the Mutual Bank at its vehicle-finance rate
 * (prime + 1%, 48 months) — so the prime rate reaches the driver's costs, and
 * through them the fare — plus a return on the owners' 10%, insurance and
 * tracking, services and tyres, and a margin.
 */
export function fleetRentWeekly(S: MarketsState, prime: number, cpiF: number): number {
  const P = S.carPrice / 1.15;
  const instalment = pmt(FLEET_LTV * P, prime + 0.01, FLEET_LIFE);
  const equity = ((1 - FLEET_LTV) * P * FLEET_EQUITY_RETURN) / 12;
  const insure = (FLEET_INSURANCE * cpiF) / 1.15;
  const service = FLEET_SERVICE_PER_KM * cpiF * FLEET_KM_MONTH;
  const monthly = (instalment + equity + insure + service) * (1 + FLEET_MARGIN);
  return Math.round((((monthly * 12) / 52) * 1.15) / 50) * 50;
}

function activeDrivers(world: World, T: TransportState): Person[] {
  void T;
  return alivePeople(world).filter((p) => p.job === 'ehailer' && !p.away);
}

/** Fares reviews: the taxi associations, Unity Transit (July), the airport's charges (April) and the airline's fuel surcharge. */
function reviewFares(ctx: Ctx, F: FinanceState, inp: PlanInputs, events: string[]): void {
  const T = F.transport;
  const S = F.markets;
  const f = T.fares;
  // Taxi associations: costs are 42% diesel and 58% everything else (wages, parts, insurance, rank fees).
  const costIdx = 0.42 * (S.dieselRetail / S.base.dieselRetail) + 0.58 * inp.cpiF;
  const rise = costIdx / T.taxiCostRef - 1;
  const monthsSince = inp.month - T.taxiLastRise;
  if (inp.month > 0 && (rise >= 0.07 || (monthsSince >= 12 && rise >= 0.03))) {
    const before = taxiFare(f, 3);
    f.taxiBase = r2(f.taxiBase * (1 + rise * 0.9));
    f.taxiPerKm = r2(f.taxiPerKm * (1 + rise * 0.9));
    T.taxiCostRef = costIdx;
    T.taxiLastRise = inp.month;
    const after = taxiFare(f, 3);
    if (after > before) events.push(`The taxi associations raised fares: a 3 km trip now costs R${after.toFixed(2)} (was R${before.toFixed(2)}), with diesel at R${S.dieselRetail.toFixed(2)}/l.`);
  } else if (inp.month > 0 && rise <= -0.15) {
    // Fares fall slowly and seldom ("rockets and feathers").
    f.taxiBase = r2(f.taxiBase * (1 + rise * 0.4));
    f.taxiPerKm = r2(f.taxiPerKm * (1 + rise * 0.4));
    T.taxiCostRef = costIdx;
    T.taxiLastRise = inp.month;
    events.push(`Diesel has fallen far enough for the taxi associations to trim fares: R${taxiFare(f, 3).toFixed(2)} for 3 km.`);
  }
  // Unity Transit: the annual fare review in July (CPI + 1%, CPI only while unemployment is above its trend).
  if (inp.calMonth === 7 && inp.month > 0 && T.lastTransitReview !== Math.floor(inp.month / 12) + 1) {
    T.lastTransitReview = Math.floor(inp.month / 12) + 1;
    const up = inp.unemployment - (T.unemploymentRef ?? inp.unemployment) > 0.03;
    const g = Math.max(0, inp.inflYoY) + (up ? 0 : 0.01);
    f.bus = half(f.bus * (1 + g));
    f.hyperBoard = half(f.hyperBoard * (1 + g));
    f.hyperPerKm = r2(f.hyperPerKm * (1 + g));
    events.push(`Unity Transit's July fare review: ${(g * 100).toFixed(1)}%${up ? ' (CPI only, with unemployment up)' : ' (CPI + 1%)'}; the bus is R${f.bus.toFixed(2)} and the Hyperline R${f.hyperBoard.toFixed(2)} + R${f.hyperPerKm.toFixed(2)}/km.`);
  }
  // The airport's charges: indexed each April.
  if (inp.calMonth === 4 && inp.month > 0 && T.lastAirportReview !== Math.floor(inp.month / 12) + 1) {
    T.lastAirportReview = Math.floor(inp.month / 12) + 1;
    const g = Math.max(0, inp.inflYoY);
    f.psc = r2(f.psc * (1 + g));
    f.landing = r2(f.landing * (1 + g));
  }
  // The airline: base fare with inflation, and a fuel surcharge on Jet A1 above its level at the start.
  f.air = r2(AIR_FARE_0 * inp.cpiF);
  f.airSurcharge = r2(Math.max(0, S.jet - S.base.jet * inp.cpiF) * AIR_FUEL_L_PER_PAX);
  // Unity Fleet Rentals reprices each quarter (and at the start).
  if (T.lastRentReview < 0 || inp.month - T.lastRentReview >= 3) {
    const before = T.rentWeekly;
    T.rentWeekly = fleetRentWeekly(S, inp.prime, inp.cpiF);
    T.lastRentReview = inp.month;
    if (inp.month > 0 && T.rentWeekly !== before) events.push(`Unity Fleet Rentals ${T.rentWeekly > before ? 'raised' : 'lowered'} its weekly rent to R${T.rentWeekly.toLocaleString()} (prime ${(inp.prime * 100).toFixed(2)}%, a new car R${S.carPrice.toLocaleString()}).`);
  }
  void ctx;
}

// ─── Air travel ─────────────────────────────────────────────────────────────

/** A day trip by air (two sectors) booked in the daily plan: the employer pays for work, the household for a Saturday out. */
export function recordAirTrip(world: World, p: Person, business: boolean): void {
  const T = world.finance?.transport;
  if (!T) return;
  if (business && p.workplaceId) T.air.business[p.workplaceId] = (T.air.business[p.workplaceId] ?? 0) + 1;
  else T.air.leisure[p.householdId] = (T.air.leisure[p.householdId] ?? 0) + 1;
}

/** Price of one day trip by air (two sectors, fare + surcharge + PSC), ex VAT. */
export function dayTripExVat(f: Fares): number {
  return r2(2 * (f.air + f.airSurcharge + f.psc));
}

/** Households' leisure trips since the last billing (incl. VAT), keyed by household id. */
function billAirLeisure(F: FinanceState, world: World, cpiF: number): Record<string, number> {
  void cpiF;
  const out: Record<string, number> = {};
  const T = F.transport;
  const vat = F.tax.tables.vatRate;
  for (const hid in T.air.leisure) {
    if (!world.households[hid]) continue;
    out[hid] = r2(T.air.leisure[hid] * dayTripExVat(T.fares) * (1 + vat));
  }
  return out;
}

// ─── The operators' month ───────────────────────────────────────────────────

export interface OperatorHelpers {
  employerFor: (workplaceId: string) => string | null;
  workshopOf: (hh: Household) => string;
}

export interface OperatorTotals {
  vat: number;
  fuelLevies: number;
  investment: number;
}

/**
 * After household spending has been posted: the platform pays its drivers, the
 * drivers pay for fuel and the rent, the fleet runs its cars, Unity Transit
 * runs the network and receives the operations grant, the airport company bills
 * the airline, and firms pay for their business travel.
 */
export function transportOperators(ctx: Ctx, F: FinanceState, month: number, plan: TransportPlan, spent: { byMode: Record<string, number>; rideGross: number; rideBooking: number; rideCommission: number; petrolLitres: number; transitRes: { bus: number; hyper: number; busTrips: number; hyperTrips: number } }, inp: PlanInputs, help: OperatorHelpers, totals: OperatorTotals): TransportMonth {
  const world = ctx.world;
  const T = F.transport;
  const S = F.markets;
  const TT = F.tax.tables;
  const day = world.day;
  const ym = inp.isoDate.slice(0, 7);
  const cpiF = inp.cpiF;
  const vatRate = TT.vatRate;
  const vatIn = (excl: number) => (excl > 0 ? [{ account: '2230', debit: r2(excl * vatRate) }] : []);
  const events: string[] = [...plan.events];
  let dieselLitres = 0;
  let petrolLitres = spent.petrolLitres;
  // ── Hamba: visitors' and regional fares collected, service fee kept, drivers paid ──
  const ride = plan.ride;
  const card = T.fares.ride;
  const rowGross = r2(plan.rowTrips.airport * (plan.rowFares.airport - card.booking) + plan.rowTrips.regional * (plan.rowFares.regional - card.booking));
  const rowBooking = r2((plan.rowTrips.airport + plan.rowTrips.regional) * card.booking);
  if (rowGross + rowBooking > 0) {
    const comm = r2(rowGross * COMMISSION);
    const fee = r2(comm + rowBooking);
    const vat = r2((fee * vatRate) / (1 + vatRate));
    pay(F, { from: ROW, to: 'hamba', amount: r2(rowGross + rowBooking), day, month, ref: `RIDE-${ym}`, memo: 'E-hailing fares from visitors and regional trips (drivers\' share held for payout)', flow: 'exports', fromAccount: '5370', toAccount: '2010', toExtra: [{ account: '2010', debit: fee }, { account: '4100', credit: r2(fee - vat) }, { account: '2230', credit: vat }] });
    totals.vat += vat;
  }
  const gross = r2(spent.rideGross + rowGross);
  const booking = r2(spent.rideBooking + rowBooking);
  const commission = r2(gross * COMMISSION);
  ride.gross = gross;
  ride.booking = r2(booking / (1 + vatRate));
  ride.commission = r2(commission / (1 + vatRate));
  const trips = ride.tripsRes + ride.tripsRow;
  ride.avgFare = trips > 0 ? r2((gross + booking) / trips) : 0;
  // Drivers' payouts, pro rata to online hours (equal hours: equal shares).
  const drivers = alivePeople(world).filter((p) => p.job === 'ehailer' && !p.away && T.fleet.cars.some((c) => c.driverId === p.id));
  const payout = r2(gross - commission);
  // Kilometres driven: local and airport trips with the usual empty running; regional trips come back empty (the 1.8).
  const kmDriven = (plan.rideKmRes + plan.rowTrips.airport * AIRPORT_KM) * (1 + DEADHEAD) + plan.rowTrips.regional * REGIONAL_KM * 1.8;
  const litres = kmDriven * RIDE_L_PER_KM;
  const rentMonth = r2((T.rentWeekly * 52) / 12);
  const phone = r2(DRIVER_PHONE * cpiF);
  let fuelTot = 0;
  let rentTot = 0;
  let phoneTot = 0;
  let netTot = 0;
  for (const p of drivers) {
    const hh = world.households[p.householdId];
    if (!hh || hh.dissolvedDay) continue;
    const e = hhEntity(hh.id);
    if (!F.ledgers.books[e]) continue;
    const share = r2(payout / drivers.length);
    if (share > 0) pay(F, { from: 'hamba', to: e, amount: share, day, month, ref: `PAYOUT-${ym}`, memo: `Hamba payout to ${p.firstName} ${p.surname}: fares less the 25% service fee`, flow: 'sales', fromAccount: '2010', toAccount: '4050' });
    const l = litres / drivers.length;
    const fuel = r2(l * S.petrol);
    const levy = r2(l * levyPerLitre(S, 'petrol'));
    petrolLitres += l;
    const rentVat = r2((rentMonth * vatRate) / (1 + vatRate));
    const items: BatchItem[] = [
      { to: GOV, amount: levy, fromAccount: '5200', toAccount: '4136', flow: 'tax' },
      { to: ROW, amount: r2(fuel - levy), fromAccount: '5200', toAccount: '4040', flow: 'imports' },
      { to: 'fleet', amount: rentMonth, fromAccount: '5245', toAccount: '4050', toExtra: [{ account: '4050', debit: rentVat }, { account: '2230', credit: rentVat }], flow: 'purchases' },
      { to: ROW, amount: phone, fromAccount: '5320', toAccount: '4040', flow: 'imports' },
    ];
    payBatch(F, e, day, month, `DRIVE-${ym}`, 'Driving for Hamba: fuel, the weekly rent of the car and the phone', items, 'purchases');
    totals.fuelLevies += levy;
    // A driver-partner is not a VAT vendor: the VAT on the rent is a tax on products they bear.
    totals.vat += rentVat;
    const net = r2(share - fuel - rentMonth - phone);
    fuelTot += fuel;
    rentTot += rentMonth;
    phoneTot += phone;
    netTot += net;
    // What the driver-partner expects to take home next month (own-account income for the household budget).
    p.income = Math.max(0, Math.round(net));
  }
  // Drivers still waiting for a car.
  for (const p of alivePeople(world)) if (p.job === 'ehailer' && !drivers.includes(p)) p.income = 0;
  ride.driverFuel = r2(fuelTot);
  ride.driverRent = r2(rentTot);
  ride.driverPhone = r2(phoneTot);
  ride.driverNet = r2(netTot);
  ride.netPerDriver = drivers.length ? r2(netTot / drivers.length) : 0;
  ride.netHourly = drivers.length && ride.onlineHours > 0 ? r2(netTot / ride.onlineHours) : 0;
  T.last.netHourly = drivers.length ? ride.netHourly : T.last.netHourly;
  const tripsAll = Math.max(1e-9, ride.tripsRes + plan.rowTrips.airport + plan.rowTrips.regional);
  if (tripsAll > 1) T.last.mix = { local: ride.tripsRes / tripsAll, airport: plan.rowTrips.airport / tripsAll, regional: plan.rowTrips.regional / tripsAll };
  T.last.tripsRes = ride.tripsRes;
  // The platform's own costs: card processing (2.5% of what it collects), servers and marketing.
  {
    const processing = r2(0.025 * (gross + booking));
    const servers = r2(9_000 * cpiF);
    payBatch(F, 'hamba', day, month, `PUR-${ym}`, 'Card processing, cloud hosting and marketing', [
      { to: ROW, amount: processing, fromAccount: '5320', toAccount: '4040', fromExtra: vatIn(processing), flow: 'imports' },
      { to: ROW, amount: servers, fromAccount: '5320', toAccount: '4040', fromExtra: vatIn(servers), flow: 'imports' },
    ], 'purchases');
    depreciateFixed(F, 'hamba', day, month, 60_000 / 36);
  }
  // ── Unity Fleet Rentals: the cars' running costs and depreciation (rent came in from the drivers) ──
  fleetMonth(ctx, F, month, day, ym, cpiF, help, totals, events);
  // ── Unity Transit: visitors' fares, the network's running costs, the operations grant ──
  const transit = transitMonth(ctx, F, month, day, ym, plan, spent.transitRes, inp, totals, events);
  dieselLitres += transit.busLitres;
  // ── Air travel: business trips billed to employers, the airport company's charges and costs ──
  const air = airMonth(ctx, F, month, day, ym, plan, inp, help, totals);
  // ── Fuel levy relief: what the province's litres would have paid in levy ──
  const reliefCost = r2(petrolLitres * (S.relief?.petrol ?? 0) + dieselLitres * (S.relief?.diesel ?? 0) + spent.byMode.taxiDieselLitres * (S.relief?.diesel ?? 0));
  if (reliefCost > 0 && S.reliefEpisodes.length) S.reliefEpisodes[S.reliefEpisodes.length - 1].cost = r2(S.reliefEpisodes[S.reliefEpisodes.length - 1].cost + reliefCost);
  const row: TransportMonth = {
    month,
    isoDate: inp.isoDate,
    fareIndex: r2(plan.fareIndex * 10_000) / 10_000,
    fuelIndex: r2((S.petrol / S.base.petrol) * 10_000) / 10_000,
    spend: { taxi: r2(spent.byMode.taxi ?? 0), bus: r2(spent.byMode.bus ?? 0), hyper: r2(spent.byMode.hyper ?? 0), ride: r2(spent.byMode.ride ?? 0), fuel: r2(spent.byMode.fuel ?? 0), carOther: r2(spent.byMode.carOther ?? 0), out: r2(spent.byMode.out ?? 0), air: r2(spent.byMode.air ?? 0) },
    trips: { taxi: r2(spent.byMode.taxiTrips ?? 0), bus: r2(spent.transitRes.busTrips), hyper: r2(spent.transitRes.hyperTrips), ride: r2(ride.tripsRes) },
    fares: JSON.parse(JSON.stringify(T.fares)) as Fares,
    taxiFare: taxiFare(T.fares, 3),
    hyperFare: hyperFare(T.fares, 3),
    rideFare: rideFare(T.fares.ride, 3, ride.surge),
    ride,
    transit,
    air,
    shares: plan.shares,
    petrolLitres: r2(petrolLitres),
    dieselLitres: r2(dieselLitres + (spent.byMode.taxiDieselLitres ?? 0)),
    levyRevenue: 0,
    reliefCost,
    events,
  };
  T.months.push(row);
  if (T.months.length > 600) T.months.shift();
  T.air = { business: {}, leisure: {} };
  return row;
}

function depreciateFixed(F: FinanceState, entity: string, day: number, month: number, monthly: number): void {
  const book = F.ledgers.books[entity];
  if (!book) return;
  const nbv = natural(book, '1500') + natural(book, '1510') - natural(book, '1590');
  const d = r2(Math.min(monthly, Math.max(0, nbv)));
  if (d > 0) postInternal(F, entity, day, month, `DEP-${month}`, 'Depreciation, straight line', [{ account: '5250', debit: d }, { account: '1590', credit: d }], 'other');
}

// ── The fleet ──

/** Straight-line monthly depreciation of a fleet car to its residual over its life. */
function carDep(c: FleetCar): number {
  return (c.cost * (1 - FLEET_RESIDUAL)) / FLEET_LIFE;
}

function carNbv(c: FleetCar, month: number): number {
  const age = Math.max(0, Math.min(FLEET_LIFE, month - c.month));
  return c.cost - carDep(c) * age;
}

/**
 * Put a car on the road for every driver-partner: an idle car first, else a new
 * one bought on vehicle finance (a declined loan leaves the driver waiting).
 * Cars idle for two months are sold. Also keeps the cars on the map in step.
 */
export function fleetSync(ctx: Ctx, F: FinanceState, month: number, opening = false): string[] {
  const world = ctx.world;
  const T = F.transport;
  const S = F.markets;
  const events: string[] = [];
  const day = world.day;
  const TT = F.tax.tables;
  const drivers = alivePeople(world).filter((p) => p.job === 'ehailer' && !p.away);
  const ids = new Set(drivers.map((p) => p.id));
  // Cars of drivers who have stopped go idle; their car leaves the map (anyone aboard steps out where it stands).
  for (const c of T.fleet.cars) {
    if (c.driverId && !ids.has(c.driverId)) {
      c.driverId = null;
      const v = c.vehicleId ? world.vehicles[c.vehicleId] : null;
      if (v) {
        for (const pid of v.occupantIds) {
          const q = world.people[pid];
          if (q && q.inVehicleId === v.id) {
            q.inVehicleId = null;
            q.path = [];
          }
        }
        delete world.vehicles[v.id];
      }
      c.vehicleId = null;
    }
    // A driver who moved house parks at the new gate.
    const v = c.vehicleId ? world.vehicles[c.vehicleId] : null;
    const p = c.driverId ? world.people[c.driverId] : null;
    const house = p ? world.buildings[world.households[p.householdId]?.houseId ?? ''] : null;
    if (v && house && v.baseId !== house.id) {
      const spot = freeYardSlot(world, house, v.id);
      v.baseId = house.id;
      v.homeX = spot.x;
      v.homeY = spot.y;
      if (!v.online && !v.moving) {
        v.x = v.homeX;
        v.y = v.homeY;
      }
    }
  }
  for (const p of drivers) {
    if (T.fleet.cars.some((c) => c.driverId === p.id)) continue;
    let car = T.fleet.cars.find((c) => !c.driverId) ?? null;
    if (!car) {
      const price = S.carPrice;
      const excl = r2(price / (1 + TT.vatRate));
      const vat = r2(price - excl);
      if (opening) {
        // The cars the fleet already runs are brought into its books at cost.
        postInternal(F, 'fleet', day, month, 'OPEN', 'Rental car brought into the books at cost', [{ account: '1510', debit: excl }, { account: '3010', credit: excl }], 'capital');
      } else {
        if (month - T.fleet.declinedMonth < 3) continue;
        // The fleet's own cash first (keeping R30,000 working capital), vehicle finance for the rest.
        const cash = deposits(F, 'fleet');
        const need = r2(Math.max(0, excl + vat - Math.max(0, cash - 30_000)));
        if (need > 0) {
          // Asset finance is underwritten on the rental cash flow: the fleet's rent less running costs, the new car
          // included, must cover the instalments (the credit policy's 30% and 40% caps applied to 2.5 × that EBITDA).
          const perCar = (T.rentWeekly * 52) / 12 / 1.15 - (FLEET_INSURANCE * F.macro.cpi) / 100 / 1.15 - (FLEET_SERVICE_PER_KM * F.macro.cpi * FLEET_KM_MONTH) / 100;
          const ebitda = Math.max(0, perCar * (T.fleet.cars.length + 1));
          const d = requestLoan(F, 'fleet', Math.max(10_000, need), 'vehicle finance', 2.5 * ebitda, day, month, TT.vatRate);
          if (!d.approved) {
            T.fleet.declinedMonth = month;
            events.push(`${F.bank.name} declined Unity Fleet Rentals' application for vehicle finance (${d.reason}); ${p.firstName} ${p.surname} waits for a car.`);
            continue;
          }
        }
        pay(F, { from: 'fleet', to: ROW, amount: excl, day, month, ref: `CAR-${month}-${T.fleet.nextId}`, memo: 'A small car for the rental fleet (input VAT claimed: a car-rental business)', flow: 'imports', fromAccount: '1510', toAccount: '4040', fromExtra: [{ account: '2230', debit: vat }] });
        // Gross fixed capital formation (the national accounts pick it up with the month's investment).
        T.fleet.capex = r2(T.fleet.capex + excl);
      }
      car = { id: `F${T.fleet.nextId++}`, cost: excl, month, driverId: null, vehicleId: null, idleMonths: 0 };
      T.fleet.cars.push(car);
      if (!opening) events.push(`Unity Fleet Rentals bought a car for R${price.toLocaleString()} for ${p.firstName} ${p.surname}, a new Hamba driver-partner.`);
    }
    car.driverId = p.id;
    car.idleMonths = 0;
    delete T.waiting[p.id];
    // The car on the map, parked at the driver's gate.
    const hh = world.households[p.householdId];
    const house = hh ? world.buildings[hh.houseId] : null;
    if (house) {
      const spot = freeYardSlot(world, house);
      const v = createVehicle(ctx, null, 'ride', spot.x, spot.y, house.id);
      v.rideDriverId = p.id;
      v.online = false;
      car.vehicleId = v.id;
    }
    p.driver = true;
  }
  for (const p of drivers) if (!T.fleet.cars.some((c) => c.driverId === p.id)) T.waiting[p.id] ??= month;
  for (const id in T.waiting) if (!ids.has(id)) delete T.waiting[id];
  return events;
}

function fleetMonth(ctx: Ctx, F: FinanceState, month: number, day: number, ym: string, cpiF: number, help: OperatorHelpers, totals: OperatorTotals, events: string[]): void {
  const world = ctx.world;
  const T = F.transport;
  const book = F.ledgers.books.fleet;
  if (!book) return;
  const active = T.fleet.cars.filter((c) => c.driverId);
  const insurance = r2(((FLEET_INSURANCE * cpiF) / 1.15) * T.fleet.cars.length);
  const service = r2(FLEET_SERVICE_PER_KM * cpiF * FLEET_KM_MONTH * active.length);
  const items: BatchItem[] = [];
  if (insurance > 0) items.push({ to: ROW, amount: insurance, fromAccount: '5320', toAccount: '4040', fromExtra: [{ account: '2230', debit: r2(insurance * F.tax.tables.vatRate) }], flow: 'imports' });
  // Services at the drivers' own city's workshop (not a VAT vendor), parts and tyres from town.
  for (const c of active) {
    const p = c.driverId ? world.people[c.driverId] : null;
    const hh = p ? world.households[p.householdId] : null;
    const each = r2(service / Math.max(1, active.length));
    if (hh) items.push({ to: help.workshopOf(hh), amount: r2(each * 0.5), fromAccount: '5260', toAccount: '4050', flow: 'purchases' });
    items.push({ to: ROW, amount: r2(each * 0.5), fromAccount: '5260', toAccount: '4040', fromExtra: [{ account: '2230', debit: r2(each * 0.5 * F.tax.tables.vatRate) }], flow: 'imports' });
  }
  payBatch(F, 'fleet', day, month, `RUN-${ym}`, 'Insurance, tracking and licences; services and tyres', items, 'purchases');
  // Depreciation of every car to its residual.
  const dep = r2(T.fleet.cars.reduce((s, c) => s + (month - c.month < FLEET_LIFE ? carDep(c) : 0), 0));
  if (dep > 0) postInternal(F, 'fleet', day, month, `DEP-${month}`, 'Depreciation of the rental cars, straight line to residual', [{ account: '5250', debit: dep }, { account: '1590', credit: dep }], 'other');
  // Idle cars: sold after two idle months at 85% of book value.
  for (const c of [...T.fleet.cars]) {
    if (c.driverId) continue;
    c.idleMonths++;
    if (c.idleMonths < 2) continue;
    const nbv = r2(carNbv(c, month));
    const acc = r2(c.cost - nbv);
    const proceeds = r2(nbv * 0.85);
    // Selling a car the input VAT was claimed on is a taxable supply: output VAT on the price. One entry derecognises
    // the car (cost and accumulated depreciation) and books the loss on disposal.
    const vat = r2(proceeds * F.tax.tables.vatRate);
    const lines = [
      { account: '1590', debit: acc },
      { account: '5370', debit: r2(nbv - proceeds) },
      { account: '1510', credit: r2(c.cost - proceeds - vat) },
      { account: '2230', credit: vat },
    ];
    pay(F, { from: ROW, to: 'fleet', amount: r2(proceeds + vat), day, month, ref: `SALE-${c.id}`, memo: `Idle rental car ${c.id} sold to a dealer at 85% of book value (loss on disposal R${Math.round(nbv - proceeds).toLocaleString()})`, flow: 'capital', fromAccount: '5370', toAccount: '1510', toExtra: lines });
    // The proceeds settle vehicle finance, oldest loan first (the bank holds the car as security).
    let left = proceeds;
    for (const loan of Object.values(F.bank.loans).filter((l) => l.status === 'active' && l.borrower === 'fleet').sort((a, b) => a.startMonth - b.startMonth)) {
      if (left <= 1) break;
      left -= prepayLoan(F, loan, left, day, month, `Sale of rental car ${c.id}`);
    }
    T.fleet.cars.splice(T.fleet.cars.indexOf(c), 1);
    events.push(`Unity Fleet Rentals sold an idle car for R${Math.round(proceeds + vat).toLocaleString()} and settled its finance with the proceeds.`);
  }
  void totals;
}

// ── Unity Transit ──

/** Kilometres the timetable runs a month: the bus lines shuttling end to end, and the two trains on the guideway. */
export function timetableKm(ctx: Ctx, days: number): { busKm: number; trainKm: number } {
  const world = ctx.world;
  let busKm = 0;
  for (const line of BUS_LINES) {
    let km = 0;
    for (let i = 1; i < line.stops.length; i++) {
      const a = world.buildings[line.stops[i - 1]];
      const b = world.buildings[line.stops[i]];
      if (!a || !b) continue;
      const d = roadDistance(ctx.roads, a.roadNode, b.roadNode);
      km += Number.isFinite(d) ? d / 1000 : Math.hypot(a.x - b.x, a.y - b.y) / 1000;
    }
    const roundMin = (2 * km * 1000) / BUS_SPEED + 2 * (line.stops.length - 1) * BUS_DWELL + 2 * BUS_LAYOVER;
    const serviceMin = BUS_HOURS[1] - BUS_HOURS[0];
    busKm += BUSES_PER_LINE * (serviceMin / roundMin) * 2 * km * days;
  }
  const ts = STATIONS.map((s) => s.t);
  const lineKm = (Math.max(...ts) - Math.min(...ts)) / 1000;
  const oneWayMin = (STATIONS.length - 1) * (TRAIN_DWELL + 0.2) + TRAIN_LAYOVER;
  const trainKm = TRAINS * ((TRAIN_HOURS[1] - TRAIN_HOURS[0]) / oneWayMin) * lineKm * days;
  return { busKm: r2(busKm), trainKm: r2(trainKm) };
}

function transitMonth(ctx: Ctx, F: FinanceState, month: number, day: number, ym: string, plan: TransportPlan, res: { bus: number; hyper: number; busTrips: number; hyperTrips: number }, inp: PlanInputs, totals: OperatorTotals, events: string[]): TransitMonth {
  const T = F.transport;
  const S = F.markets;
  const cpiF = inp.cpiF;
  const f = T.fares;
  const vatRate = F.tax.tables.vatRate;
  const { busKm, trainKm } = timetableKm(ctx, 30.44);
  // Riders from beyond the modelled households: commuters, visitors and the airport's passengers.
  const busIdx = f.bus / (T.base.bus * cpiF);
  const hyperIdx = hyperFare(f, 3.5) / (hyperFare(T.base, 3.5) * cpiF);
  const busRow = Math.max(0, BUS_ROW_BASE * Math.pow(busIdx, -0.35) * (1 + 0.8 * inp.gap));
  const hyperRow = Math.max(0, (HYPER_ROW_BASE + 0.45 * 2 * plan.rowPax) * Math.pow(hyperIdx, -0.4) * (1 + 0.8 * inp.gap));
  const rowFares = r2(busRow * f.bus + hyperRow * hyperFare(f, 3.5));
  if (rowFares > 0) pay(F, { from: ROW, to: 'transit', amount: rowFares, day, month, ref: `FARE-${ym}`, memo: 'Fares from riders beyond the province\'s households (VAT-exempt passenger transport)', flow: 'exports', fromAccount: '5370', toAccount: '4050' });
  // The network's running costs. Not a VAT vendor, so the VAT on its purchases is a cost.
  const busLitres = busKm * BUS_L_PER_KM;
  const diesel = r2(busLitres * S.diesel);
  const levy = r2(busLitres * levyPerLitre(S, 'diesel'));
  const kwh = trainKm * TRAIN_KWH_PER_KM;
  const power = r2(kwh * S.electricity * (1 + vatRate));
  const busMaint = r2(busKm * BUS_MAINT_PER_KM * cpiF * (1 + vatRate));
  const trainMaint = r2(trainKm * TRAIN_MAINT_PER_KM * cpiF * (1 + vatRate));
  const admin = r2(TRANSIT_ADMIN * cpiF * (1 + vatRate));
  const insurance = r2(TRANSIT_INSURANCE * cpiF);
  const excl = (x: number) => r2(x / (1 + vatRate));
  const vatOf = (x: number) => r2(x - x / (1 + vatRate));
  payBatch(F, 'transit', day, month, `RUN-${ym}`, 'Diesel for the buses, traction power for the Hyperline, maintenance, ticketing and insurance', [
    { to: GOV, amount: levy, fromAccount: '5200', toAccount: '4136', flow: 'tax' },
    { to: ROW, amount: r2(diesel - levy), fromAccount: '5200', toAccount: '4040', flow: 'imports' },
    { to: ROW, amount: excl(power), fromAccount: '5270', toAccount: '4040', flow: 'imports' },
    { to: GOV, amount: vatOf(power), fromAccount: '5270', toAccount: '4132', flow: 'tax' },
    { to: ROW, amount: excl(busMaint + trainMaint), fromAccount: '5260', toAccount: '4040', flow: 'imports' },
    { to: GOV, amount: vatOf(busMaint + trainMaint), fromAccount: '5260', toAccount: '4132', flow: 'tax' },
    { to: ROW, amount: excl(admin), fromAccount: '5320', toAccount: '4040', flow: 'imports' },
    { to: GOV, amount: vatOf(admin), fromAccount: '5320', toAccount: '4132', flow: 'tax' },
    { to: ROW, amount: insurance, fromAccount: '5320', toAccount: '4040', flow: 'imports' },
  ], 'purchases');
  totals.fuelLevies += levy;
  totals.vat += vatOf(power) + vatOf(busMaint + trainMaint) + vatOf(admin);
  const book = F.ledgers.books.transit;
  const mv = (code: string) => movement(book, code, month, month);
  const compensation = r2(mv('5210') + mv('5220') + mv('5230'));
  const costs = r2(compensation + mv('5200') + mv('5270') + mv('5260') + mv('5320'));
  const fares = r2(mv('4050'));
  T.recoveryHistory.push({ fares, costs });
  if (T.recoveryHistory.length > 12) T.recoveryHistory.shift();
  const f12 = T.recoveryHistory.reduce((s, x) => s + x.fares, 0);
  const c12 = T.recoveryHistory.reduce((s, x) => s + x.costs, 0);
  const recovery12 = c12 > 0 ? f12 / c12 : 0;
  // The operations grant: tops the operator's cash up to 1.25 months of running costs.
  const cash = deposits(F, 'transit');
  const subsidy = r2(Math.max(0, 1.25 * costs - cash));
  if (subsidy > 0) pay(F, { from: GOV, to: 'transit', amount: subsidy, day, month, ref: `PTOG-${ym}`, memo: 'Public transport operations grant to Unity Transit', flow: 'grants', fromAccount: '5335', toAccount: '4160' });
  const wasMarket = T.months.length ? T.months[T.months.length - 1].transit.market : false;
  const market = recovery12 >= 0.5;
  if (T.months.length && market !== wasMarket) events.push(`Unity Transit's fares ${market ? 'now cover' : 'no longer cover'} half its running costs over the year (${(recovery12 * 100).toFixed(0)}%): the national accounts ${market ? 'treat it as a market producer' : 'count it as a non-market public producer'}.`);
  return {
    busKm,
    trainKm,
    busLitres: r2(busLitres),
    trainKwh: r2(kwh),
    boardingsBusRes: r2(res.busTrips),
    boardingsHyperRes: r2(res.hyperTrips),
    boardingsBusRow: r2(busRow),
    boardingsHyperRow: r2(hyperRow),
    fareboxRes: r2(res.bus + res.hyper),
    fareboxRow: rowFares,
    costs,
    compensation,
    subsidy,
    recovery: costs > 0 ? r2((fares / costs) * 1000) / 1000 : 0,
    recovery12: r2(recovery12 * 1000) / 1000,
    market,
  };
}

// ── Air travel and the airport company ──

function airMonth(ctx: Ctx, F: FinanceState, month: number, day: number, ym: string, plan: TransportPlan, inp: PlanInputs, help: OperatorHelpers, totals: OperatorTotals): AirMonth {
  const world = ctx.world;
  const T = F.transport;
  const S = F.markets;
  const f = T.fares;
  const cpiF = inp.cpiF;
  const vatRate = F.tax.tables.vatRate;
  const trip = dayTripExVat(f);
  // Business travel: the employer pays the carrier (a VAT vendor claims the input tax; the state's own VAT nets out).
  let businessTrips = 0;
  for (const wp in T.air.business) {
    const n = T.air.business[wp];
    const payer = help.employerFor(wp);
    if (!payer || !F.ledgers.books[payer] || n <= 0) continue;
    businessTrips += n;
    const excl = r2(n * trip);
    const info = F.entities[payer];
    if (payer === GOV) pay(F, { from: GOV, to: ROW, amount: excl, day, month, ref: `AIR-${ym}`, memo: `Official travel by air: ${n} day trip${n > 1 ? 's' : ''}`, flow: 'imports', fromAccount: '5340', toAccount: '4040' });
    else if (info?.vatRegistered) pay(F, { from: payer, to: ROW, amount: excl, day, month, ref: `AIR-${ym}`, memo: `Business travel by air: ${n} day trip${n > 1 ? 's' : ''}`, flow: 'imports', fromAccount: '5320', toAccount: '4040', fromExtra: [{ account: '2230', debit: r2(excl * vatRate) }] });
    else {
      const vat = r2(excl * vatRate);
      payBatch(F, payer, day, month, `AIR-${ym}`, `Business travel by air: ${n} day trip${n > 1 ? 's' : ''}`, [
        { to: ROW, amount: excl, fromAccount: '5320', toAccount: '4040', flow: 'imports' },
        { to: GOV, amount: vat, fromAccount: '5320', toAccount: '4132', flow: 'tax' },
      ], 'purchases');
      totals.vat += vat;
    }
    // A firm's trips are for its clients beyond the province, who reimburse them at cost (disbursements, standard-rated
    // by a vendor), so the travel does not eat the margin; the state's and the Mutual Bank's trips are their own.
    if (payer !== GOV && payer !== BANK) {
      const kind = BUSINESS[payer]?.kind;
      const revenue = kind === 'office' || kind === 'mall' || kind === 'shop' || kind === 'market' || kind === 'farm' ? '4040' : '4050';
      const vat = info?.vatRegistered ? r2(excl * vatRate) : 0;
      pay(F, { from: ROW, to: payer, amount: r2(excl + vat), day, month, ref: `AIR-${ym}`, memo: `Travel recharged to clients at cost: ${n} day trip${n > 1 ? 's' : ''}`, flow: 'exports', fromAccount: '5370', toAccount: revenue, toExtra: vat > 0 ? [{ account: '2230', credit: vat }] : undefined });
      totals.vat += vat;
    }
  }
  const residentTrips = Object.values(T.air.leisure).reduce((s, x) => s + x, 0) + businessTrips;
  // The airport company: landing fees, the passenger service charge on every departing passenger, and the kiosk.
  const landings = r2(FLIGHTS.length * 30.44);
  const departing = plan.rowPax + residentTrips;
  const landing = r2(landings * f.landing);
  const psc = r2(departing * f.psc);
  const concession = r2(plan.rowPax * AIRPORT_CONCESSION_PER_PAX * cpiF);
  const revenue = r2(landing + psc + concession);
  if (revenue > 0) {
    pay(F, { from: ROW, to: 'airportco', amount: r2(revenue * (1 + vatRate)), day, month, ref: `AERO-${ym}`, memo: 'Landing fees and passenger service charges from the airline; the kiosk concession', flow: 'exports', fromAccount: '5370', toAccount: '4050', toExtra: [{ account: '4050', debit: r2(revenue * vatRate) }, { account: '2230', credit: r2(revenue * vatRate) }] });
    // Exports valued at what the airline pays include the VAT: a tax on products in the production account.
    totals.vat += r2(revenue * vatRate);
  }
  const power = r2(AIRPORT_KWH * S.electricity);
  const security = r2(AIRPORT_SECURITY * cpiF);
  const maint = r2(AIRPORT_MAINT * cpiF);
  const admin = r2(AIRPORT_ADMIN * cpiF);
  const insurance = r2(AIRPORT_INSURANCE * cpiF);
  const vi = (x: number) => [{ account: '2230', debit: r2(x * vatRate) }];
  payBatch(F, 'airportco', day, month, `PUR-${ym}`, 'Terminal power, rescue and fire fighting and security, runway and terminal maintenance, insurance', [
    { to: ROW, amount: power, fromAccount: '5270', toAccount: '4040', fromExtra: vi(power), flow: 'imports' },
    { to: ROW, amount: security, fromAccount: '5320', toAccount: '4040', fromExtra: vi(security), flow: 'imports' },
    { to: ROW, amount: maint, fromAccount: '5260', toAccount: '4040', fromExtra: vi(maint), flow: 'imports' },
    { to: ROW, amount: admin, fromAccount: '5320', toAccount: '4040', fromExtra: vi(admin), flow: 'imports' },
    { to: ROW, amount: insurance, fromAccount: '5320', toAccount: '4040', flow: 'imports' },
  ], 'purchases');
  depreciateFixed(F, 'airportco', day, month, 2_400_000 / 240);
  void world;
  return {
    landings,
    seats: r2(FLIGHTS.length * PLANE_SEATS * 30.44),
    residentTrips,
    businessTrips,
    rowPax: plan.rowPax,
    loadFactor: r2(((plan.rowPax + residentTrips) / Math.max(1, FLIGHTS.length * PLANE_SEATS * 30.44)) * 1000) / 1000,
    fare: r2(f.air),
    surcharge: f.airSurcharge,
    tickets: r2(residentTrips * trip * (1 + vatRate)),
    airportRevenue: revenue,
    airportCosts: r2(power + security + maint + admin + insurance),
  };
}

// ─── Year end ───────────────────────────────────────────────────────────────

/**
 * After the books close: the airport company, a state-owned company with no
 * projects of its own to fund, pays 80% of its profit to the province as its
 * shareholder (dividends to a sphere of government are exempt from dividends
 * tax, s64F); the app's foreign parent takes 60% of the platform's profit and
 * the fleet's investors from outside the province half of the fleet's, with
 * dividends tax withheld at 20%. Each keeps three months of costs in the bank.
 */
export function transportYearEnd(F: FinanceState, day: number, month: number, label: string, profits: Record<string, number>, dividendsTaxRate: number): string[] {
  const out: string[] = [];
  const closed = month - 1;
  const costs = (id: string) => {
    const b = F.ledgers.books[id];
    if (!b) return 0;
    let s = 0;
    for (const code of ['5200', '5210', '5220', '5230', '5240', '5245', '5260', '5270', '5320']) s += movement(b, code, closed - 11, closed);
    return s / 12;
  };
  for (const [id, share, to] of [['airportco', 0.8, GOV], ['hamba', 0.6, ROW], ['fleet', 0.5, ROW]] as Array<[string, number, string]>) {
    const book = F.ledgers.books[id];
    const profit = profits[id] ?? 0;
    if (!book || profit <= 0) continue;
    const cash = deposits(F, id);
    const gross = r2(Math.min(share * profit, cash - 3 * costs(id), natural(book, '3020')));
    if (gross < 100) continue;
    if (to === GOV) {
      pay(F, { from: id, to: GOV, amount: gross, day, month, ref: `DIV-${label}`, memo: `Dividend to the province as shareholder for ${label} (exempt from dividends tax)`, flow: 'dividends', fromAccount: '3050', toAccount: '4120' });
    } else {
      const dt = r2(gross * dividendsTaxRate);
      pay(F, { from: id, to: ROW, amount: r2(gross - dt), day, month, ref: `DIV-${label}`, memo: `Dividend to the foreign parent for ${label} (net of dividends tax)`, flow: 'dividends', fromAccount: '3050', toAccount: '4900' });
      pay(F, { from: id, to: GOV, amount: dt, day, month, ref: `DTR01-${label}`, memo: 'Dividends tax withheld (20%)', flow: 'tax', fromAccount: '3050', toAccount: '4138' });
    }
    out.push(`${F.entities[id]?.name ?? id} paid a dividend of R${Math.round(gross).toLocaleString()} for ${label} to ${to === GOV ? 'the province' : 'its parent company'}.`);
  }
  return out;
}

// ─── Driver-partners: signing up and stopping ───────────────────────────────

/**
 * The e-hailing labour market, monthly: a driver-partner whose last month
 * earned well under their reservation wage an hour stops (three in ten do,
 * each month it lasts), as does one who has waited three months for a car;
 * when last month paid well above it and the cars were busy, someone out of
 * work with a licence-able age and schooling signs up.
 */
export function rideLabourMarket(ctx: Ctx, onStop: (p: Person) => void, onStart: (p: Person) => void): void {
  const world = ctx.world;
  const F = world.finance;
  if (!F?.entities?.fleet) return;
  const T = F.transport;
  const rng = ctx.rng.stream('transport');
  const last = T.months[T.months.length - 1];
  if (!last) return;
  const nmw = F.macro.nmwHourly;
  const res = reservationHourly(nmw);
  const drivers = alivePeople(world).filter((p) => p.job === 'ehailer' && !p.away);
  const netHourly = last.ride.netHourly;
  for (const p of drivers) {
    const waited = T.waiting[p.id] !== undefined ? F.month - T.waiting[p.id] : 0;
    if (waited >= 3 || (last.ride.drivers > 0 && netHourly < 0.75 * res && rng.bernoulli(0.3))) onStop(p);
  }
  const still = alivePeople(world).filter((p) => p.job === 'ehailer' && !p.away).length;
  // With nobody driving, the unmet demand itself is the opening; otherwise the cars must be busy and the hour pay well.
  const none = last.ride.drivers === 0;
  const busy = none ? last.ride.demandHours > 0 : last.ride.utilisation >= 0.5 || last.ride.surge > 1.05;
  const attractive = none ? true : netHourly >= 1.05 * res;
  if (still >= MAX_DRIVERS || !busy || !attractive) return;
  const pull = last.ride.drivers === 0 ? 0.6 : clamp(0.25 + (netHourly / res - 1), 0.1, 0.7);
  if (!rng.bernoulli(pull)) return;
  const cands = alivePeople(world).filter((p) => (p.job === 'unemployed' || p.job === 'homemaker') && !p.away && p.age >= 21 && p.age < 60 && p.education !== 'none' && p.health.state === 'healthy');
  if (!cands.length) return;
  onStart(rng.pick(cands));
}

/** The e-hailing market's parameters for the analytics' explanations. */
export const RIDE_PARAMS = { COMMISSION, DRIVER_HOURS, U_MAX, U_TARGET, RIDE_L_PER_KM, DEADHEAD, OUT_SHARE, CAR_RIDE_SHARE, THETA, ASC, BUDGET_ELASTICITY, FUEL_ELASTICITY, BOOKING_FEE, MAX_DRIVERS, FLEET_LIFE, FLEET_RESIDUAL, FLEET_LTV, FLEET_MARGIN };

