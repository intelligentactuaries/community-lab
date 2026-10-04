// Personality (Big Five) sampling, inheritance, and the archetype → shape
// mapping that gives every community member a classical geometric identity.
//
// The Big Five (Costa & McCrae's NEO model) is the psychometric standard;
// the shape vocabulary is borrowed from Dellinger's Psycho-Geometrics
// (1989), which pairs geometric shapes with communication styles. We keep
// the continuous traits for behaviour and derive ONE dominant archetype for
// the glyph so the shape is legible at a glance from a bird's-eye view.

import type { Archetype, BigFive, Sex, Shape } from './types';
import { FIRST_NAMES, heritageOf } from './heritage';
import type { Rng } from './rng';

export const SHAPE_FOR: Record<Archetype, Shape> = {
  harmoniser: 'circle', // Agreeableness-dominant: people first, peacemaker
  organiser: 'square', // Conscientiousness-dominant: order, duty, detail
  driver: 'triangle', // Extraversion-dominant: leads, talks, initiates
  thinker: 'hexagon', // Openness-dominant: ideas, curiosity, faith questions
  sentinel: 'diamond', // Neuroticism-dominant: vigilant, worries, reacts
  balanced: 'pentagon', // No dominant trait
};

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  harmoniser: 'Harmoniser',
  organiser: 'Organiser',
  driver: 'Driver',
  thinker: 'Thinker',
  sentinel: 'Sentinel',
  balanced: 'Balanced',
};

export function sampleBigFive(rng: Rng): BigFive {
  const t = () => rng.clippedNormal(0.5, 0.16, 0.04, 0.96);
  return { O: t(), C: t(), E: t(), A: t(), N: t() };
}

/** Child traits: half mid-parent, half fresh draw (heritability ≈ 0.5). */
export function inheritBigFive(rng: Rng, mother: BigFive | null, father: BigFive | null): BigFive {
  const mid = (k: keyof BigFive): number => {
    const vals = [mother?.[k], father?.[k]].filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
  };
  const gene = (k: keyof BigFive): number => Math.min(0.96, Math.max(0.04, 0.5 * mid(k) + 0.5 * rng.clippedNormal(0.5, 0.16, 0.04, 0.96)));
  return { O: gene('O'), C: gene('C'), E: gene('E'), A: gene('A'), N: gene('N') };
}

export function archetypeOf(b: BigFive): Archetype {
  const dev: Array<[Archetype, number]> = [
    ['harmoniser', b.A - 0.5],
    ['organiser', b.C - 0.5],
    ['driver', b.E - 0.5],
    ['thinker', b.O - 0.5],
    ['sentinel', b.N - 0.5],
  ];
  dev.sort((x, y) => y[1] - x[1]);
  return dev[0][1] > 0.11 ? dev[0][0] : 'balanced';
}

// ─── Derived behavioural tendencies ─────────────────────────────────────

export function sociability(b: BigFive): number {
  return Math.min(1, Math.max(0, 0.65 * b.E + 0.35 * b.A));
}

/** Probability weight of escalating a disagreement. */
export function conflictProneness(b: BigFive): number {
  return Math.min(1, Math.max(0, 0.45 * (1 - b.A) + 0.35 * b.N + 0.2 * b.E * (1 - b.C)));
}

export function riskTaking(b: BigFive): number {
  return Math.min(1, Math.max(0, 0.3 * b.O + 0.3 * b.E + 0.4 * (1 - b.C)));
}

/** Resilience to mood shocks (grief, stress). */
export function resilience(b: BigFive): number {
  return Math.min(1, Math.max(0, 0.5 * (1 - b.N) + 0.3 * b.C + 0.2 * b.E));
}

/** Attraction / compatibility of two profiles: similarity on C and O, complementarity on E, both high A helps. */
export function compatibility(a: BigFive, b: BigFive): number {
  const sim = 1 - (Math.abs(a.C - b.C) + Math.abs(a.O - b.O)) / 2;
  const warmth = (a.A + b.A) / 2;
  const calm = 1 - (a.N + b.N) / 2;
  return Math.min(1, Math.max(0, 0.45 * sim + 0.35 * warmth + 0.2 * calm));
}

// ─── Names (South African, mixed heritage, Christian community) ────────────

/**
 * The founding families' surnames: Nguni, Sotho and Tsonga families, Afrikaner and English, Indian (the
 * Tamil and Telugu families of the coast), Coloured. See heritage.ts for each name's people.
 */
const SURNAMES = [
  'Mokoena', 'Dlamini', 'Nkosi', 'Van der Merwe', 'Botha', 'Sithole', 'Khumalo', 'Molefe', 'Naidoo', 'Petersen',
  'Mahlangu', 'Smith', 'Mthembu', 'Ndlovu', 'Pretorius', 'Le Roux', 'Maluleke', 'Zulu', 'Modise', 'Jacobs',
  'Mabaso', 'Sibiya', 'Coetzee', 'Adams', 'Mokwena', 'Radebe', 'Pillay', 'Mnguni', 'Mashaba', 'Fourie',
  'Govender', 'Moodley', 'Reddy', 'Williams',
];

/** A first name of the family's own people (their surname's heritage), not one already in the household. */
export function pickFirstName(rng: Rng, sex: Sex, avoid: Set<string>, surname = ''): string {
  const pool = FIRST_NAMES[heritageOf(surname)][sex];
  for (let i = 0; i < 12; i++) {
    const n = rng.pick(pool);
    if (!avoid.has(n)) return n;
  }
  return `${rng.pick(pool)} ${rng.pick(['Jr', 'II', 'III'])}`;
}

export function pickSurname(rng: Rng, avoid: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const s = rng.pick(SURNAMES);
    if (!avoid.has(s)) return s;
  }
  return rng.pick(SURNAMES);
}
