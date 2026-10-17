// The Community Builder's catalogue: everything a world can be built from.
// Each asset knows its footprint, which way its door may face, how its rooms
// are laid out (layout/builders.ts, the same builders the province was drawn
// with), what it is for (the landmark roles it plays and whom it serves), the
// posts a community cannot leave empty there, whether the state pays its
// staff, and the books it keeps. plan/derive.ts reads all of this to turn a
// plan into an atlas the engine can run.

import type { BusinessSpec, LandmarkKind } from '../atlas';
import type { Box, Facing } from '../layout/builders';
import { bank, busstop, cemetery, church, clinic, concertHall, council, court, farm, govt, grandPark, hall, hangar, hospital, library, mall, medical, office, park, plaza, police, runway, school, shop, sportsCentre, stadium, station, taxirank, terminal, terminus, workshop, ambulanceStation } from '../layout/builders';
import { houseBuilding, type PlotSpec } from '../layout/plots';
import type { Building, BuildingKind, JobId, Tier } from '../types';
import type { PlanBuilding } from './types';

export type AssetCategory = 'homes' | 'faith' | 'learning' | 'health' | 'safety' | 'commerce' | 'work' | 'leisure' | 'transport';

export const CATEGORIES: Array<{ id: AssetCategory; label: string }> = [
  { id: 'homes', label: 'Homes' },
  { id: 'faith', label: 'Faith & community' },
  { id: 'learning', label: 'Learning' },
  { id: 'health', label: 'Health' },
  { id: 'safety', label: 'Safety & government' },
  { id: 'commerce', label: 'Shops & banks' },
  { id: 'work', label: 'Work' },
  { id: 'leisure', label: 'Parks & leisure' },
  { id: 'transport', label: 'Transport' },
];

export interface AssetOption {
  key: string;
  label: string;
  kind: 'select' | 'number' | 'toggle';
  choices?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  default: string | number | boolean;
  /** Changing it resizes the footprint to the asset's size for the new value. */
  resizes?: boolean;
}

/** A post the community cannot leave empty: who fills it, from where. */
export interface StaffSpec {
  job: JobId;
  n: number;
  /** Filled from the building's settlement, its city, or anyone in the world. */
  from: 'settlement' | 'city' | 'region';
}

export interface AssetSpec {
  id: string;
  label: string;
  category: AssetCategory;
  /** The building kind it makes (what the renderers draw). */
  kind: BuildingKind;
  /** What it does in the simulation, one line for the library. */
  blurb: string;
  /** Default footprint, and the smallest and largest it may be drawn. */
  size: { w: number; h: number };
  min: { w: number; h: number };
  max: { w: number; h: number };
  /** Which sides its door may face. */
  facings: Facing[];
  /** A footprint that cannot be stretched (a house on its plot). */
  fixedSize?: boolean;
  options?: AssetOption[];
  /** The footprint for an option's value (a church's size, a house's tier). */
  sizeFor?: (opts: Record<string, unknown>) => { w: number; h: number };
  /** Lays out the rooms and furniture. */
  build: (b: PlanBuilding) => Building;
  /** The purposes it serves (which landmark it can be for its settlement and city). */
  roles?: LandmarkKind[];
  /** Whom it serves first: its own settlement, its city, or the whole world. */
  scope: 'settlement' | 'city' | 'region';
  staff?: StaffSpec[];
  /** The state pays its staff. */
  public?: boolean;
  /** The books it keeps (null: none), shaped by its settlement's wealth. */
  business?: (tier: Tier, b: PlanBuilding) => Omit<BusinessSpec, 'id' | 'city'> | null;
  /** Its owner's surname goes on the sign while it keeps its default name. */
  ownerName?: { job: JobId; pattern: string; female?: string };
  /** Hidden from the library (placed as part of a set, such as the airfield). */
  hidden?: boolean;
  /** One glyph for the library and the map (Icons.tsx draws it). */
  icon: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALL: Facing[] = ['N', 'S', 'E', 'W'];

function box(b: PlanBuilding): Box {
  return { id: b.id, name: b.name, com: b.settlement, x: b.x, y: b.y, w: b.w, h: b.h, facing: b.facing };
}

function opt<T extends string | number | boolean>(b: PlanBuilding, key: string, fallback: T): T {
  const v = b.options?.[key];
  return (v === undefined ? fallback : v) as T;
}

/** How rich a tier is, 0 (low-income) to 1 (the estates). */
export function tierWealth(tier: Tier): number {
  switch (tier) {
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

const poor = (t: Tier) => t === 'working' || t === 'low-income';
const rich = (t: Tier) => t === 'ultra' || t === 'affluent';
const round = (x: number, to = 1000) => Math.round(x / to) * to;

// ─── Houses ─────────────────────────────────────────────────────────────────

/** House plots by tier, as the province lays them out (the house sits on its plot; the rest is yard). */
export const HOUSE_PLOTS: Record<'small' | 'standard' | 'large', { w: number; h: number }> = {
  small: { w: 46, h: 82 },
  standard: { w: 52, h: 90 },
  large: { w: 72, h: 92 },
};

/**
 * A house on its plot. The layouts face north or south; for east and west the
 * plot is laid out facing south (or north) and turned on its diagonal, so the
 * gate meets the road on the plot's short side whichever way the street runs.
 */
export function buildHouse(b: PlanBuilding, tier: 'small' | 'standard' | 'large'): Building {
  const plot = b.plot ?? 0;
  if (b.facing === 'N' || b.facing === 'S') {
    const p: PlotSpec = { plot, x: b.x, y: b.y, w: b.w, h: b.h, facing: b.facing === 'N' ? 'north' : 'south', community: b.settlement, tier };
    const hb = houseBuilding(p);
    hb.id = b.id;
    hb.name = b.name;
    for (const r of hb.rooms) r.id = r.id.replace(`house${plot}-`, `${b.id}-`);
    return hb;
  }
  // East: build facing south on the transposed plot, then transpose (x ↔ y) into place; west: facing north.
  const p: PlotSpec = { plot, x: 0, y: 0, w: b.h, h: b.w, facing: b.facing === 'E' ? 'south' : 'north', community: b.settlement, tier };
  const hb = houseBuilding(p);
  const T = (pt: { x: number; y: number }) => ({ x: b.x + pt.y, y: b.y + pt.x });
  const out: Building = {
    ...hb,
    id: b.id,
    name: b.name,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    entrance: T(hb.entrance),
    door: hb.door ? T(hb.door) : undefined,
    rooms: hb.rooms.map((r) => ({ ...r, id: r.id.replace(`house${plot}-`, `${b.id}-`), x: b.x + r.y, y: b.y + r.x, w: r.h, h: r.w, spots: r.spots.map((s) => ({ ...s, x: Math.round((b.x + s.y) * 10) / 10, y: Math.round((b.y + s.x) * 10) / 10 })) })),
  };
  return out;
}

function houseAsset(id: string, label: string, tier: 'small' | 'standard' | 'large', blurb: string): AssetSpec {
  const sz = HOUSE_PLOTS[tier];
  return {
    id,
    label,
    category: 'homes',
    kind: 'house',
    blurb,
    size: sz,
    min: sz,
    max: sz,
    facings: ALL,
    fixedSize: true,
    // Turned east or west, the plot lies the other way round.
    sizeFor: (o) => (o.facing === 'E' || o.facing === 'W' ? { w: sz.h, h: sz.w } : sz),
    build: (b) => buildHouse(b, tier),
    scope: 'settlement',
    icon: 'house',
  };
}

// ─── Business templates (from the province's own books) ─────────────────────

const SPAZA = (): Omit<BusinessSpec, 'id' | 'city'> => ({ kind: 'shop', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 5_000, '1200': 15_000, '1500': 22_000 }, openingMemo: 'Opening balances: float, stock and the container', cogs: 0.72, overhead: 450, dep: 22_000 / 60, localFood: 0.9, localGoods: 0.7 });

const MARKET = (t: Tier): Omit<BusinessSpec, 'id' | 'city'> =>
  poor(t)
    ? { kind: 'market', regime: 'sbc', vatRegistered: true, sdl: false, ownerJob: 'shopkeeper', opening: { '1020': 25_000, '1200': 60_000, '1500': 90_000 }, openingMemo: 'Opening balances: float, stock and shop fittings', cogs: 0.72, overhead: 2_000, dep: 90_000 / 120, walkIn: 2_500, localFood: 0.85, localGoods: 0.6 }
    : { kind: 'market', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 40_000, '1200': 90_000, '1500': 150_000 }, openingMemo: 'Opening balances: float, stock and shop fittings', cogs: 0.7, overhead: 2_800, dep: 150_000 / 120, walkIn: 4_000, localFood: 0.8, localGoods: 0.5 };

const DELI = (t: Tier): Omit<BusinessSpec, 'id' | 'city'> => ({ kind: 'shop', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'shopkeeper', opening: { '1020': 70_000, '1200': 150_000, '1500': 260_000 }, openingMemo: 'Opening balances: float, stock and shopfitting', cogs: 0.62, overhead: 2_200, dep: 260_000 / 120, walkIn: rich(t) ? 6_000 : 4_000, localFood: 0.85, localGoods: 0.5 });

function churchBooks(t: Tier, size: string): Omit<BusinessSpec, 'id' | 'city'> {
  const base = size === 'small' ? { cash: 9_000, prop: 180_000, util: 700, other: 350, memo: 'Opening balances: offering float, tent and stand' } : size === 'medium' ? { cash: 30_000, prop: 600_000, util: 1_500, other: 900, memo: 'Opening balances: offering float and the hall' } : { cash: 60_000, prop: 1_500_000, util: 2_500, other: 1_500, memo: 'Opening balances: building fund and church property' };
  // A congregation's means follow its members': the estates' chapel is three times a township's.
  const m = 0.6 + 0.8 * tierWealth(t);
  return { kind: 'church', regime: 'pbo', vatRegistered: false, sdl: false, opening: { '1020': round(base.cash * m), '1500': round(base.prop * m, 10_000) }, openingMemo: base.memo, util: round(base.util * m, 50), other: round(base.other * m, 50) };
}

// ─── The catalogue ──────────────────────────────────────────────────────────

export const ASSETS: AssetSpec[] = [
  // ── Homes ──
  houseAsset('house-small', 'Small house', 'small', 'A compact three-room home on a 46 × 82 m plot (Kanana, the townships).'),
  houseAsset('house', 'House', 'standard', 'A family home with three bedrooms on a 52 × 90 m plot (Ebenezer, Oakdale).'),
  houseAsset('house-large', 'Large house', 'large', 'An estate home with a study and a main suite on a 72 × 92 m garden plot (Hebron Heights).'),
  // ── Faith & community ──
  {
    id: 'church',
    label: 'Church',
    category: 'faith',
    kind: 'church',
    blurb: 'A congregation: Sunday services, Bible study, choir and youth, weddings and funerals. Its pastor is filled first; tithes keep its books.',
    size: { w: 104, h: 74 },
    min: { w: 50, h: 50 },
    max: { w: 200, h: 160 },
    facings: ALL,
    options: [{ key: 'size', label: 'Size', kind: 'select', choices: [{ value: 'small', label: 'Small (tent hall)' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], default: 'medium', resizes: true }],
    sizeFor: (o) => (o.size === 'small' ? { w: 64, h: 58 } : o.size === 'large' ? { w: 116, h: 84 } : { w: 104, h: 74 }),
    build: (b) => church({ ...box(b), size: opt(b, 'size', 'medium') as 'small' | 'medium' | 'large' }),
    roles: ['church'],
    scope: 'settlement',
    staff: [{ job: 'pastor', n: 1, from: 'settlement' }],
    business: (t, b) => churchBooks(t, opt(b, 'size', 'medium')),
    icon: 'church',
  },
  {
    id: 'hall',
    label: 'Community hall',
    category: 'faith',
    kind: 'hall',
    blurb: 'Wedding receptions and memorials where there is no church; the city keeps it.',
    size: { w: 80, h: 64 },
    min: { w: 56, h: 44 },
    max: { w: 160, h: 120 },
    facings: ALL,
    build: (b) => hall(box(b)),
    roles: ['hall'],
    scope: 'city',
    public: true,
    icon: 'hall',
  },
  {
    id: 'library',
    label: 'Library',
    category: 'faith',
    kind: 'library',
    blurb: 'Reading rooms and stacks; a midweek evening out where there is no congregation. Staffed by a librarian.',
    size: { w: 116, h: 84 },
    min: { w: 80, h: 60 },
    max: { w: 200, h: 160 },
    facings: ALL,
    build: (b) => library(box(b)),
    roles: ['library'],
    scope: 'city',
    staff: [{ job: 'librarian', n: 1, from: 'city' }],
    public: true,
    icon: 'library',
  },
  {
    id: 'cemetery',
    label: 'Cemetery',
    category: 'faith',
    kind: 'cemetery',
    blurb: "The city's dead are buried here, row by row. Without one, burials happen out of town.",
    size: { w: 78, h: 72 },
    min: { w: 40, h: 40 },
    max: { w: 240, h: 240 },
    facings: ALL,
    build: (b) => cemetery(box(b)),
    roles: ['cemetery'],
    scope: 'city',
    icon: 'cemetery',
  },
  // ── Learning ──
  {
    id: 'school',
    label: 'School',
    category: 'learning',
    kind: 'school',
    blurb: "Two classrooms, a staff room and a playground; the city's children attend on school days. Three teachers.",
    size: { w: 112, h: 76 },
    min: { w: 100, h: 70 },
    max: { w: 220, h: 160 },
    facings: ALL,
    build: (b) => school(box(b)),
    roles: ['school'],
    scope: 'city',
    staff: [{ job: 'teacher', n: 3, from: 'city' }],
    public: true,
    icon: 'school',
  },
  // ── Health ──
  {
    id: 'clinic',
    label: 'Clinic',
    category: 'health',
    kind: 'clinic',
    blurb: 'Reception, a consulting room, a six-bed ward and a dispensary; an ambulance stands by. A doctor and two nurses.',
    size: { w: 84, h: 76 },
    min: { w: 76, h: 70 },
    max: { w: 160, h: 140 },
    facings: ALL,
    build: (b) => clinic(box(b)),
    roles: ['clinic'],
    scope: 'city',
    staff: [{ job: 'doctor', n: 1, from: 'city' }, { job: 'nurse', n: 2, from: 'city' }],
    public: true,
    icon: 'clinic',
  },
  {
    id: 'medical',
    label: 'Medical centre',
    category: 'health',
    kind: 'medical',
    blurb: "The district medical officer's centre: the DMO sits on the city council ex officio for health.",
    size: { w: 84, h: 60 },
    min: { w: 70, h: 50 },
    max: { w: 160, h: 120 },
    facings: ALL,
    build: (b) => medical(box(b)),
    roles: ['medical'],
    scope: 'city',
    staff: [{ job: 'dmo', n: 1, from: 'city' }],
    public: true,
    icon: 'medical',
  },
  {
    id: 'hospital',
    label: 'Hospital',
    category: 'health',
    kind: 'hospital',
    blurb: 'Theatres, intensive care and two wards: referrals for surgery and specialist care from the whole world. Two surgeons.',
    size: { w: 280, h: 260 },
    min: { w: 200, h: 200 },
    max: { w: 400, h: 360 },
    facings: ALL,
    build: (b) => hospital(box(b)),
    scope: 'region',
    staff: [{ job: 'surgeon', n: 2, from: 'region' }, { job: 'doctor', n: 1, from: 'region' }, { job: 'nurse', n: 4, from: 'region' }],
    public: true,
    icon: 'hospital',
  },
  {
    id: 'ambulance',
    label: 'Ambulance station',
    category: 'health',
    kind: 'workshop',
    blurb: 'Two ambulances on call for the whole world, beside the hospital.',
    size: { w: 70, h: 44 },
    min: { w: 56, h: 36 },
    max: { w: 120, h: 80 },
    facings: ALL,
    build: (b) => ambulanceStation(box(b)),
    scope: 'region',
    public: true,
    icon: 'ambulance',
  },
  // ── Safety & government ──
  {
    id: 'police',
    label: 'Police station',
    category: 'safety',
    kind: 'police',
    blurb: 'A charge office, holding cells and a patrol car. Officers answer incidents nearest them first. Three officers.',
    size: { w: 64, h: 76 },
    min: { w: 60, h: 70 },
    max: { w: 160, h: 140 },
    facings: ALL,
    options: [{ key: 'cells', label: 'Holding cells', kind: 'number', min: 1, max: 4, step: 1, default: 2 }],
    build: (b) => police({ ...box(b), cells: opt(b, 'cells', 2) }),
    roles: ['police'],
    scope: 'city',
    staff: [{ job: 'police', n: 3, from: 'city' }],
    public: true,
    icon: 'police',
  },
  {
    id: 'court',
    label: "Magistrate's court",
    category: 'safety',
    kind: 'court',
    blurb: "Hears the city's cases on Tuesdays and Thursdays. A magistrate and a clerk. Without one, cases go to the regional court.",
    size: { w: 90, h: 76 },
    min: { w: 76, h: 64 },
    max: { w: 160, h: 140 },
    facings: ALL,
    build: (b) => court(box(b)),
    roles: ['court'],
    scope: 'city',
    staff: [{ job: 'magistrate', n: 1, from: 'city' }, { job: 'clerk', n: 1, from: 'city' }],
    public: true,
    icon: 'court',
  },
  {
    id: 'council',
    label: 'Council chamber',
    category: 'safety',
    kind: 'council',
    blurb: "The city's elected council (finance, audit, actuarial, legal, wellbeing, red team, health) sits here on the first Tuesday.",
    size: { w: 92, h: 70 },
    min: { w: 70, h: 56 },
    max: { w: 160, h: 140 },
    facings: ALL,
    build: (b) => council(box(b)),
    roles: ['council'],
    scope: 'city',
    public: true,
    icon: 'council',
  },
  {
    id: 'post',
    label: 'Post office & pay point',
    category: 'safety',
    kind: 'govt',
    blurb: 'Grants are paid and post collected here: two civil servants from the city.',
    size: { w: 96, h: 66 },
    min: { w: 70, h: 50 },
    max: { w: 160, h: 120 },
    facings: ALL,
    build: (b) => office({ ...box(b), kind: 'govt' }),
    scope: 'city',
    staff: [{ job: 'civilservant', n: 2, from: 'city' }],
    public: true,
    icon: 'post',
  },
  {
    id: 'govt',
    label: 'Government house',
    category: 'safety',
    kind: 'govt',
    blurb: "The region's legislature, executive and departments: four civil servants from anywhere.",
    size: { w: 200, h: 150 },
    min: { w: 140, h: 110 },
    max: { w: 300, h: 240 },
    facings: ALL,
    build: (b) => govt(box(b)),
    scope: 'region',
    staff: [{ job: 'civilservant', n: 4, from: 'region' }],
    public: true,
    icon: 'govt',
  },
  // ── Shops & banks ──
  {
    id: 'spaza',
    label: 'Spaza shop',
    category: 'commerce',
    kind: 'market',
    blurb: 'A survivalist corner shop on turnover tax, not a VAT vendor: the township buys nearly everything here.',
    size: { w: 56, h: 44 },
    min: { w: 40, h: 34 },
    max: { w: 90, h: 70 },
    facings: ALL,
    build: (b) => shop({ ...box(b), stalls: [3, 1] }),
    roles: ['shop'],
    scope: 'settlement',
    staff: [{ job: 'shopkeeper', n: 1, from: 'settlement' }],
    business: () => SPAZA(),
    ownerName: { job: 'shopkeeper', pattern: "{surname}'s Spaza", female: "Mama {first}'s Spaza" },
    icon: 'shop',
  },
  {
    id: 'market',
    label: 'General dealer',
    category: 'commerce',
    kind: 'market',
    blurb: 'A general dealer with a square out front. The first one is the produce market: fresh food clears through it from the farm.',
    size: { w: 84, h: 76 },
    min: { w: 70, h: 60 },
    max: { w: 160, h: 140 },
    facings: ALL,
    options: [{ key: 'front', label: 'Market square out front', kind: 'toggle', default: true }],
    build: (b) => shop({ ...box(b), front: opt(b, 'front', true), stalls: [3, 3] }),
    roles: ['shop'],
    scope: 'settlement',
    staff: [{ job: 'shopkeeper', n: 1, from: 'settlement' }, { job: 'vendor', n: 1, from: 'city' }],
    business: (t) => MARKET(t),
    icon: 'market',
  },
  {
    id: 'deli',
    label: 'Deli & trading',
    category: 'commerce',
    kind: 'market',
    blurb: 'A fine-foods store for the richer suburbs: VAT vendor, higher margins, passing trade.',
    size: { w: 76, h: 60 },
    min: { w: 60, h: 48 },
    max: { w: 140, h: 110 },
    facings: ALL,
    build: (b) => shop({ ...box(b), stalls: [3, 2] }),
    roles: ['shop'],
    scope: 'settlement',
    staff: [{ job: 'shopkeeper', n: 1, from: 'settlement' }],
    business: (t) => DELI(t),
    icon: 'deli',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    category: 'commerce',
    kind: 'market',
    blurb: 'A dispensary and its shop (sales to passers-by; households do not buy their food here).',
    size: { w: 70, h: 50 },
    min: { w: 50, h: 40 },
    max: { w: 120, h: 90 },
    facings: ALL,
    build: (b) => shop({ ...box(b), stalls: [2, 1] }),
    scope: 'city',
    business: () => ({ kind: 'shop', regime: 'sbc', vatRegistered: true, sdl: false, opening: { '1020': 30_000, '1200': 80_000, '1500': 120_000 }, openingMemo: 'Opening balances: float, dispensary stock and fittings', cogs: 0.68, overhead: 3_000, dep: 120_000 / 120, walkIn: 12_000, localFood: 0, localGoods: 0 }),
    icon: 'pharmacy',
  },
  {
    id: 'mall',
    label: 'Mall',
    category: 'commerce',
    kind: 'mall',
    blurb: 'A concourse, a food court and four shops: Saturday shopping for the whole world, and the town centre for getting about.',
    size: { w: 290, h: 200 },
    min: { w: 200, h: 140 },
    max: { w: 420, h: 300 },
    facings: ALL,
    build: (b) => mall({ ...box(b), shops: [{ id: 'super', name: 'Supermarket' }, { id: 'dept', name: 'Department store' }, { id: 'fashion', name: 'Fashion & footwear' }, { id: 'tech', name: 'Electronics & phones' }] }),
    scope: 'region',
    staff: [{ job: 'shopkeeper', n: 2, from: 'region' }, { job: 'vendor', n: 2, from: 'region' }],
    business: () => ({ kind: 'mall', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 600_000, '1200': 1_400_000, '1500': 3_500_000 }, openingMemo: 'Opening balances: float, stock across the shops, the building and fittings', cogs: 0.66, overhead: 24_000, dep: 3_500_000 / 240, walkIn: 40_000, localFood: 0.5, localGoods: 0.55 }),
    icon: 'mall',
  },
  {
    id: 'bank',
    label: 'Mutual Bank branch',
    category: 'commerce',
    kind: 'bank',
    blurb: "The member-owned Mutual Bank's counter (deposits, loans, IFRS 9). The head office pays in full; other counters open mornings.",
    size: { w: 58, h: 50 },
    min: { w: 50, h: 44 },
    max: { w: 120, h: 100 },
    facings: ALL,
    options: [{ key: 'hq', label: 'Head office', kind: 'toggle', default: false }],
    build: (b) => bank(box(b)),
    roles: ['bank'],
    scope: 'settlement',
    staff: [{ job: 'banker', n: 1, from: 'settlement' }],
    icon: 'bank',
  },
  {
    id: 'combank',
    label: 'Commercial bank',
    category: 'commerce',
    kind: 'combank',
    blurb: "The firms' bank: business banking fees, the state's transaction banking, settlement for the Mutual Bank. Two officers.",
    size: { w: 96, h: 66 },
    min: { w: 76, h: 56 },
    max: { w: 160, h: 140 },
    facings: ALL,
    build: (b) => bank({ ...box(b), kind: 'combank' }),
    scope: 'city',
    staff: [{ job: 'combanker', n: 2, from: 'city' }],
    business: () => ({ kind: 'combank', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 450_000, '1500': 1_100_000 }, openingMemo: 'Opening balances: working capital, systems and premises', publicFees: 26_000, correspondentFees: 22_000, treasury: 55_000, running: 14_000, dep: 1_100_000 / 120 }),
    icon: 'combank',
  },
  {
    id: 'reservebank',
    label: 'Reserve bank',
    category: 'commerce',
    kind: 'reservebank',
    blurb: "Monetary policy and markets: the MPC's home. Two central bankers.",
    size: { w: 160, h: 140 },
    min: { w: 110, h: 100 },
    max: { w: 240, h: 220 },
    facings: ALL,
    build: (b) => bank({ ...box(b), kind: 'reservebank' }),
    scope: 'region',
    staff: [{ job: 'centralbanker', n: 2, from: 'region' }],
    public: true,
    icon: 'reservebank',
  },
  // ── Work ──
  {
    id: 'office',
    label: 'Co-op offices',
    category: 'work',
    kind: 'office',
    blurb: "The city's co-operative: office jobs, services invoiced to the region, and a yearly surplus paid out to every household of the city.",
    size: { w: 62, h: 52 },
    min: { w: 50, h: 40 },
    max: { w: 160, h: 140 },
    facings: ALL,
    build: (b) => office(box(b)),
    roles: ['office'],
    scope: 'city',
    business: (t) => (poor(t) ? { kind: 'office', regime: 'cit', vatRegistered: true, sdl: false, opening: { '1020': 60_000, '1500': 120_000 }, openingMemo: 'Opening balances: grant funding and equipment', dep: 120_000 / 120, fees: 4_000, invoiceMemo: 'Grant income and services invoiced (standard-rated)' } : { kind: 'office', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 120_000, '1500': 300_000 }, openingMemo: 'Opening balances: working capital and equipment', dep: 300_000 / 120 }),
    icon: 'office',
  },
  {
    id: 'towers',
    label: 'Corporate towers',
    category: 'work',
    kind: 'towers',
    blurb: 'Corporate floors: the best-paid posts in the world (two executives), services sold well beyond it.',
    size: { w: 150, h: 110 },
    min: { w: 100, h: 80 },
    max: { w: 240, h: 200 },
    facings: ALL,
    build: (b) => office({ ...box(b), floors: 2, kind: 'towers' }),
    scope: 'region',
    staff: [{ job: 'executive', n: 2, from: 'region' }],
    business: () => ({ kind: 'office', regime: 'cit', vatRegistered: true, sdl: true, opening: { '1020': 400_000, '1500': 900_000 }, openingMemo: 'Opening balances: working capital and the corporate floors', dep: 900_000 / 120, fees: 30_000, admin: 18_000, utilities: 10_000, corporate: true }),
    icon: 'towers',
  },
  {
    id: 'chambers',
    label: 'Professional chambers',
    category: 'work',
    kind: 'office',
    blurb: "Attorneys and accountants: retainers from the region and the city's firms' audit and legal fees.",
    size: { w: 96, h: 62 },
    min: { w: 70, h: 50 },
    max: { w: 160, h: 120 },
    facings: ALL,
    build: (b) => office(box(b)),
    scope: 'city',
    staff: [{ job: 'attorney', n: 1, from: 'city' }, { job: 'accountant', n: 1, from: 'city' }],
    business: () => ({ kind: 'practice', regime: 'cit', vatRegistered: true, sdl: true, ownerJob: 'attorney', opening: { '1020': 160_000, '1500': 420_000 }, openingMemo: 'Opening balances: working capital, library and equipment', retainer: 52_000, running: 6_500, dep: 420_000 / 120 }),
    icon: 'chambers',
  },
  {
    id: 'workshop',
    label: 'Workshop',
    category: 'work',
    kind: 'workshop',
    blurb: "Building and repairs on turnover tax: households' maintenance, the co-op's contract and jobs outside.",
    size: { w: 62, h: 36 },
    min: { w: 40, h: 30 },
    max: { w: 140, h: 100 },
    facings: ALL,
    build: (b) => workshop(box(b)),
    roles: ['workshop'],
    scope: 'city',
    staff: [{ job: 'builder', n: 1, from: 'city' }],
    business: (t) => (poor(t) ? { kind: 'workshop', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'builder', opening: { '1020': 8_000, '1500': 45_000 }, openingMemo: 'Opening balances: float and welding gear', dep: 45_000 / 60 } : { kind: 'workshop', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'builder', opening: { '1020': 15_000, '1500': 80_000 }, openingMemo: 'Opening balances: float and tools', dep: 80_000 / 60 }),
    ownerName: { job: 'builder', pattern: "{surname}'s Workshop" },
    icon: 'workshop',
  },
  {
    id: 'farm',
    label: 'Farm',
    category: 'work',
    kind: 'farm',
    blurb: 'Barn, fields and a pen: output rises with each farm hand and falls with poor rains; it supplies the produce market.',
    size: { w: 62, h: 104 },
    min: { w: 56, h: 80 },
    max: { w: 300, h: 300 },
    facings: ALL,
    build: (b) => farm(box(b)),
    roles: ['farm'],
    scope: 'city',
    staff: [{ job: 'farmer', n: 1, from: 'city' }, { job: 'farmhand', n: 1, from: 'city' }],
    business: (t) => (poor(t) ? { kind: 'farm', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'farmer', opening: { '1020': 12_000, '1200': 40_000, '1500': 160_000 }, openingMemo: 'Opening balances: float, goats and maize, a second-hand tractor', outputBase: 32_000, outputPerHand: 14_000, dep: 160_000 / 180 } : { kind: 'farm', regime: 'sbc', vatRegistered: true, sdl: true, ownerJob: 'farmer', opening: { '1020': 50_000, '1200': 120_000, '1500': 600_000 }, openingMemo: 'Opening balances: float, livestock and standing crops, tractor and implements', outputBase: 60_000, outputPerHand: 22_000, dep: 600_000 / 180 }),
    ownerName: { job: 'farmer', pattern: '{surname} Farm' },
    icon: 'farm',
  },
  {
    id: 'taxi',
    label: 'Taxi rank',
    category: 'transport',
    kind: 'workshop',
    blurb: "A minibus-taxi association: four taxis, fares to town and beyond, diesel at the pump price. Two drivers.",
    size: { w: 60, h: 60 },
    min: { w: 50, h: 50 },
    max: { w: 140, h: 120 },
    facings: ALL,
    build: (b) => taxirank(box(b)),
    roles: ['taxi'],
    scope: 'city',
    staff: [{ job: 'taxidriver', n: 2, from: 'city' }],
    business: () => ({ kind: 'taxi', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 40_000, '1500': 700_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 15_000, dep: 700_000 / 96 }),
    icon: 'taxi',
  },
  // ── Parks & leisure ──
  {
    id: 'park',
    label: 'Park & sports field',
    category: 'leisure',
    kind: 'park',
    blurb: 'A pitch and benches: children play, the retired walk, the unemployed pass the time.',
    size: { w: 66, h: 104 },
    min: { w: 36, h: 50 },
    max: { w: 300, h: 300 },
    facings: ALL,
    build: (b) => park(box(b)),
    roles: ['park'],
    scope: 'settlement',
    icon: 'park',
  },
  {
    id: 'plaza',
    label: 'Square',
    category: 'leisure',
    kind: 'park',
    blurb: 'A civic square with benches.',
    size: { w: 108, h: 34 },
    min: { w: 40, h: 24 },
    max: { w: 240, h: 160 },
    facings: ALL,
    build: (b) => plaza(box(b)),
    roles: ['park'],
    scope: 'settlement',
    public: true,
    icon: 'plaza',
  },
  {
    id: 'grandpark',
    label: 'Grand park',
    category: 'leisure',
    kind: 'park',
    blurb: 'Lawns, a lake and a playground: Sunday afternoons from every city.',
    size: { w: 480, h: 190 },
    min: { w: 240, h: 140 },
    max: { w: 700, h: 400 },
    facings: ALL,
    build: (b) => grandPark(box(b)),
    scope: 'region',
    public: true,
    icon: 'grandpark',
  },
  {
    id: 'sports',
    label: 'Sports centre',
    category: 'leisure',
    kind: 'sports',
    blurb: 'Courts and a pool: Sunday sport for the secular and the young.',
    size: { w: 220, h: 160 },
    min: { w: 104, h: 74 },
    max: { w: 320, h: 240 },
    facings: ALL,
    build: (b) => sportsCentre(box(b)),
    scope: 'region',
    public: true,
    icon: 'sports',
  },
  {
    id: 'stadium',
    label: 'Stadium',
    category: 'leisure',
    kind: 'stadium',
    blurb: 'The Saturday match draws from every city. Two staff.',
    size: { w: 300, h: 190 },
    min: { w: 200, h: 140 },
    max: { w: 420, h: 300 },
    facings: ALL,
    build: (b) => stadium(box(b)),
    scope: 'region',
    staff: [{ job: 'office', n: 2, from: 'region' }],
    public: true,
    icon: 'stadium',
  },
  {
    id: 'concert',
    label: 'Concert hall',
    category: 'leisure',
    kind: 'concert',
    blurb: 'A Friday concert twice a month. Two staff.',
    size: { w: 140, h: 160 },
    min: { w: 100, h: 110 },
    max: { w: 240, h: 240 },
    facings: ALL,
    build: (b) => concertHall(box(b)),
    scope: 'region',
    staff: [{ job: 'office', n: 2, from: 'region' }],
    public: true,
    icon: 'concert',
  },
  // ── Transport ──
  {
    id: 'busstop',
    label: 'Bus stop',
    category: 'transport',
    kind: 'busstop',
    blurb: "A shelter. A city's stops make its bus line, into the terminus where there is one.",
    size: { w: 30, h: 14 },
    min: { w: 14, h: 14 },
    max: { w: 70, h: 44 },
    facings: ALL,
    build: (b) => busstop(box(b)),
    roles: ['busstop'],
    scope: 'settlement',
    icon: 'busstop',
  },
  {
    id: 'terminus',
    label: 'Bus & taxi terminus',
    category: 'transport',
    kind: 'terminus',
    blurb: 'Where every bus line ends and the regional taxis wait: the transit operator works from here.',
    size: { w: 180, h: 90 },
    min: { w: 110, h: 60 },
    max: { w: 300, h: 160 },
    facings: ALL,
    build: (b) => terminus({ ...box(b), bays: 4 }),
    scope: 'region',
    staff: [{ job: 'taxidriver', n: 2, from: 'region' }],
    business: () => ({ kind: 'taxi', regime: 'turnover', vatRegistered: false, sdl: false, ownerJob: 'taxidriver', opening: { '1020': 50_000, '1500': 760_000 }, openingMemo: 'Opening balances: float, the fuel account and the minibuses', routeFares: 18_000, dep: 760_000 / 96 }),
    icon: 'terminus',
  },
  {
    id: 'station',
    label: 'Hyperline station',
    category: 'transport',
    kind: 'station',
    blurb: 'A concourse and platform on the Hyperline guideway (draw the guideway with the Hyperline tool). Two stations or more run trains.',
    size: { w: 80, h: 60 },
    min: { w: 60, h: 50 },
    max: { w: 140, h: 100 },
    facings: ALL,
    options: [{ key: 'platform', label: 'Platform side', kind: 'select', choices: [{ value: 'N', label: 'North' }, { value: 'S', label: 'South' }, { value: 'E', label: 'East' }, { value: 'W', label: 'West' }], default: 'S' }],
    build: (b) => station({ ...box(b), platform: opt(b, 'platform', 'S') as Facing }),
    scope: 'region',
    public: true,
    icon: 'station',
  },
  // The airfield's parts: placed together by the Airfield set (plan/prefabs.ts).
  {
    id: 'airport-terminal',
    label: 'Airport terminal',
    category: 'transport',
    kind: 'terminal',
    blurb: 'Departures and arrivals, the airline desks and the apron with two stands.',
    size: { w: 180, h: 120 },
    min: { w: 180, h: 120 },
    max: { w: 180, h: 120 },
    facings: ['W'],
    fixedSize: true,
    build: (b) => terminal({ ...box(b), stands: 2 }),
    scope: 'region',
    staff: [{ job: 'pilot', n: 2, from: 'region' }],
    public: true,
    hidden: true,
    icon: 'plane',
  },
  { id: 'runway', label: 'Runway', category: 'transport', kind: 'runway', blurb: 'A 1.6 km runway.', size: { w: 45, h: 1600 }, min: { w: 45, h: 1600 }, max: { w: 45, h: 1600 }, facings: ['W'], fixedSize: true, build: (b) => runway(box(b)), scope: 'region', hidden: true, icon: 'plane' },
  { id: 'hangar', label: 'Hangar', category: 'transport', kind: 'hangar', blurb: 'Maintenance bays.', size: { w: 120, h: 80 }, min: { w: 80, h: 60 }, max: { w: 200, h: 140 }, facings: ALL, build: (b) => hangar(box(b)), scope: 'region', public: true, hidden: true, icon: 'plane' },
  { id: 'tower', label: 'Control tower', category: 'transport', kind: 'office', blurb: 'Air traffic control.', size: { w: 30, h: 30 }, min: { w: 24, h: 24 }, max: { w: 60, h: 60 }, facings: ALL, build: (b) => office(box(b)), scope: 'region', public: true, hidden: true, icon: 'plane' },
  { id: 'airport-fire', label: 'Fire & rescue', category: 'transport', kind: 'workshop', blurb: "The airport's fire and rescue station, with an ambulance.", size: { w: 60, h: 40 }, min: { w: 50, h: 34 }, max: { w: 100, h: 70 }, facings: ALL, build: (b) => ambulanceStation(box(b)), scope: 'region', public: true, hidden: true, icon: 'ambulance' },
];

export const ASSET: Record<string, AssetSpec> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

/** The footprint an asset is placed at, with its options (a church's size, a house turned east). */
export function assetSize(a: AssetSpec, opts: Record<string, unknown> = {}): { w: number; h: number } {
  return a.sizeFor ? a.sizeFor(opts) : a.size;
}
