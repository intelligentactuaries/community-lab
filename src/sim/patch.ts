// Parameter changes from outside — Scelo, the swarm, the experiment lab —
// applied only where the engine knows the field, in its type, and within the
// range its own controls allow. A patch never sets the seed (experiments own
// the seeds, so arms share random numbers), nor the outside inputs, which
// travel in their own fields (mortalityOverride, shocks).

import type { ParamPatch, ParamValue } from '@scelo/core/exchange';
import { MORTALITY_PRESETS } from './mortality';
import { DEFAULT_PARAMS, type EducationMix, type ScenarioParams } from './params';

/** Ranges for numeric fields: the Scenario panel's sliders, and the finance block's plausible bounds. */
export const PARAM_RANGES: Partial<Record<keyof ScenarioParams, [number, number]>> = {
  households: [1, 16],
  meanHouseholdSize: [1.5, 7],
  maleShareAtBirth: [0.45, 0.55],
  homeschoolShare: [0, 1],
  tertiaryProgression: [0, 1],
  mortalityImprovement: [0, 0.03],
  bereavementMultiplier: [1, 3],
  povertyMortalityMultiplier: [1, 2],
  careQuality: [0, 1],
  fluAttackRate: [0, 0.5],
  tfr: [0.8, 6],
  contraceptionShare: [0, 1],
  marriageAgeM: [20, 45],
  marriageAgeF: [18, 42],
  courtshipHazard: [0, 1],
  divorceHazard: [0, 0.1],
  churchAttendance: [0, 1],
  youthEmigrationHazard: [0, 0.5],
  immigrationHazard: [0, 1],
  intrudersPerYear: [0, 60],
  disputeRate: [0, 200],
  policeEffectiveness: [0, 2],
  roadAccidentPer1000Km: [0, 0.05],
  carOwnership: [0, 1],
  trainMach: [1, 12],
  funeralPremium: [0, 1_000],
  funeralBenefit: [0, 100_000],
  lifeCoverSum: [0, 2_000_000],
  lifeCoverPremium: [0, 2_000],
  funeralCoverShare: [0, 1],
  lifeCoverShare: [0, 1],
  medicalAidShare: [0, 1],
  schemeReserve: [0, 5_000_000],
  childGrant: [0, 3_000],
  oldAgeGrant: [0, 6_000],
  povertyLine: [0, 6_000],
  retirementAge: [55, 75],
  repoRate: [0.0025, 0.3],
  inflationStart: [-0.02, 0.3],
  inflationTarget: [0, 0.15],
  minimumWageHourly: [0, 200],
  bankFoundingCapital: [1_000_000, 100_000_000],
  bankMemberShare: [0, 100_000],
  bracketIndexation: [0, 1.5],
  titheRate: [0, 0.3],
  realWageGrowth: [-0.05, 0.08],
  councilStipend: [0, 50_000],
};

const CHOICES: Partial<Record<keyof ScenarioParams, readonly string[]>> = {
  ageProfile: ['young', 'balanced', 'ageing'],
  healthProfile: ['sa-rural', 'sa-urban', 'developed'],
  climate: ['highveld', 'western-cape', 'kzn-coast', 'temperate-north'],
  fertilityShape: ['sa', 'late'],
  mortalityPreset: MORTALITY_PRESETS.map((p) => p.id),
};

/** Never through a patch: the seed belongs to the experiment, the rest have their own fields or are bookkeeping. */
const NOT_PATCHABLE = new Set<string>(['seed', 'mortalityOverride', 'shocks', 'journalRetentionMonths', 'tiers']);

const TIER_SHARES = new Set(['carOwnership', 'secondCarShare', 'funeralCoverShare', 'lifeCoverShare', 'medicalAidShare', 'unemployment']);

export interface PatchResult {
  params: Partial<ScenarioParams>;
  applied: string[];
  rejected: string[];
}

const isNum = (v: ParamValue): v is number => typeof v === 'number' && Number.isFinite(v);

/** Apply `patch` on top of `base`, field by field: what fits is taken, what does not is named and left out. */
export function applyPatch(base: Partial<ScenarioParams>, patch: ParamPatch | undefined): PatchResult {
  const params: Partial<ScenarioParams> = { ...base };
  const applied: string[] = [];
  const rejected: string[] = [];
  if (!patch) return { params, applied, rejected };
  const out = params as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'tiers') {
      patchTiers(params, value, applied, rejected);
      continue;
    }
    if (NOT_PATCHABLE.has(key) || !(key in DEFAULT_PARAMS)) {
      rejected.push(`${key}: not a parameter Community Lab takes from outside`);
      continue;
    }
    const k = key as keyof ScenarioParams;
    const def = DEFAULT_PARAMS[k];
    if (k === 'educationMix') {
      const mix = educationMix(value);
      if (mix) {
        out.educationMix = mix;
        applied.push(key);
      } else rejected.push(`${key}: six shares (none … postgrad) between 0 and 1`);
      continue;
    }
    if (typeof def === 'number') {
      const r = PARAM_RANGES[k];
      if (!isNum(value)) rejected.push(`${key}: a number`);
      else if (r && (value < r[0] || value > r[1])) rejected.push(`${key}: between ${r[0]} and ${r[1]}`);
      else {
        out[key] = value;
        applied.push(key);
      }
    } else if (typeof def === 'boolean') {
      if (typeof value === 'boolean') {
        out[key] = value;
        applied.push(key);
      } else rejected.push(`${key}: true or false`);
    } else if (typeof def === 'string') {
      const choices = CHOICES[k];
      if (typeof value !== 'string' || value.length > 60) rejected.push(`${key}: a short string`);
      else if (choices && !choices.includes(value)) rejected.push(`${key}: one of ${choices.join(', ')}`);
      else if (k === 'startDate' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) rejected.push(`${key}: YYYY-MM-DD`);
      else {
        out[key] = value;
        applied.push(key);
      }
    } else rejected.push(`${key}: not settable from outside`);
  }
  return { params, applied, rejected };
}

function educationMix(v: ParamValue): EducationMix | null {
  if (typeof v !== 'object' || v === null) return null;
  const keys: Array<keyof EducationMix> = ['none', 'primary', 'secondary', 'matric', 'tertiary', 'postgrad'];
  const raw = v as Record<string, ParamValue>;
  const mix = { ...DEFAULT_PARAMS.educationMix };
  for (const k of keys) {
    if (raw[k] === undefined) continue;
    const x = raw[k];
    if (!isNum(x) || x < 0 || x > 1) return null;
    mix[k] = x;
  }
  const sum = keys.reduce((a, k) => a + mix[k], 0);
  if (sum <= 0) return null;
  for (const k of keys) mix[k] = mix[k] / sum;
  return mix;
}

function patchTiers(params: Partial<ScenarioParams>, v: ParamValue, applied: string[], rejected: string[]): void {
  if (typeof v !== 'object' || v === null) {
    rejected.push('tiers: an object of tier → shares');
    return;
  }
  const tiers = structuredClone(params.tiers ?? DEFAULT_PARAMS.tiers);
  for (const [tier, fields] of Object.entries(v as Record<string, ParamValue>)) {
    if (!(tier in tiers) || typeof fields !== 'object' || fields === null) {
      rejected.push(`tiers.${tier}: not a settlement tier`);
      continue;
    }
    for (const [f, x] of Object.entries(fields as Record<string, ParamValue>)) {
      if (!TIER_SHARES.has(f) || !isNum(x) || x < 0 || x > 1) {
        rejected.push(`tiers.${tier}.${f}: one of ${[...TIER_SHARES].join(', ')}, between 0 and 1`);
        continue;
      }
      (tiers[tier as keyof typeof tiers] as unknown as Record<string, number>)[f] = x;
      applied.push(`tiers.${tier}.${f}`);
    }
  }
  params.tiers = tiers;
}

/** The fields of `p` that differ from the defaults (the outside inputs included) — what a provenance records. */
export function changedFromDefaults(p: Partial<ScenarioParams>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'seed' || v === undefined) continue;
    const d = (DEFAULT_PARAMS as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
  }
  return out;
}
