// Health: a catalogue of illnesses with seasonal, age- and condition-
// dependent incidence; episode progression with treatment at the clinic,
// hospital admission and case fatality; chronic condition onset; and the
// vitality index that feeds mortality multipliers.
//
// Incidence numbers are annual attack rates from WHO / NICD surveillance
// (influenza-like illness 5–15% of adults, higher in children), SA TB
// incidence (~0.6% adults, WHO Global TB Report 2024), and GBD-style
// age-doubling for cardiovascular events and cancer. See docs/ASSUMPTIONS.md.

import type { Ctx } from './ctx';
import { otherChannelScale } from './shocks';
import { alivePeople, clamp, fullName, householdMembers } from './ctx';
import { CONDITIONS, JOBS, baseVitality, communityOfPerson, conditionPrevalence } from './population';
import { goNow } from './movement';
import type { ConditionId, Illness, IllnessKind, Person } from './types';
import type { Season } from './time';
import { CENTRAL_HOSPITAL, CLINIC_IDS, cityOf, landmark } from './world';

/** Beds in a city clinic's ward, and at the central hospital. */
const CLINIC_BEDS = 6;
const HOSPITAL_BEDS = 24;
/** Conditions a city clinic refers to the central hospital: theatre cases and the specialist wards. */
const REFERRED = new Set<IllnessKind>(['heart', 'stroke', 'cancer', 'fracture']);

export interface IllnessSpec {
  kind: IllnessKind;
  /** Cause-of-death label (no article). */
  name: string;
  /** How the event reads: "<Name> <phrase>". */
  phrase: string;
  /** Annual incidence before modifiers. */
  annual(age: number, season: Season, p: Person, ctx: Ctx): number;
  durationMean: number;
  durationSd: number;
  severityMean: number;
  severitySd: number;
  contagious: boolean;
  /** Severity above which the person is admitted to the ward. */
  admitAt: number;
  /** Daily fatality at severity 1, untreated. */
  dailyFatality: number;
  /** Leaves a chronic condition on recovery. */
  leaves?: ConditionId;
}

const seasonW = (season: Season, w: Record<Season, number>) => w[season];
const ageDouble = (age: number, base: number, from = 40) => (age < from ? base * 0.15 : base * Math.pow(2, (age - from) / 10));
const hasHiv = (p: Person) => p.health.conditions.includes('hiv-untreated') || p.health.conditions.includes('hiv-on-art');
const hivUntreated = (p: Person) => p.health.conditions.includes('hiv-untreated');

export const ILLNESSES: IllnessSpec[] = [
  {
    kind: 'flu',
    name: 'influenza',
    phrase: 'has influenza',
    annual: (age, season, p, ctx) => ctx.params.fluAttackRate * seasonW(season, { winter: 2.2, autumn: 0.8, spring: 0.8, summer: 0.2 }) * (age < 13 ? 1.6 : age >= 65 ? 1.2 : 1),
    durationMean: 7,
    durationSd: 2,
    severityMean: 0.3,
    severitySd: 0.12,
    contagious: true,
    admitAt: 0.75,
    dailyFatality: 0.0018,
  },
  {
    kind: 'cold',
    name: 'common cold',
    phrase: 'has a cold',
    annual: (age, season) => 1.6 * seasonW(season, { winter: 1.4, autumn: 1.1, spring: 1.0, summer: 0.5 }) * (age < 13 ? 1.5 : 1),
    durationMean: 4,
    durationSd: 1,
    severityMean: 0.12,
    severitySd: 0.05,
    contagious: true,
    admitAt: 2,
    dailyFatality: 0,
  },
  {
    kind: 'gastro',
    name: 'gastroenteritis',
    phrase: 'has gastroenteritis',
    annual: (age, season, p, ctx) => (ctx.params.healthProfile === 'developed' ? 0.15 : 0.35) * seasonW(season, { summer: 1.6, autumn: 1.0, winter: 0.6, spring: 0.8 }) * (age < 5 ? 2.2 : 1),
    durationMean: 3,
    durationSd: 1,
    severityMean: 0.3,
    severitySd: 0.15,
    contagious: true,
    admitAt: 0.7,
    dailyFatality: 0.0015,
  },
  {
    kind: 'pneumonia',
    name: 'pneumonia',
    phrase: 'has pneumonia',
    annual: (age, season, p) => (age < 5 ? 0.04 : age >= 65 ? 0.05 : 0.012) * seasonW(season, { winter: 1.8, autumn: 1.0, spring: 0.9, summer: 0.5 }) * (hivUntreated(p) ? 4 : hasHiv(p) ? 1.6 : 1) * (p.health.illnesses.some((i) => i.kind === 'flu') ? 3 : 1),
    durationMean: 14,
    durationSd: 4,
    severityMean: 0.65,
    severitySd: 0.15,
    contagious: false,
    admitAt: 0.6,
    dailyFatality: 0.006,
  },
  {
    kind: 'tb',
    name: 'tuberculosis',
    phrase: 'has been diagnosed with tuberculosis',
    annual: (age, season, p, ctx) => (ctx.params.healthProfile === 'developed' ? 0.0001 : age < 15 ? 0.001 : 0.006) * (hivUntreated(p) ? 8 : hasHiv(p) ? 3 : 1) * (ctx.world.households[p.householdId]?.poor ? 1.6 : 1),
    durationMean: 180,
    durationSd: 30,
    severityMean: 0.5,
    severitySd: 0.12,
    contagious: true,
    admitAt: 0.7,
    dailyFatality: 0.0004,
  },
  {
    kind: 'heart',
    name: 'heart attack',
    phrase: 'has had a heart attack',
    annual: (age, season, p) => ageDouble(age, 0.0045) * (p.health.conditions.includes('hypertension') ? 1.8 : 1) * (p.health.conditions.includes('cvd') ? 2.2 : 1) * (p.health.conditions.includes('diabetes') ? 1.6 : 1) * (p.sex === 'M' ? 1.3 : 0.8),
    durationMean: 10,
    durationSd: 3,
    severityMean: 0.85,
    severitySd: 0.1,
    contagious: false,
    admitAt: 0.5,
    dailyFatality: 0.014,
    leaves: 'cvd',
  },
  {
    kind: 'stroke',
    name: 'stroke',
    phrase: 'has had a stroke',
    annual: (age, season, p) => ageDouble(age, 0.003) * (p.health.conditions.includes('hypertension') ? 2.5 : 1),
    durationMean: 30,
    durationSd: 8,
    severityMean: 0.8,
    severitySd: 0.12,
    contagious: false,
    admitAt: 0.5,
    dailyFatality: 0.005,
    leaves: 'disability',
  },
  {
    kind: 'cancer',
    name: 'cancer',
    phrase: 'has been diagnosed with cancer',
    annual: (age) => ageDouble(age, 0.002, 45),
    durationMean: 400,
    durationSd: 120,
    severityMean: 0.55,
    severitySd: 0.15,
    contagious: false,
    admitAt: 0.8,
    dailyFatality: 0.00045,
  },
  {
    kind: 'childhood',
    name: 'childhood infection',
    phrase: 'has a childhood infection',
    annual: (age, season, p, ctx) => (age < 5 ? (ctx.params.healthProfile === 'developed' ? 0.15 : 0.35) : age < 12 ? 0.08 : 0) * seasonW(season, { winter: 1.3, autumn: 1, spring: 1, summer: 0.8 }),
    durationMean: 6,
    durationSd: 2,
    severityMean: 0.35,
    severitySd: 0.15,
    contagious: true,
    admitAt: 0.7,
    dailyFatality: 0.002,
  },
  {
    kind: 'injury',
    name: 'injury',
    phrase: 'has been injured',
    annual: (age, season, p) => (JOBS[p.job]?.injuryHazard ?? 0.01) + (age >= 5 && age < 18 ? 0.05 : 0.015),
    durationMean: 12,
    durationSd: 5,
    severityMean: 0.35,
    severitySd: 0.18,
    contagious: false,
    admitAt: 0.7,
    dailyFatality: 0.001,
  },
  {
    kind: 'fracture',
    name: 'fracture (fall)',
    phrase: 'fell and broke a bone',
    annual: (age) => (age >= 75 ? 0.06 : age >= 65 ? 0.025 : 0.004),
    durationMean: 45,
    durationSd: 10,
    severityMean: 0.5,
    severitySd: 0.12,
    contagious: false,
    admitAt: 0.55,
    dailyFatality: 0.0012,
  },
  {
    kind: 'pregnancy-complication',
    name: 'postnatal complications',
    phrase: 'has complications after the birth',
    annual: () => 0, // triggered by the birth event only
    durationMean: 10,
    durationSd: 3,
    severityMean: 0.55,
    severitySd: 0.15,
    contagious: false,
    admitAt: 0.55,
    dailyFatality: 0.004,
  },
  {
    kind: 'covid',
    name: 'respiratory virus',
    phrase: 'has a respiratory virus',
    annual: (age, season) => 0.06 * seasonW(season, { winter: 1.5, autumn: 1, spring: 0.9, summer: 0.6 }),
    durationMean: 8,
    durationSd: 3,
    severityMean: 0.25,
    severitySd: 0.15,
    contagious: true,
    admitAt: 0.75,
    dailyFatality: 0.002,
  },
];

const SPEC_BY_KIND: Record<string, IllnessSpec> = Object.fromEntries(ILLNESSES.map((s) => [s.kind, s]));

/** Global scale on illness case-fatality, calibrated with the baseline normaliser so pooled A/E ≈ 1 (docs/ASSUMPTIONS.md). */
export const ILLNESS_FATALITY_SCALE = Number((typeof process !== 'undefined' && process.env?.COMMUNITY_ILLNESS_SCALE) || 0.78);

export function makeIllness(ctx: Ctx, p: Person, spec: IllnessSpec, severityBoost = 0): Illness {
  const rng = ctx.rng.stream('health');
  const ageSev = p.age < 2 || p.age >= 70 ? 0.15 : 0;
  const condSev = (p.health.conditions.length ? 0.05 * p.health.conditions.length : 0) + (hivUntreated(p) ? 0.15 : 0);
  const severity = clamp(rng.normal(spec.severityMean + ageSev + condSev + severityBoost, spec.severitySd), 0.05, 1);
  const durationDays = Math.max(1, Math.round(rng.normal(spec.durationMean, spec.durationSd) * (0.7 + 0.6 * severity)));
  return {
    id: ctx.nextId('illness'),
    kind: spec.kind,
    name: spec.name,
    onsetDay: ctx.world.day,
    durationDays,
    severity,
    contagious: spec.contagious,
    treated: false,
    hospitalised: false,
    dailyFatality: ILLNESS_FATALITY_SCALE * spec.dailyFatality * Math.pow(severity, 1.5) * (1 - 0.6 * p.health.vitality),
  };
}

export function fallIll(ctx: Ctx, p: Person, kind: IllnessKind, severityBoost = 0, note?: string): Illness {
  const spec = SPEC_BY_KIND[kind];
  const ill = makeIllness(ctx, p, spec, severityBoost);
  p.health.illnesses.push(ill);
  p.health.state = kind === 'injury' || kind === 'fracture' ? 'injured' : ill.severity > 0.75 ? 'critical' : 'ill';
  p.mood = clamp(p.mood - 0.25 * ill.severity, -1, 1);
  ctx.world.stats.illnesses++;
  ctx.world.stats.illnessByKind[kind] = (ctx.world.stats.illnessByKind[kind] ?? 0) + 1;
  ctx.world.stats.illnessByMonth[ctx.cal.month - 1]++;
  if (ill.severity >= 0.3 || kind === 'tb' || kind === 'cancer') {
    ctx.emit({ kind: 'illness', severity: ill.severity > 0.6 ? 'alert' : 'info', text: `${fullName(p)} (${p.age}) ${spec.phrase}${note ? ` — ${note}` : ''}.`, personIds: [p.id], householdId: p.householdId });
  }
  p.history.push({ day: ctx.world.day, kind: 'illness', text: `Fell ill with ${spec.name} (severity ${(ill.severity * 100).toFixed(0)}%).` });
  return ill;
}

const CONDITION_MULT: Record<ConditionId, number> = { 'hiv-untreated': 4.5, 'hiv-on-art': 1.4, cvd: 1.4, diabetes: 1.3, hypertension: 1.15, copd: 1.3, disability: 1.2, asthma: 1.0 };

const expectedCache = new Map<string, number>();

/**
 * Population-average relative mortality at an age and sex under the health
 * profile: E[Π condition multipliers] (independence) × the mean vitality term.
 * The assumed table already embeds average prevalence, so individual
 * multipliers are divided by this — they redistribute risk WITHIN an age
 * without moving the age average, which keeps A/E flat by age band.
 */
export function expectedMultiplier(ctx: Ctx, age: number, sex: Person['sex']): number {
  const a = Math.min(age, 100);
  const key = `${ctx.params.healthProfile}-${ctx.params.hivEnabled ? 1 : 0}-${sex}-${a}`;
  const hit = expectedCache.get(key);
  if (hit !== undefined) return hit;
  let m = 1;
  for (const c of CONDITIONS) m *= 1 + conditionPrevalence(c, a, sex, ctx.params.healthProfile, ctx.params.hivEnabled) * (CONDITION_MULT[c] - 1);
  const vbar = clamp(0.92 - Math.max(0, age - 40) * 0.006, 0.2, 0.98);
  m *= 1.6 - 0.8 * vbar;
  expectedCache.set(key, m);
  return m;
}

/** Relative mortality from conditions, vitality and circumstances (RAW — demography.ts normalises it within the age band). */
export function mortalityMultiplier(ctx: Ctx, p: Person): number {
  let m = 1;
  for (const c of p.health.conditions) m *= CONDITION_MULT[c] ?? 1;
  m *= 1.6 - 0.8 * p.health.vitality;
  if (p.grief) m *= 1 + (ctx.params.bereavementMultiplier - 1) * p.grief.intensity;
  if (ctx.world.households[p.householdId]?.poor) m *= ctx.params.povertyMortalityMultiplier;
  return m;
}

export function healthDayStep(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('health');
  const season = world.weather.season;
  const present = (id: string | null | undefined) => !!id && !!world.people[id] && !world.people[id].away;
  // Each city's clinic has its own doctor, nurses and district medical
  // officer; the central hospital's surgeons cover a referral from anywhere.
  const staff = new Map<string, { doctor: boolean; nurse: boolean }>();
  for (const id of CLINIC_IDS) {
    const city = cityOf(world.buildings[id]?.community);
    const doctor = present(world.roles.doctorByClinic[id]) || (id !== CENTRAL_HOSPITAL && present(world.roles.dmoByCity[city])) || (id === CENTRAL_HOSPITAL && world.roles.surgeonIds.some(present));
    const nurse = world.roles.nurseIds.some((nid) => present(nid) && world.people[nid].workplaceId === id);
    staff.set(id, { doctor, nurse });
  }
  const careAt = (id: string) => {
    const s = staff.get(id) ?? { doctor: false, nurse: false };
    return ctx.params.careQuality * (s.doctor ? 1 : s.nurse ? 0.7 : 0.25) * (id === CENTRAL_HOSPITAL ? 1.25 : 1);
  };
  const inWard: Record<string, number> = {};
  for (const p of alivePeople(world)) if (p.health.hospitalDaysLeft > 0) inWard[p.health.hospitalId ?? 'clinic'] = (inWard[p.health.hospitalId ?? 'clinic'] ?? 0) + 1;
  const bedsAt = (id: string) => (id === CENTRAL_HOSPITAL ? HOSPITAL_BEDS : CLINIC_BEDS);
  const heat = world.weather.condition === 'heatwave';
  const cold = world.weather.condition === 'cold-snap';

  for (const p of alivePeople(world)) {
    if (p.away) continue;
    const H = p.health;
    const clinicId = landmark(communityOfPerson(world, p), 'clinic');
    const clinicStaff = staff.get(clinicId) ?? { doctor: false, nurse: false };
    const care = careAt(clinicId);
    // ── Progress active illnesses ──
    for (const ill of [...H.illnesses]) {
      const daysIn = world.day - ill.onsetDay;
      // Care-seeking: severity, doctor availability, medical aid / poverty
      if (!ill.treated && ill.severity >= 0.28 && daysIn >= 1) {
        const hh = world.households[p.householdId];
        const pSeek = (0.55 + 0.4 * ill.severity) * (hh?.insurance.medical ? 1.15 : 1) * (hh?.poor ? 0.75 : 1) * (clinicStaff.doctor || clinicStaff.nurse ? 1 : 0.3);
        if (rng.bernoulli(clamp(pSeek, 0, 0.98))) {
          ill.treated = true;
          H.lastClinicDay = world.day;
          world.stats.clinicVisits++;
          ill.durationDays = Math.max(1, Math.round(ill.durationDays * (1 - 0.35 * care)));
          ill.dailyFatality *= 1 - 0.8 * care;
        }
      }
      if (!ill.hospitalised && ill.treated && ill.severity >= SPEC_BY_KIND[ill.kind].admitAt && H.hospitalDaysLeft === 0) {
        // Theatre cases and the gravest illnesses go to the central hospital;
        // the rest to the city clinic's ward, or on to the hospital when the
        // ward is full. Nowhere with a bed, and they are nursed at home.
        const referral = REFERRED.has(ill.kind) || ill.severity >= 0.8 || (ill.kind === 'injury' && ill.severity >= 0.6);
        const hospitalFree = (inWard[CENTRAL_HOSPITAL] ?? 0) < HOSPITAL_BEDS;
        const clinicFree = (inWard[clinicId] ?? 0) < bedsAt(clinicId);
        const to = referral && hospitalFree ? CENTRAL_HOSPITAL : clinicFree ? clinicId : hospitalFree ? CENTRAL_HOSPITAL : null;
        if (to) {
          ill.hospitalised = true;
          inWard[to] = (inWard[to] ?? 0) + 1;
          H.hospitalId = to;
          H.admittedDay = world.day;
          H.hospitalDaysLeft = Math.max(2, Math.round(3 + 10 * ill.severity));
          H.admissions++;
          world.stats.hospitalisations++;
          if (to === CENTRAL_HOSPITAL) {
            // Surgeons and specialists: the case-fatality falls further than a clinic ward manages.
            world.stats.surgeries++;
            ill.dailyFatality *= 1 - 0.5 * careAt(CENTRAL_HOSPITAL);
            const theatre = REFERRED.has(ill.kind) || ill.kind === 'injury';
            ctx.emit({ kind: 'hospital', severity: 'alert', text: `${fullName(p)} was referred to ${world.buildings[CENTRAL_HOSPITAL]?.name ?? 'the central hospital'} for ${theatre ? 'surgery' : 'specialist care'} (${ill.name}).`, personIds: [p.id], buildingId: CENTRAL_HOSPITAL });
            p.history.push({ day: world.day, kind: 'hospital', text: `Referred to the central hospital for ${theatre ? 'surgery' : 'specialist care'}: ${ill.name}.` });
          } else {
            ctx.emit({ kind: 'hospital', severity: 'alert', text: `${fullName(p)} admitted to the ${world.buildings[to]?.name ?? 'clinic'} ward (${ill.name}).`, personIds: [p.id], buildingId: to });
            p.history.push({ day: world.day, kind: 'hospital', text: `Admitted to the ward with ${ill.name}.` });
          }
        }
      }
      // Death from the illness
      // A supplied basis and a mortality shock scale illness deaths as they do the table's (shocks.ts).
      const dailyF = ill.dailyFatality * (heat && p.age >= 65 ? 1.5 : 1) * (cold && (p.age >= 70 || p.age < 2) ? 1.4 : 1) * otherChannelScale(ctx, p);
      if (dailyF > 0 && rng.bernoulli(dailyF)) {
        ctx.hooks.onDeath(p, ill.name, 'illness');
        break;
      }
      if (daysIn >= ill.durationDays) {
        H.illnesses = H.illnesses.filter((i) => i !== ill);
        const spec = SPEC_BY_KIND[ill.kind];
        if (spec.leaves && !H.conditions.includes(spec.leaves)) H.conditions.push(spec.leaves);
        H.vitality = clamp(H.vitality - 0.05 * ill.severity, 0.15, 1);
        if (ill.severity >= 0.45) ctx.emit({ kind: 'recovery', severity: 'joy', text: `${fullName(p)} has recovered from ${ill.name}.`, personIds: [p.id] });
        world.stats.recoveries++;
        p.history.push({ day: world.day, kind: 'recovery', text: `Recovered from ${ill.name}.` });
        p.mood = clamp(p.mood + 0.15, -1, 1);
      }
    }
    if (!p.alive) continue;
    if (H.hospitalDaysLeft > 0) {
      H.hospitalDaysLeft--;
      if (H.hospitalDaysLeft === 0) {
        for (const ill of H.illnesses) ill.hospitalised = false;
        H.restDaysLeft = 3;
        ctx.emit({ kind: 'discharge', severity: 'info', text: `${fullName(p)} discharged from ${H.hospitalId === CENTRAL_HOSPITAL ? 'the central hospital' : 'the ward'}.`, personIds: [p.id] });
        H.hospitalId = null;
      }
    } else if (H.restDaysLeft > 0) H.restDaysLeft--;
    H.state = H.illnesses.some((i) => i.severity > 0.75) ? 'critical' : H.illnesses.some((i) => i.kind === 'injury' || i.kind === 'fracture') ? 'injured' : H.illnesses.length ? 'ill' : H.restDaysLeft > 0 ? 'recovering' : 'healthy';

    // ── New onsets ──
    const members = householdMembers(world, p.householdId);
    for (const spec of ILLNESSES) {
      if (H.illnesses.some((i) => i.kind === spec.kind)) continue;
      let annual = spec.annual(p.age, season, p, ctx);
      if (annual <= 0) continue;
      if (spec.contagious && members.some((m) => m !== p && m.health.illnesses.some((i) => i.kind === spec.kind && i.contagious))) annual *= 5;
      if (spec.contagious && p.schooling === 'school' && (spec.kind === 'flu' || spec.kind === 'cold' || spec.kind === 'childhood')) annual *= 1.3;
      if (heat && (spec.kind === 'heart' || spec.kind === 'stroke') && p.age >= 60) annual *= 1.8;
      if (cold && (spec.kind === 'pneumonia' || spec.kind === 'flu')) annual *= 1.5;
      annual *= 1.4 - 0.6 * H.vitality;
      const daily = 1 - Math.pow(1 - Math.min(0.95, annual), 1 / 365.25);
      if (rng.bernoulli(daily)) fallIll(ctx, p, spec.kind);
    }
    // ── Chronic condition onset (incidence ≈ prevalence gradient) ──
    if (p.age >= 30 && !H.conditions.includes('hypertension') && rng.bernoulli((ctx.params.healthProfile === 'developed' ? 0.012 : 0.02) * (p.age >= 50 ? 1.6 : 1) / 365.25)) H.conditions.push('hypertension');
    if (p.age >= 30 && !H.conditions.includes('diabetes') && rng.bernoulli((ctx.params.healthProfile === 'developed' ? 0.004 : 0.007) * (p.age >= 45 ? 1.8 : 1) / 365.25)) H.conditions.push('diabetes');
    if (ctx.params.hivEnabled && ctx.params.healthProfile !== 'developed' && p.age >= 15 && p.age < 50 && !hasHiv(p)) {
      const base = p.marital === 'married' ? 0.0025 : 0.006;
      if (rng.bernoulli(base / 365.25)) {
        H.conditions.push('hiv-untreated');
        p.history.push({ day: world.day, kind: 'illness', text: 'Diagnosed HIV-positive.' });
      }
    }
    if (H.conditions.includes('hiv-untreated') && rng.bernoulli(0.4 / 365.25 * (clinicStaff.doctor ? 1.5 : 0.5))) {
      H.conditions = H.conditions.filter((c) => c !== 'hiv-untreated');
      H.conditions.push('hiv-on-art');
      p.history.push({ day: world.day, kind: 'recovery', text: 'Started antiretroviral treatment at the clinic.' });
    }
    // ── Vitality drift ──
    const target = baseVitality({ normal: () => 0 } as never, p.age, H.conditions);
    let v = H.vitality + (target - H.vitality) * 0.01;
    if (H.illnesses.length) v -= 0.004;
    if (p.grief) v -= 0.0015 * p.grief.intensity;
    if (world.households[p.householdId]?.poor) v -= 0.0008;
    H.vitality = clamp(v, 0.1, 1);
  }
}

/** Injure someone (fights, accidents, intruders). */
export function injure(ctx: Ctx, p: Person, severity: number, note: string): Illness {
  const ill = fallIll(ctx, p, 'injury', severity - 0.35, note);
  ill.severity = clamp(severity, 0.05, 1);
  ill.dailyFatality = SPEC_BY_KIND.injury.dailyFatality * Math.pow(ill.severity, 1.5) * 4;
  // A bad injury in the animated day: an ambulance takes them to the city clinic now.
  if (ctx.micro && ill.severity >= 0.5 && p.alive && !p.inVehicleId && p.health.hospitalDaysLeft === 0 && ctx.world.minuteOfDay > 0) {
    const clinic = landmark(communityOfPerson(ctx.world, p), 'clinic');
    goNow(ctx, p, clinic, 'clinic', 'taken to the clinic by ambulance', 120, undefined, { ambulance: true });
  }
  return ill;
}

export function isBedridden(p: Person): boolean {
  return p.health.hospitalDaysLeft > 0 || p.health.restDaysLeft > 0 || p.health.state === 'critical';
}
