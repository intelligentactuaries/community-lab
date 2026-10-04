// Scenario parameters — the complete, hashable assumption basis of a run.
// Every number here is an INPUT an actuary might want to change; the engine
// never hard-codes a rate that lives in this file. docs/ASSUMPTIONS.md lists
// the provenance of every default.

import type { MortalityOverride, Shock } from '@scelo/core/exchange';
import { hash32 } from './rng';
import type { Tier } from './types';

export type AgeProfileId = 'young' | 'balanced' | 'ageing';
export type HealthProfileId = 'sa-rural' | 'sa-urban' | 'developed';
export type ClimateId = 'highveld' | 'western-cape' | 'kzn-coast' | 'temperate-north';
export type FertilityShapeId = 'sa' | 'late';

export interface EducationMix {
  none: number;
  primary: number;
  secondary: number;
  matric: number;
  tertiary: number;
  postgrad: number;
}

/** Wealth profile of a settlement tier: how its households differ from the Ebenezer baseline. */
export interface CommunityProfile {
  /** Households seeded at t0 in a settlement of this tier (a layout may override; vacant plots are left for in-migration). */
  households: number;
  /** Adult education attainment mix at t0 (sums to 1). */
  educationMix: EducationMix;
  carOwnership: number;
  /** Share of a household's further adult drivers (beyond the first) who run a car of their own. */
  secondCarShare: number;
  funeralCoverShare: number;
  lifeCoverShare: number;
  medicalAidShare: number;
  /** Opening savings in months of household income, [lo, hi] uniform. */
  savingsMonths: [number, number];
  /** Share of working-age adults without formal work at t0 (drives the fallback job mix). */
  unemployment: number;
}

export interface ScenarioParams {
  /** Reproducibility. */
  seed: string;
  startDate: string; // YYYY-MM-DD
  /** The original village (Ebenezer): its name carries into the first city's institutions. */
  placeName: string;
  /** The province the three cities, the centre and the airport make up: names the Mutual Bank, the burial society and the Hyperline. */
  regionName: string;
  /** Households at t0. */
  households: number;
  /** Mean household size (Poisson-ish, min 1). */
  meanHouseholdSize: number;
  ageProfile: AgeProfileId;
  /** Share male at birth (SA ≈ 0.503). */
  maleShareAtBirth: number;
  /** Adult education attainment mix at t0 (sums to 1). */
  educationMix: EducationMix;
  /** Share of school-age children homeschooled (household-level decision). */
  homeschoolShare: number;
  /** Probability a matriculant goes on to tertiary study (leaves for the city). */
  tertiaryProgression: number;
  healthProfile: HealthProfileId;
  mortalityPreset: string;
  /** Annual mortality improvement applied to the whole table (Lee–Carter-style drift). */
  mortalityImprovement: number;
  /** Widowhood effect: relative mortality in the first year after losing a spouse. */
  bereavementMultiplier: number;
  /** Extra mortality multiplier for households below the poverty line. */
  povertyMortalityMultiplier: number;
  fertilityShape: FertilityShapeId;
  /** Target total fertility rate for the ASFR level. */
  tfr: number;
  /** 0..1 share of couples deliberately spacing / limiting (scales the level). */
  contraceptionShare: number;
  /** Mean age at first marriage by sex; the courtship hazard peaks around it. */
  marriageAgeM: number;
  marriageAgeF: number;
  /** Annual probability an eligible single starts a courtship (at the peak age). */
  courtshipHazard: number;
  /** Annual divorce hazard for a married couple. */
  divorceHazard: number;
  /**
   * 0..1 — share of residents at the Sunday service in a typical week, and the
   * mean of each person's faith. Households decide together (schedule.ts), so
   * the realised attendance tracks this closely.
   */
  churchAttendance: number;
  /** Annual emigration hazard for a 18-30 year old (study / work elsewhere). */
  youthEmigrationHazard: number;
  /** Annual probability an empty house is re-let to an in-migrant household. */
  immigrationHazard: number;
  /** Expected intruder / external incidents per year. */
  intrudersPerYear: number;
  /** Expected disputes per 100 residents per year before personality effects. */
  disputeRate: number;
  /** Police response speed multiplier (1 = normal). */
  policeEffectiveness: number;
  /** Clinic care quality: reduction in case-fatality for treated illness. */
  careQuality: number;
  /** Seasonal flu attack rate per person per year. */
  fluAttackRate: number;
  climate: ClimateId;
  /** Monthly premium and benefit of the community funeral scheme (ZAR). */
  funeralPremium: number;
  funeralBenefit: number;
  /** Life cover sum assured per adult policy (ZAR). */
  lifeCoverSum: number;
  lifeCoverPremium: number;
  /** Share of households holding each product at t0. */
  funeralCoverShare: number;
  lifeCoverShare: number;
  medicalAidShare: number;
  /** Initial reserve of the community scheme (ZAR). */
  schemeReserve: number;
  /** Social grants (ZAR / month) — SASSA levels from 1 April 2026 (older persons 60–74; 75+ get R20 more). */
  childGrant: number;
  oldAgeGrant: number;
  /** Household poverty line per member per month (ZAR). */
  povertyLine: number;
  /** Cars per household at t0 (0..1 probability). */
  carOwnership: number;
  /** Road accident hazard per 1,000 km driven (injury or worse). */
  roadAccidentPer1000Km: number;
  /**
   * The Hyperline's cruising speed in Mach. The trains are launched and
   * caught electromagnetically within the platform's length, so a hop
   * between stations takes about a second of simulated time at Mach 5.
   */
  trainMach: number;
  /** Retirement age. */
  retirementAge: number;
  /** Extra: enable HIV dynamics in the health profile. */
  hivEnabled: boolean;
  // ── Finance ──
  /** SARB repo rate at the start (Aug 2026: 6.75%). */
  repoRate: number;
  /** National CPI inflation at the start (Jul 2026: 4.3%) and the SARB target (3%). */
  inflationStart: number;
  inflationTarget: number;
  /** National minimum wage per hour (R30.23 from 1 March 2026). */
  minimumWageHourly: number;
  /** Mutual Banks Act minimum share capital (R10m) and each household's member share. */
  bankFoundingCapital: number;
  bankMemberShare: number;
  /** Months of full journal kept in memory (older months keep their digests and ledger balances). */
  journalRetentionMonths: number;
  /** Share of CPI inflation applied to tax brackets and rebates each March (1 = fully indexed, 0 = fiscal drag). */
  bracketIndexation: number;
  /** Whether the church holds s18A approval (tithes deductible up to 10% of taxable income). */
  churchS18A: boolean;
  /** Share of net earnings a fully committed household tithes. */
  titheRate: number;
  /** Real wage growth added to CPI at the March wage round. */
  realWageGrowth: number;
  // ── The region ──
  /**
   * Wealth profiles by settlement tier. Ebenezer's own tier ('affluent' since
   * the district became the region's rich city) still reads its education mix,
   * car ownership and cover shares from the baseline parameters above; every
   * other settlement takes its tier's profile here.
   */
  tiers: Record<Exclude<Tier, 'civic'>, CommunityProfile>;
  /** Monthly council stipend per elected seat (ZAR, indexed with wages; PAYE withheld at the marginal rate). */
  councilStipend: number;
  // ── From outside (Scelo) ──
  /**
   * A mortality basis supplied from outside — typically a table Scelo fitted to this province's own experience.
   * It replaces the preset table as the basis (and as the expected side of A/E), and every death channel is scaled
   * by the ratio of its force of mortality to the preset's, age by age, so the province's total mortality follows
   * it (shocks.ts). Absent unless supplied, so a default world's basis hash is unchanged.
   */
  mortalityOverride?: MortalityOverride;
  /** Timed shocks — a pandemic year, a rate stress, an oil spike (shocks.ts). Absent unless supplied. */
  shocks?: Shock[];
}

export const DEFAULT_PARAMS: ScenarioParams = {
  seed: 'agincourt-12',
  startDate: '2026-01-04',
  placeName: 'Ebenezer',
  regionName: 'Unity',
  households: 12,
  meanHouseholdSize: 4.2,
  ageProfile: 'balanced',
  maleShareAtBirth: 0.503,
  educationMix: { none: 0.03, primary: 0.15, secondary: 0.32, matric: 0.3, tertiary: 0.16, postgrad: 0.04 },
  homeschoolShare: 0.15,
  tertiaryProgression: 0.35,
  healthProfile: 'sa-rural',
  mortalityPreset: 'sa-2024',
  mortalityImprovement: 0.01,
  bereavementMultiplier: 1.6,
  povertyMortalityMultiplier: 1.15,
  fertilityShape: 'sa',
  tfr: 2.41,
  contraceptionShare: 0.0,
  marriageAgeM: 30,
  marriageAgeF: 27,
  courtshipHazard: 0.28,
  divorceHazard: 0.006,
  churchAttendance: 0.95,
  youthEmigrationHazard: 0.05,
  immigrationHazard: 0.25,
  intrudersPerYear: 6,
  disputeRate: 25,
  policeEffectiveness: 1,
  careQuality: 0.55,
  fluAttackRate: 0.12,
  climate: 'highveld',
  funeralPremium: 120,
  funeralBenefit: 25_000,
  lifeCoverSum: 100_000,
  lifeCoverPremium: 120,
  funeralCoverShare: 0.75,
  lifeCoverShare: 0.35,
  medicalAidShare: 0.3,
  schemeReserve: 200_000,
  childGrant: 580,
  oldAgeGrant: 2_400,
  povertyLine: 1_634,
  carOwnership: 0.6,
  roadAccidentPer1000Km: 0.0035,
  trainMach: 5,
  retirementAge: 65,
  hivEnabled: true,
  repoRate: 0.0675,
  inflationStart: 0.043,
  inflationTarget: 0.03,
  minimumWageHourly: 30.23,
  bankFoundingCapital: 10_000_000,
  bankMemberShare: 5_000,
  journalRetentionMonths: 36,
  bracketIndexation: 1,
  churchS18A: false,
  titheRate: 0.1,
  realWageGrowth: 0.005,
  tiers: {
    // Hebron Heights: the estates — executive and professional households (GHS 2023 top-decile shape).
    ultra: {
      households: 8,
      educationMix: { none: 0.002, primary: 0.008, secondary: 0.05, matric: 0.2, tertiary: 0.45, postgrad: 0.29 },
      carOwnership: 0.98,
      secondCarShare: 0.85,
      funeralCoverShare: 0.9,
      lifeCoverShare: 0.9,
      medicalAidShare: 0.97,
      savingsMonths: [12, 48],
      unemployment: 0.03,
    },
    // Ebenezer and Bellevue Heights: professional households (GHS 2023 top income quintile shape).
    affluent: {
      households: 12,
      educationMix: { none: 0.005, primary: 0.02, secondary: 0.1, matric: 0.295, tertiary: 0.4, postgrad: 0.18 },
      carOwnership: 0.95,
      secondCarShare: 0.55,
      funeralCoverShare: 0.85,
      lifeCoverShare: 0.75,
      medicalAidShare: 0.85,
      savingsMonths: [4, 18],
      unemployment: 0.08,
    },
    // Kanana: comfortable suburbia (fourth income quintile).
    comfortable: {
      households: 12,
      educationMix: { none: 0.01, primary: 0.06, secondary: 0.22, matric: 0.36, tertiary: 0.28, postgrad: 0.07 },
      carOwnership: 0.85,
      secondCarShare: 0.3,
      funeralCoverShare: 0.8,
      lifeCoverShare: 0.55,
      medicalAidShare: 0.6,
      savingsMonths: [2, 10],
      unemployment: 0.12,
    },
    // Oakdale: the middle-class baseline the original village was built on.
    middle: {
      households: 12,
      educationMix: { none: 0.03, primary: 0.15, secondary: 0.32, matric: 0.3, tertiary: 0.16, postgrad: 0.04 },
      carOwnership: 0.6,
      secondCarShare: 0.12,
      funeralCoverShare: 0.75,
      lifeCoverShare: 0.35,
      medicalAidShare: 0.3,
      savingsMonths: [0.5, 6],
      unemployment: 0.3,
    },
    // Westbrook and Bethesda: working-class households (second quintile).
    working: {
      households: 12,
      educationMix: { none: 0.05, primary: 0.2, secondary: 0.4, matric: 0.26, tertiary: 0.08, postgrad: 0.01 },
      carOwnership: 0.32,
      secondCarShare: 0.04,
      funeralCoverShare: 0.7,
      lifeCoverShare: 0.2,
      medicalAidShare: 0.1,
      savingsMonths: [0.3, 4],
      unemployment: 0.35,
    },
    // Siyakha and Nazareth: low-income settlements (GHS 2023 bottom quintile; QLFS expanded unemployment).
    'low-income': {
      households: 12,
      educationMix: { none: 0.09, primary: 0.28, secondary: 0.4, matric: 0.19, tertiary: 0.035, postgrad: 0.005 },
      carOwnership: 0.15,
      secondCarShare: 0.01,
      funeralCoverShare: 0.65,
      lifeCoverShare: 0.12,
      medicalAidShare: 0.04,
      savingsMonths: [0.2, 2.5],
      unemployment: 0.42,
    },
  },
  councilStipend: 4_800,
};

export function mergeParams(partial: Partial<ScenarioParams> | null | undefined): ScenarioParams {
  const p: ScenarioParams = { ...DEFAULT_PARAMS, ...(partial ?? {}) };
  if (partial?.educationMix) p.educationMix = { ...DEFAULT_PARAMS.educationMix, ...partial.educationMix };
  if (partial?.tiers) {
    const tiers = { ...DEFAULT_PARAMS.tiers };
    for (const k of Object.keys(DEFAULT_PARAMS.tiers) as Array<keyof ScenarioParams['tiers']>) {
      const o = partial.tiers[k];
      tiers[k] = { ...DEFAULT_PARAMS.tiers[k], ...o, educationMix: { ...DEFAULT_PARAMS.tiers[k].educationMix, ...o?.educationMix } };
    }
    p.tiers = tiers;
  }
  p.households = Math.max(1, Math.min(60, Math.round(p.households)));
  // Outside inputs exist only when given, so a world without them hashes exactly as before they existed.
  if (!p.mortalityOverride) delete p.mortalityOverride;
  if (!p.shocks?.length) delete p.shocks;
  return p;
}

/** Fields that name or tune a run without changing what it assumes. */
const NOT_ASSUMPTIONS = new Set<keyof ScenarioParams>(['seed', 'placeName', 'regionName', 'trainMach', 'journalRetentionMonths']);

/**
 * Fingerprint of the assumptions alone: basisHash without the seed and the cosmetic fields. Every seed of one basis
 * shares it, so a Monte Carlo export, or Scelo, can tell which runs may be pooled.
 */
export function assumptionsHash(p: ScenarioParams): string {
  const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !NOT_ASSUMPTIONS.has(k as keyof ScenarioParams)));
  return basisHash(rest as unknown as ScenarioParams);
}

/** Stable fingerprint of the basis — printed on every export like Scelo's "tables carry their hash". */
export function basisHash(p: ScenarioParams): string {
  const keys = Object.keys(p).sort();
  const canon = keys.map((k) => `${k}=${JSON.stringify((p as unknown as Record<string, unknown>)[k])}`).join('|');
  const h1 = hash32(canon);
  const h2 = hash32(canon + '#2');
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** Speed presets: simulated minutes per real second. */
export const SPEED_PRESETS: Array<{ id: string; label: string; minutesPerSecond: number; hint: string }> = [
  { id: 'realtime', label: '1×', minutesPerSecond: 1 / 60, hint: 'real time' },
  { id: 'x10', label: '10×', minutesPerSecond: 10 / 60, hint: '10 seconds per second' },
  { id: 'x60', label: '1 min/s', minutesPerSecond: 1, hint: 'a minute per second' },
  { id: 'x600', label: '10 min/s', minutesPerSecond: 10, hint: '10 minutes per second' },
  { id: 'hour', label: '1 h/s', minutesPerSecond: 60, hint: 'an hour per second' },
  { id: 'day', label: '1 day/s', minutesPerSecond: 1440, hint: 'a day per second' },
  { id: 'week', label: '1 wk/s', minutesPerSecond: 1440 * 7, hint: 'a week per second' },
  { id: 'month', label: '1 mo/s', minutesPerSecond: 1440 * 30.44, hint: 'a month per second' },
  { id: 'year', label: '1 yr/s', minutesPerSecond: 1440 * 365.25, hint: 'a year per second' },
  { id: 'lapse30', label: '30 yrs/min', minutesPerSecond: (1440 * 365.25 * 30) / 60, hint: 'thirty years in a minute' },
];
