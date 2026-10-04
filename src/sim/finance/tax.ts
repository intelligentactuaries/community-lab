// The SARS engine: personal income tax (PAYE and annual assessment), UIF,
// the skills development levy, VAT, company tax (standard, small business
// corporation and turnover tax), dividends tax, and the penalty and interest
// regime of the Tax Administration Act. Tables are the 2026/27 year of
// assessment as announced in Budget 2026 (brackets, rebates and thresholds
// raised 3.4%); later years are indexed by the community's own CPI so bracket
// creep is a scenario choice rather than an accident.
//
// Sources: SARS Budget 2026 FAQ and tax tables (1 March 2026 – 28 February
// 2027); Unemployment Insurance Contributions Act (1% + 1% to the R17,712
// monthly ceiling); Skills Development Levies Act (1% of payroll above
// R500,000 a year); VAT Act (15%, zero-rated basic foodstuffs, thresholds
// R2.3m compulsory / R120,000 voluntary from 1 April 2026); Income Tax Act
// s12E (small business corporations) and Sixth Schedule (turnover tax); Tax
// Administration Act ch. 15 and 16 (10% late-payment penalty, interest at the
// prescribed rate).

import { r2 } from './accounts';

export interface TaxBracket {
  /** Lower bound of the bracket (taxable income above this, per year). */
  from: number;
  /** Cumulative tax at the lower bound. */
  base: number;
  rate: number;
}

export interface TaxTables {
  yearLabel: string;
  brackets: TaxBracket[];
  primaryRebate: number;
  secondaryRebate: number;
  tertiaryRebate: number;
  /** Medical scheme fees tax credit per month: first two beneficiaries, each further one. */
  mtcFirstTwo: number;
  mtcAdditional: number;
  interestExemptionUnder65: number;
  interestExemption65Plus: number;
  uifRate: number;
  uifCeilingMonthly: number;
  sdlRate: number;
  sdlPayrollThreshold: number;
  vatRate: number;
  vatCompulsoryThreshold: number;
  vatVoluntaryThreshold: number;
  citRate: number;
  dividendsTaxRate: number;
  sbc: TaxBracket[];
  turnoverTax: TaxBracket[];
  turnoverTaxLimit: number;
  /** Deduction cap for s18A donations as a share of taxable income. */
  s18aCap: number;
  latePaymentPenalty: number;
  /** Prescribed interest rate spread over the repo rate (PFMA rate = repo + 3.5). */
  prescribedSpread: number;
}

/** 2026/27 year of assessment (1 March 2026 – 28 February 2027). */
export const SARS_2026_27: TaxTables = {
  yearLabel: '2027',
  brackets: [
    { from: 0, base: 0, rate: 0.18 },
    { from: 245_100, base: 44_118, rate: 0.26 },
    { from: 383_100, base: 79_998, rate: 0.31 },
    { from: 530_200, base: 125_599, rate: 0.36 },
    { from: 695_800, base: 185_215, rate: 0.39 },
    { from: 887_000, base: 259_783, rate: 0.41 },
    { from: 1_878_600, base: 666_339, rate: 0.45 },
  ],
  primaryRebate: 17_820,
  secondaryRebate: 9_765,
  tertiaryRebate: 3_249,
  mtcFirstTwo: 376,
  mtcAdditional: 254,
  interestExemptionUnder65: 23_800,
  interestExemption65Plus: 34_500,
  uifRate: 0.01,
  uifCeilingMonthly: 17_712,
  sdlRate: 0.01,
  sdlPayrollThreshold: 500_000,
  vatRate: 0.15,
  vatCompulsoryThreshold: 2_300_000,
  vatVoluntaryThreshold: 120_000,
  citRate: 0.27,
  dividendsTaxRate: 0.2,
  sbc: [
    { from: 0, base: 0, rate: 0 },
    { from: 99_000, base: 0, rate: 0.07 },
    { from: 365_000, base: 18_620, rate: 0.21 },
    { from: 550_000, base: 57_470, rate: 0.27 },
  ],
  turnoverTax: [
    { from: 0, base: 0, rate: 0 },
    { from: 600_000, base: 0, rate: 0.01 },
    { from: 950_000, base: 3_500, rate: 0.02 },
    { from: 1_400_000, base: 12_500, rate: 0.03 },
  ],
  turnoverTaxLimit: 2_300_000,
  s18aCap: 0.1,
  latePaymentPenalty: 0.1,
  prescribedSpread: 0.035,
};

export type TaxRegime = 'individual' | 'sbc' | 'cit' | 'turnover' | 'pbo' | 'exempt' | 'none';

/** Tax on a bracket table (base + rate above the bracket floor). */
export function bracketTax(amount: number, brackets: TaxBracket[]): number {
  if (amount <= 0) return 0;
  let b = brackets[0];
  for (const x of brackets) if (amount > x.from) b = x;
  return r2(b.base + (amount - b.from) * b.rate);
}

export function marginalRate(amount: number, brackets: TaxBracket[]): number {
  let b = brackets[0];
  for (const x of brackets) if (amount > x.from) b = x;
  return b.rate;
}

export function rebatesFor(age: number, T: TaxTables): number {
  return T.primaryRebate + (age >= 65 ? T.secondaryRebate : 0) + (age >= 75 ? T.tertiaryRebate : 0);
}

export function taxThreshold(age: number, T: TaxTables): number {
  return Math.round(rebatesFor(age, T) / T.brackets[0].rate);
}

/** Annual medical scheme fees tax credit for `beneficiaries` on a scheme for `months` months. */
export function medicalCredit(beneficiaries: number, months: number, T: TaxTables): number {
  if (beneficiaries <= 0 || months <= 0) return 0;
  const perMonth = Math.min(beneficiaries, 2) * T.mtcFirstTwo + Math.max(0, beneficiaries - 2) * T.mtcAdditional;
  return r2(perMonth * months);
}

/** Normal tax for the year on taxable income, after rebates and medical credits (never below zero). */
export function annualTax(taxable: number, age: number, T: TaxTables, medicalBeneficiaries = 0, medicalMonths = 0): number {
  const gross = bracketTax(taxable, T.brackets);
  const net = gross - rebatesFor(age, T) - medicalCredit(medicalBeneficiaries, medicalMonths, T);
  return r2(Math.max(0, net));
}

/**
 * Employees' tax on one month's remuneration using SARS' annual-equivalent
 * method: annualise the month, tax it, take off rebates and the medical
 * credit, divide by twelve.
 */
export function payeMonthly(grossMonthly: number, age: number, T: TaxTables, medicalBeneficiaries = 0): number {
  if (grossMonthly <= 0) return 0;
  return r2(annualTax(grossMonthly * 12, age, T, medicalBeneficiaries, 12) / 12);
}

/** UIF contribution for one party (employee or employer) for the month. */
export function uifMonthly(grossMonthly: number, T: TaxTables): number {
  if (grossMonthly <= 0) return 0;
  return r2(Math.min(grossMonthly, T.uifCeilingMonthly) * T.uifRate);
}

/** Skills development levy for the month, only for employers above the annual payroll threshold. */
export function sdlMonthly(grossPayrollMonthly: number, annualPayroll: number, T: TaxTables): number {
  return annualPayroll > T.sdlPayrollThreshold ? r2(grossPayrollMonthly * T.sdlRate) : 0;
}

/** Split a VAT-inclusive amount into the exclusive value and the VAT (zero-rated share carries none). */
export function vatOnInclusive(amountIncl: number, standardRatedShare: number, T: TaxTables): { excl: number; vat: number } {
  const std = amountIncl * standardRatedShare;
  const vat = std - std / (1 + T.vatRate);
  return { excl: r2(amountIncl - vat), vat: r2(vat) };
}

export function interestExemption(age: number, T: TaxTables): number {
  return age >= 65 ? T.interestExemption65Plus : T.interestExemptionUnder65;
}

export function companyTax(taxableIncome: number, regime: TaxRegime, turnover: number, T: TaxTables): number {
  if (taxableIncome <= 0 && regime !== 'turnover') return 0;
  switch (regime) {
    case 'cit':
      return r2(taxableIncome * T.citRate);
    case 'sbc':
      return bracketTax(taxableIncome, T.sbc);
    case 'turnover':
      return bracketTax(turnover, T.turnoverTax);
    default:
      return 0;
  }
}

/** The prescribed rate SARS charges on unpaid tax (Tax Administration Act s187). */
export function prescribedRate(repo: number, T: TaxTables): number {
  return repo + T.prescribedSpread;
}

/** Index every rand threshold in the tables by `factor` (rounded to the nearest R100 like the Budget does). */
export function indexTables(T: TaxTables, factor: number, yearLabel: string): TaxTables {
  const k = (v: number, unit = 100) => Math.round((v * factor) / unit) * unit;
  const brackets: TaxBracket[] = [];
  for (let i = 0; i < T.brackets.length; i++) {
    const from = i === 0 ? 0 : k(T.brackets[i].from);
    const base = i === 0 ? 0 : r2(brackets[i - 1].base + (from - brackets[i - 1].from) * brackets[i - 1].rate);
    brackets.push({ from, base, rate: T.brackets[i].rate });
  }
  const reb = (v: number) => Math.round(v * factor);
  return {
    ...T,
    yearLabel,
    brackets,
    primaryRebate: reb(T.primaryRebate),
    secondaryRebate: reb(T.secondaryRebate),
    tertiaryRebate: reb(T.tertiaryRebate),
    mtcFirstTwo: reb(T.mtcFirstTwo),
    mtcAdditional: reb(T.mtcAdditional),
  };
}

export interface IndividualAssessmentInput {
  age: number;
  remuneration: number;
  payeWithheld: number;
  interest: number;
  donations: number;
  s18a: boolean;
  medicalBeneficiaries: number;
  medicalMonths: number;
}

export interface IndividualAssessment {
  taxableIncome: number;
  taxableInterest: number;
  donationDeduction: number;
  normalTax: number;
  rebates: number;
  medicalCredit: number;
  taxPayable: number;
  payeWithheld: number;
  /** Positive: owes SARS; negative: refund due. */
  balance: number;
}

/** ITR12: the annual reconciliation of an individual's tax. */
export function assessIndividual(inp: IndividualAssessmentInput, T: TaxTables): IndividualAssessment {
  const taxableInterest = Math.max(0, inp.interest - interestExemption(inp.age, T));
  const grossIncome = inp.remuneration + taxableInterest;
  const donationDeduction = inp.s18a ? Math.min(inp.donations, grossIncome * T.s18aCap) : 0;
  const taxableIncome = r2(Math.max(0, grossIncome - donationDeduction));
  const normalTax = bracketTax(taxableIncome, T.brackets);
  const rebates = rebatesFor(inp.age, T);
  const mtc = medicalCredit(inp.medicalBeneficiaries, inp.medicalMonths, T);
  const taxPayable = r2(Math.max(0, normalTax - rebates - mtc));
  return { taxableIncome, taxableInterest, donationDeduction: r2(donationDeduction), normalTax, rebates, medicalCredit: mtc, taxPayable, payeWithheld: r2(inp.payeWithheld), balance: r2(taxPayable - inp.payeWithheld) };
}

/** Revenue at a uniform scaling of every marginal rate, with a behavioural response of taxable income (Laffer curve). */
export function lafferPoint(incomes: Array<{ taxable: number; age: number }>, scale: number, T: TaxTables, eti = 0.25): number {
  let total = 0;
  const brackets = T.brackets.map((b) => ({ ...b, rate: Math.min(0.99, b.rate * scale) }));
  for (let i = 1; i < brackets.length; i++) brackets[i].base = r2(brackets[i - 1].base + (brackets[i].from - brackets[i - 1].from) * brackets[i - 1].rate);
  for (const p of incomes) {
    const m0 = marginalRate(p.taxable, T.brackets);
    const m1 = marginalRate(p.taxable, brackets);
    const z = p.taxable * Math.pow((1 - m1) / (1 - m0), eti);
    total += Math.max(0, bracketTax(z, brackets) - rebatesFor(p.age, T));
  }
  return r2(total);
}
