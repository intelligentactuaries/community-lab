// State carried in `world.finance`: the ledgers, the Mutual Bank, the tax
// office, and the macro/micro series the analytics read. Plain data so the
// world stays serialisable and every submodel can be unit-tested.

import type { FlowKind, Ledgers, EntityKind } from './accounts';
import type { MarketsState } from './markets';
import type { TaxRegime, TaxTables } from './tax';
import type { TransportState } from './transport';

export type Sector = 'households' | 'firms' | 'church' | 'scheme' | 'bank' | 'government' | 'row';

export interface EntityInfo {
  id: string;
  name: string;
  kind: EntityKind;
  sector: Sector;
  /** Owning household (sole traders and small companies) for dividends. */
  owner: string | null;
  regime: TaxRegime;
  vatRegistered: boolean;
  /** Liable for the skills development levy (public benefit organisations and the state are exempt). */
  sdl: boolean;
  /** VAT period category: A files for periods ending in even months, B in odd months. */
  vatCategory: 'A' | 'B' | null;
}

export type LoanPurpose = 'living costs' | 'funeral' | 'legal' | 'medical' | 'working capital' | 'home improvement' | 'vehicle finance' | 'equipment finance';

export interface Loan {
  id: string;
  borrower: string;
  purpose: LoanPurpose;
  principal: number;
  balance: number;
  /** Annual nominal rate fixed at origination. */
  rate: number;
  termMonths: number;
  instalment: number;
  startMonth: number;
  monthsPaid: number;
  /** Consecutive missed instalments. */
  arrears: number;
  dpd: number;
  stage: 1 | 2 | 3;
  provision: number;
  status: 'active' | 'settled' | 'written-off';
  endMonth: number | null;
}

export interface PrudentialReturn {
  month: number;
  label: string;
  qualifyingCapital: number;
  rwa: number;
  car: number;
  liquidAssets: number;
  deposits: number;
  liquidityRatio: number;
  loansGross: number;
  allowance: number;
  npl: number;
  nplRatio: number;
  coverage: number;
  largestExposure: number;
  largestShare: number;
  nim: number;
  roe: number;
  breaches: string[];
}

export interface BankState {
  name: string;
  foundedMonth: number;
  loans: Record<string, Loan>;
  nextLoan: number;
  rates: { deposit: number; personal: number; business: number; emergency: number; tbill: number };
  rules: { carMin: number; carBuffer: number; liquidMin: number; largeExposure: number; pd12: number; pdLifetime: number; lgd: number; reserveTransfer: number; payoutRatio: number; maxInstalmentShare: number; maxDebtService: number };
  returns: PrudentialReturn[];
  /** Share capital by holder entity. */
  shares: Record<string, number>;
  /** Borrowers barred after a write-off, with the month the bar lifts. */
  blocked: Record<string, number>;
  stats: { originated: number; originatedAmount: number; declined: number; declinedReasons: Record<string, number>; settled: number; writtenOff: number; writtenOffAmount: number; dividendsPaid: number; preferenceDividends: number; interestPaid: number; interestEarned: number; tbillInterest: number };
  /** Non-dividend-bearing ordinary capital is not modelled: the founding shares are preference shares held outside, paid at the repo rate. */
  foundingCapital: number;
  /** Rolling monthly book metrics for charts. */
  monthly: Array<{ month: number; deposits: number; loans: number; allowance: number; npl: number; capital: number; car: number; liquidity: number; interestIncome: number; interestExpense: number; impairment: number; profit: number }>;
}

export type FilingKind = 'EMP201' | 'VAT201' | 'IRP6' | 'ITR14' | 'ITR12' | 'TT03' | 'DTR01';

export interface Filing {
  id: number;
  kind: FilingKind;
  entity: string;
  period: string;
  dueDay: number;
  filedDay: number;
  /** Net amount payable (negative = refund due from SARS). */
  amount: number;
  paid: number;
  status: 'paid' | 'refunded' | 'outstanding' | 'nil';
  penalty: number;
  interest: number;
  note: string;
}

export interface PersonTaxYear {
  personId: string;
  name: string;
  year: string;
  age: number;
  months: number;
  remuneration: number;
  paye: number;
  uif: number;
  interest: number;
  donations: number;
  medicalBeneficiaries: number;
  medicalMonths: number;
  assessed: null | { taxableIncome: number; normalTax: number; rebates: number; medicalCredit: number; taxPayable: number; balance: number; day: number };
}

export interface EntityTaxYear {
  entity: string;
  year: string;
  regime: TaxRegime;
  turnover: number;
  profitBeforeTax: number;
  taxableIncome: number;
  provisionalPaid: number;
  assessedTax: number | null;
  assessedDay: number | null;
}

export interface TaxState {
  tables: TaxTables;
  baseTables: TaxTables;
  filings: Filing[];
  nextFiling: number;
  personYears: Record<string, PersonTaxYear>;
  entityYears: Record<string, EntityTaxYear>;
  compliance: Record<string, { status: 'compliant' | 'non-compliant'; outstanding: number; lastFiledDay: number; penalties: number }>;
  /** Cumulative collections by head. */
  collected: Record<'paye' | 'vat' | 'cit' | 'uif' | 'sdl' | 'fuel' | 'fines' | 'dividends' | 'turnover' | 'penalties' | 'refunds' | 'rates', number>;
  /** Assessed losses carried forward against future taxable income, by taxpayer (s20). */
  assessedLosses: Record<string, number>;
  /** Payroll recorded this tax year by employer (for the SDL threshold). */
  payrollYtd: Record<string, number>;
  /** VAT output/input accumulated in the open period by vendor. */
  vatPeriod: Record<string, { output: number; input: number; sales: number; from: number }>;
  /** Provisional-tax estimates made this year by entity. */
  provisional: Record<string, { first: number; second: number }>;
  /** Last tax-season assessment run (calendar year). */
  lastAssessmentYear: number;
  verifications: Array<{ day: number; entity: string; kind: string; finding: string }>;
}

export interface MacroMonth {
  month: number;
  isoDate: string;
  cpi: number;
  foodCpi: number;
  /** CPI components for fuel and passenger-transport fares (100 = start). */
  fuelCpi: number;
  fareCpi: number;
  /** Pump price of 95 inland (R/l), Brent (US$/bbl) and the rand (R/US$) in the month. */
  petrol: number;
  brent: number;
  zar: number;
  /** Fuel's first-round contribution to national headline inflation (fraction). */
  fuelContribution: number;
  inflYoY: number;
  inflMoM: number;
  saInflation: number;
  repo: number;
  prime: number;
  wageIndex: number;
  /** Nominal ZAR for the month (community GDP at market prices). */
  gdpNominal: number;
  gdpReal: number;
  gdpProduction: number;
  gdpExpenditure: number;
  gdpIncome: number;
  discrepancy: number;
  consumption: number;
  investment: number;
  government: number;
  exports: number;
  imports: number;
  compensation: number;
  operatingSurplus: number;
  taxesOnProducts: number;
  potential: number;
  gap: number;
  employed: number;
  unemployed: number;
  workingAge: number;
  labourForce: number;
  unemploymentRate: number;
  participation: number;
  taxRevenue: number;
  govSpending: number;
  fiscalBalance: number;
  fiscalTransfer: number;
  deposits: number;
  loans: number;
  creditGrowthYoY: number | null;
  householdDisposable: number;
  savingRate: number;
  giniIncome: number;
  giniWealth: number;
  tithes: number;
}

export interface QuarterCurve {
  label: string;
  month: number;
  /** Real output for the quarter (sum of the three months, base-year rands). */
  Y: number;
  P: number;
  Ystar: number;
  /** Expected price level implied by the SRAS through (Y, P). */
  Pe: number;
  kappa: number;
  unemploymentRate: number;
  inflation: number;
  growth: number | null;
}

/** A meeting of the Monetary Policy Committee: the decision, the vote and the statement. */
export interface MpcDecision {
  month: number;
  isoDate: string;
  repo: number;
  /** Change in basis points. */
  change: number;
  votes: { hike: number; hold: number; cut: number };
  /** The committee's Taylor-rule rate before smoothing. */
  rule: number;
  /** Each member's preferred rate. */
  preferences: number[];
  statement: string;
}

export interface MacroState {
  cpi: number;
  foodCpi: number;
  fuelCpi: number;
  fareCpi: number;
  inflYoY: number;
  inflMoM: number;
  /** National headline inflation (annualised) the community imports: core plus fuel's first-round effect. */
  saInflation: number;
  /** National core inflation (AR(1) around the target, pushed by the rand). */
  saCore: number;
  /** Fuel's first-round contribution to national headline inflation. */
  fuelContribution: number;
  /** The committee's decisions, newest last. */
  mpc: MpcDecision[];
  expectedInflation: number;
  target: number;
  neutralReal: number;
  repo: number;
  /**
   * The part of `repo` a stress test added on top of the committee's rate (shocks.ts): taken off before the
   * committee meets, so it decides on its own rate, and put back after. Absent in a run that was never stressed.
   */
  repoStress?: number;
  prime: number;
  wageIndex: number;
  potential: number;
  nmwHourly: number;
  povertyLine: number;
  adultCost: number;
  childCost: number;
  grants: { child: number; oldAge: number; oldAge75: number };
  months: MacroMonth[];
  quarters: QuarterCurve[];
  lastIndexYear: number;
  gdpBase: number | null;
}

export interface MicroMonth {
  month: number;
  isoDate: string;
  /** Local food price index (1 = base) and the quantity index cleared. */
  price: number;
  quantity: number;
  localSupply: number;
  imports: number;
  yield: number;
  importParity: number;
  /** Demand Q = A·P^(−eps); supply Q = S0·yield·P^sigma. */
  A: number;
  eps: number;
  S0: number;
  sigma: number;
  consumerSurplus: number;
  producerSurplus: number;
  spend: number;
}

export interface LabourSnapshot {
  month: number;
  /** Sorted wage offers of the positions in the community (ZAR / month). */
  offers: number[];
  /** Sorted reservation wages of the labour force. */
  reservations: number[];
  nmwMonthly: number;
  employed: number;
  unemployed: number;
  equilibriumWage: number;
  meanWage: number;
  medianWage: number;
}

export interface MicroState {
  months: MicroMonth[];
  basePrice: number;
  /** Share of the farm's output sold through the community shop (calibrated at the first month). */
  localShare: number | null;
  labour: LabourSnapshot | null;
  engel: Array<{ household: string; name: string; perCapita: number; foodShare: number; income: number }>;
  elasticity: { price: number | null; income: number | null };
}

export interface FinanceEvent {
  day: number;
  kind: 'loan' | 'filing' | 'assessment' | 'penalty' | 'dividend' | 'bank' | 'market' | 'macro' | 'audit' | 'transport';
  text: string;
  entity?: string;
}

export interface FinanceState {
  ledgers: Ledgers;
  entities: Record<string, EntityInfo>;
  bank: BankState;
  tax: TaxState;
  macro: MacroState;
  micro: MicroState;
  /** Oil, the rand, pump prices, fuel levies and electricity. */
  markets: MarketsState;
  /** Fares, mode choice, the e-hailing market and the transport operators. */
  transport: TransportState;
  /** Monthly inter-sector flows keyed `${from}>${to}>${kind}`. */
  flows: Array<{ month: number; cells: Record<string, number> }>;
  log: FinanceEvent[];
  month: number;
  /** Rolling monthly rainfall (mm) for the farm yield model, and the running total for the current month. */
  rainHistory: number[];
  rainMonth: number;
  /** Cumulative CPI factor applied to the tax tables. */
  taxIndexFactor: number;
  /** Payroll detail for the last month (payslips). */
  payslips: Record<string, { personId: string; employer: string; gross: number; paye: number; uif: number; net: number; medicalBeneficiaries: number }>;
}

export type FlowKey = `${string}>${string}>${FlowKind}`;
