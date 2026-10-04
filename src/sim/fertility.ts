// Fertility basis: age-specific fertility rates (ASFR) by 5-year band,
// scaled to a target total fertility rate, converted to a monthly conception
// hazard and modified by partnership, post-partum non-susceptibility, parity
// and education.
//
// Shape: a South African ASFR profile (per 1,000 women) with the
// characteristic 20-29 plateau, scaled to the Stats SA 2024 TFR of 2.41
// (P0302 2024, Table 2). The shape is a proxy pending the Census 2022 ASFR
// release; the LEVEL is the published TFR. Realised TFR is reported back in
// the analytics so the user can see how the community's partnership mix
// bends the outcome away from the input basis.

export interface AsfrBand {
  band: string;
  lo: number;
  hi: number;
  /** Births per woman per year in the band. */
  rate: number;
}

export const ASFR_SHAPE_SA: AsfrBand[] = [
  { band: '15-19', lo: 15, hi: 20, rate: 0.06 },
  { band: '20-24', lo: 20, hi: 25, rate: 0.12 },
  { band: '25-29', lo: 25, hi: 30, rate: 0.118 },
  { band: '30-34', lo: 30, hi: 35, rate: 0.088 },
  { band: '35-39', lo: 35, hi: 40, rate: 0.05 },
  { band: '40-44', lo: 40, hi: 45, rate: 0.015 },
  { band: '45-49', lo: 45, hi: 50, rate: 0.003 },
];

/** A later, narrower profile typical of low-fertility developed populations. */
export const ASFR_SHAPE_LATE: AsfrBand[] = [
  { band: '15-19', lo: 15, hi: 20, rate: 0.01 },
  { band: '20-24', lo: 20, hi: 25, rate: 0.045 },
  { band: '25-29', lo: 25, hi: 30, rate: 0.09 },
  { band: '30-34', lo: 30, hi: 35, rate: 0.105 },
  { band: '35-39', lo: 35, hi: 40, rate: 0.06 },
  { band: '40-44', lo: 40, hi: 45, rate: 0.013 },
  { band: '45-49', lo: 45, hi: 50, rate: 0.001 },
];

export function tfrOf(shape: AsfrBand[]): number {
  return shape.reduce((s, b) => s + b.rate * (b.hi - b.lo), 0);
}

/** Scale a shape so that its TFR equals the target. */
export function scaledAsfr(shape: AsfrBand[], targetTfr: number): AsfrBand[] {
  const k = targetTfr / Math.max(1e-9, tfrOf(shape));
  return shape.map((b) => ({ ...b, rate: b.rate * k }));
}

export function asfrAt(shape: AsfrBand[], age: number): number {
  for (const b of shape) if (age >= b.lo && age < b.hi) return b.rate;
  return 0;
}

export function asfrBandFor(age: number): string | null {
  for (const b of ASFR_SHAPE_SA) if (age >= b.lo && age < b.hi) return b.band;
  return null;
}

export interface ConceptionContext {
  age: number;
  marital: 'single' | 'courting' | 'engaged' | 'married' | 'divorced' | 'widowed';
  hasPartner: boolean;
  monthsSinceLastBirth: number | null;
  parity: number;
  tertiary: boolean;
  /** 0..1 */
  vitality: number;
  contraceptionShare: number;
}

/**
 * Monthly conception probability. The ASFR is a population rate; the
 * multipliers redistribute it across partnership states (married women bear
 * most children in a church community) and are normalised so a "typical"
 * mix of 50% married / 15% courting / 35% single reproduces the input level.
 */
export function monthlyConceptionProb(shape: AsfrBand[], c: ConceptionContext): number {
  const annual = asfrAt(shape, c.age);
  if (annual <= 0) return 0;
  // Stats SA recorded live births 2023: ~60% of births are to unmarried
  // mothers, so single women's fertility cannot be a small residual even in a
  // church community. Normalised over a 50 / 15 / 35 married / courting /
  // single mix.
  // Divided by 1.35 to offset the months a woman is not susceptible (pregnant,
  // post-partum) and partner absence, which the per-woman-year ASFR averages
  // over; calibrated so pooled births A/E ≈ 1 (docs/ASSUMPTIONS.md).
  const norm = (0.5 * 1.4 + 0.15 * 1.0 + 0.35 * 0.6) / 1.35; // = 0.785
  let mult: number;
  if (c.marital === 'married') mult = 1.4;
  else if (c.marital === 'engaged' || c.marital === 'courting') mult = 1.0;
  else mult = 0.6;
  mult /= norm;
  if (c.monthsSinceLastBirth !== null && c.monthsSinceLastBirth < 9) mult *= 0.2;
  if (c.parity >= 4) mult *= 0.5;
  if (c.parity >= 6) mult *= 0.3;
  if (c.tertiary) mult *= 0.85;
  mult *= 0.6 + 0.4 * c.vitality;
  // Contraception share shifts the whole level down; the default is folded into the ASFR level already.
  mult *= 1 - 0.5 * c.contraceptionShare;
  const annualAdj = Math.min(0.95, annual * mult);
  return 1 - Math.pow(1 - annualAdj, 1 / 12);
}

/** Gestation in days from conception to birth (mean 266, sd 9). */
export function gestationDays(normal: () => number): number {
  return Math.round(Math.min(295, Math.max(224, 266 + 9 * normal())));
}

export const TWIN_PROBABILITY = 0.016;
/** Maternal deaths per live birth (SA MMR ≈ 100-120 per 100,000). */
export const MATERNAL_MORTALITY = 0.0011;
/** Stillbirth rate per birth (SA ≈ 2%). */
export const STILLBIRTH_RATE = 0.02;
