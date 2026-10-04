// Projections on the basis: a cohort-component projection of the province's
// people (the table with its improvement drift, the ASFR schedule, the youth
// emigration hazard), a defined-contribution retirement projection for one
// worker (the two-pot split, the annuity bought at retirement, the replacement
// ratio) and the actuarial present value of the state's old-age grant to the
// people alive today — the province's implicit social-security liability.

import type { AsfrBand } from '../fertility';
import { asfrAt } from '../fertility';
import { MAX_AGE, improvedQx, lifeExpectancy, type QxTable } from '../mortality';
import type { Sex } from '../types';
import { realRate, savingsPath } from './interest';
import { commutation, epv } from './life';

export interface AgeSexCounts {
  M: number[];
  F: number[];
}

export function countsFromPeople(people: Array<{ age: number; sex: Sex }>): AgeSexCounts {
  const M = new Array<number>(MAX_AGE + 1).fill(0);
  const F = new Array<number>(MAX_AGE + 1).fill(0);
  for (const p of people) {
    const a = Math.max(0, Math.min(MAX_AGE, Math.floor(p.age)));
    if (p.sex === 'M') M[a]++;
    else F[a]++;
  }
  return { M, F };
}

export interface ProjectionYear {
  /** Years from now (0 = today). */
  t: number;
  total: number;
  children: number;
  working: number;
  elderly: number;
  births: number;
  deaths: number;
  emigrants: number;
  /** (children + elderly) / working. */
  dependency: number;
  e0M: number;
  e0F: number;
}

export interface ProjectionOpts {
  /** Years since the scenario started (the improvement already in the table today). */
  yearsElapsed: number;
  improvement: number;
  asfr: AsfrBand[];
  maleShareAtBirth: number;
  /** Annual hazard of leaving for those aged 18–30 (study, work elsewhere); nobody arrives. */
  youthEmigrationHazard: number;
  workingAge: [number, number];
  years: number;
}

/**
 * Cohort-component projection: each year the living age a year with the
 * improved table's survival, women bear children at the schedule's rates and
 * the newborn survive the infant year; the young leave at the emigration
 * hazard; nobody comes in (the layouts decide re-lets, not the basis).
 */
export function projectPopulation(start: AgeSexCounts, qx: QxTable, o: ProjectionOpts): { years: ProjectionYear[]; end: AgeSexCounts } {
  let M = start.M.slice();
  let F = start.F.slice();
  const years: ProjectionYear[] = [];
  const [wLo, wHi] = o.workingAge;
  const summarise = (t: number, births: number, deaths: number, emigrants: number, qM: number[], qF: number[]): ProjectionYear => {
    let children = 0;
    let working = 0;
    let elderly = 0;
    for (let x = 0; x <= MAX_AGE; x++) {
      const n = M[x] + F[x];
      if (x < wLo) children += n;
      else if (x < wHi) working += n;
      else elderly += n;
    }
    return { t, total: children + working + elderly, children, working, elderly, births, deaths, emigrants, dependency: working > 0 ? (children + elderly) / working : 0, e0M: lifeExpectancy(qM), e0F: lifeExpectancy(qF) };
  };
  const tableAt = (t: number) => ({
    M: qx.M.map((q, x) => (x === MAX_AGE ? 1 : improvedQx(q, o.improvement, o.yearsElapsed + t))),
    F: qx.F.map((q, x) => (x === MAX_AGE ? 1 : improvedQx(q, o.improvement, o.yearsElapsed + t))),
  });
  const t0 = tableAt(0);
  years.push(summarise(0, 0, 0, 0, t0.M, t0.F));
  for (let t = 1; t <= o.years; t++) {
    const q = tableAt(t - 1);
    let births = 0;
    let deaths = 0;
    let emigrants = 0;
    for (let x = 15; x < 50; x++) births += F[x] * asfrAt(o.asfr, x);
    const nM = new Array<number>(MAX_AGE + 1).fill(0);
    const nF = new Array<number>(MAX_AGE + 1).fill(0);
    for (let x = 0; x < MAX_AGE; x++) {
      const leave = x >= 18 && x <= 30 ? o.youthEmigrationHazard : 0;
      const dM = M[x] * q.M[x];
      const dF = F[x] * q.F[x];
      deaths += dM + dF;
      const eM = (M[x] - dM) * leave;
      const eF = (F[x] - dF) * leave;
      emigrants += eM + eF;
      nM[x + 1] += M[x] - dM - eM;
      nF[x + 1] += F[x] - dF - eF;
    }
    // The open interval at the top of the table closes: everyone at MAX_AGE dies within the year.
    deaths += M[MAX_AGE] + F[MAX_AGE];
    const bM = births * o.maleShareAtBirth;
    const bF = births - bM;
    const infM = bM * q.M[0];
    const infF = bF * q.F[0];
    deaths += infM + infF;
    nM[0] = bM - infM;
    nF[0] = bF - infF;
    M = nM;
    F = nF;
    const tb = tableAt(t);
    years.push(summarise(t, births, deaths, emigrants, tb.M, tb.F));
  }
  return { years, end: { M, F } };
}

/** Five-year bands of an age-sex count, for a pyramid. */
export function bands(c: AgeSexCounts): { bands: string[]; male: number[]; female: number[] } {
  const labels: string[] = [];
  const male: number[] = [];
  const female: number[] = [];
  for (let lo = 0; lo < 80; lo += 5) {
    labels.push(`${lo}-${lo + 4}`);
    let m = 0;
    let f = 0;
    for (let x = lo; x < lo + 5; x++) {
      m += c.M[x];
      f += c.F[x];
    }
    male.push(m);
    female.push(f);
  }
  labels.push('80+');
  male.push(c.M.slice(80).reduce((s, v) => s + v, 0));
  female.push(c.F.slice(80).reduce((s, v) => s + v, 0));
  return { bands: labels, male, female };
}

export interface RetirementOpts {
  age: number;
  /** Monthly salary now. */
  salary: number;
  /** Share of salary contributed (employee and employer together). */
  contribution: number;
  /** Salary growth a year (inflation plus real growth). */
  salaryGrowth: number;
  /** Investment return a year on the fund. */
  returnRate: number;
  inflation: number;
  retirementAge: number;
  /** The valuation rate the annuity is priced at (a level pension) and the table for the annuitant. */
  i: number;
  qx: number[];
  /** Share of each contribution going to the savings component (the two-pot system: one third). */
  savingsShare: number;
}

export interface RetirementProjection {
  years: number;
  path: Array<{ age: number; salary: number; contribution: number; fund: number; real: number }>;
  fundAtRetirement: number;
  fundReal: number;
  finalSalary: number;
  /** ä⁽¹²⁾ at the retirement age at i (a level pension) and at the real rate (a pension rising with prices). */
  annuityFactor: number;
  annuityFactorReal: number;
  savingsComponent: number;
  retirementComponent: number;
  /** Monthly pensions bought with the retirement component: level, and inflation-linked. */
  pensionLevel: number;
  pensionReal: number;
  /** ...and with the whole fund annuitised. */
  pensionLevelAll: number;
  replacementLevel: number;
  replacementReal: number;
  replacementLevelAll: number;
  contributionsPaid: number;
}

export function retirementProjection(o: RetirementOpts): RetirementProjection {
  const years = Math.max(0, o.retirementAge - o.age);
  const yearly = o.salary * 12 * o.contribution;
  const sp = savingsPath(yearly, o.salaryGrowth, o.returnRate, years);
  const path = sp.map((r) => ({ age: o.age + r.year, salary: (o.salary * 12 * Math.pow(1 + o.salaryGrowth, r.year - 1)) / 12, contribution: r.contribution, fund: r.fund, real: r.fund / Math.pow(1 + o.inflation, r.year) }));
  const fund = sp.length ? sp[sp.length - 1].fund : 0;
  const finalSalary = o.salary * Math.pow(1 + o.salaryGrowth, Math.max(0, years - 1));
  const cm = commutation(o.qx, o.i);
  const cmReal = commutation(o.qx, Math.max(-0.5, realRate(o.i, o.inflation)));
  const R = Math.min(MAX_AGE - 1, o.retirementAge);
  const a12 = Math.max(1, epv(cm, R, 1).ax12Due);
  const a12Real = Math.max(1, epv(cmReal, R, 1).ax12Due);
  const savings = fund * o.savingsShare;
  const retirement = fund - savings;
  const pensionLevel = retirement / (12 * a12);
  const pensionReal = retirement / (12 * a12Real);
  const pensionLevelAll = fund / (12 * a12);
  return {
    years,
    path,
    fundAtRetirement: fund,
    fundReal: fund / Math.pow(1 + o.inflation, years),
    finalSalary,
    annuityFactor: a12,
    annuityFactorReal: a12Real,
    savingsComponent: savings,
    retirementComponent: retirement,
    pensionLevel,
    pensionReal,
    pensionLevelAll,
    replacementLevel: finalSalary > 0 ? pensionLevel / finalSalary : 0,
    replacementReal: finalSalary > 0 ? pensionReal / finalSalary : 0,
    replacementLevelAll: finalSalary > 0 ? pensionLevelAll / finalSalary : 0,
    contributionsPaid: sp.reduce((s, r) => s + r.contribution, 0),
  };
}

export interface GrantLiability {
  /** The actuarial present value of the old-age grant to everyone alive today, in today's rand. */
  pv: number;
  /** ...of which for those already drawing it, and for those who will. */
  pvCurrent: number;
  pvDeferred: number;
  recipients: number;
  /** The grant bill this year (12 × the grant × recipients). */
  annual: number;
  realRate: number;
  byBand: Array<{ band: string; n: number; pv: number }>;
}

/**
 * The province's implicit pension liability: the grant is indexed to prices,
 * so each person's entitlement is valued at the real rate — 12G·ä⁽¹²⁾ₓ for
 * those past the grant age and 12G·ₙEₓ·ä⁽¹²⁾₆₀ (n years deferred) for the rest,
 * on the improved table.
 */
export function grantLiability(people: Array<{ age: number; sex: Sex }>, qx: QxTable, improvement: number, yearsElapsed: number, i: number, inflation: number, grantMonthly: number, grantAge = 60): GrantLiability {
  const r = Math.max(-0.5, realRate(i, inflation));
  const table = (sex: Sex) => (sex === 'M' ? qx.M : qx.F).map((q, x) => (x === MAX_AGE ? 1 : improvedQx(q, improvement, yearsElapsed)));
  const cm = { M: commutation(table('M'), r), F: commutation(table('F'), r) };
  const bandsDef: Array<[string, number, number]> = [['under 30', 0, 30], ['30-44', 30, 45], ['45-59', 45, 60], ['60-74', 60, 75], ['75+', 75, 200]];
  const byBand = bandsDef.map(([band]) => ({ band, n: 0, pv: 0 }));
  let pvCurrent = 0;
  let pvDeferred = 0;
  let recipients = 0;
  for (const p of people) {
    const x = Math.max(0, Math.min(MAX_AGE - 1, Math.floor(p.age)));
    const c = cm[p.sex];
    let v: number;
    if (x >= grantAge) {
      v = 12 * grantMonthly * epv(c, x, 1).ax12Due;
      pvCurrent += v;
      recipients++;
    } else {
      const n = grantAge - x;
      v = 12 * grantMonthly * epv(c, x, n).nEx * epv(c, grantAge, 1).ax12Due;
      pvDeferred += v;
    }
    const b = byBand[bandsDef.findIndex(([, lo, hi]) => x >= lo && x < hi)];
    if (b) {
      b.n++;
      b.pv += v;
    }
  }
  return { pv: pvCurrent + pvDeferred, pvCurrent, pvDeferred, recipients, annual: 12 * grantMonthly * recipients, realRate: r, byBand };
}
