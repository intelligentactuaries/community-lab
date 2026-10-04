// The finance engine: every economic activity of the community posted to the
// books each month — payroll with PAYE, UIF and SDL; social grants; household
// budgets and consumption split by category with VAT; tithes; premiums; the
// produce market clearing between the farm and the shop; the businesses'
// purchases, sales, depreciation and investment; the church and the burial
// society; the Mutual Bank's month-end; SARS filings and assessments; the
// year-end close; and the macro and micro series the analytics read.

import type { Ctx } from '../ctx';
import { alivePeople, clamp, fullName, householdMembers } from '../ctx';
import { BUSINESS, BUSINESSES, COUNTER_IDS, PUBLIC_WORKPLACES, businessesIn, shopOf, type BusinessSpec } from '../institutions';
import type { ScenarioParams } from '../params';
import { freeYardSlot } from '../parking';
import { JOBS, createVehicle, eduRank } from '../population';
import { calendarForDay } from '../time';
import type { Household, Person } from '../types';
import { CITIES, cityOf, landmark } from '../world';
import type { FlowKind } from './accounts';
import { cashBalance, closeYear, createLedgers, endOfMonth, incomeStatement, movement, natural, openBook, r2, snapshotMonth } from './accounts';
import { bankMonthEnd, bankYearEnd, initBank, prudentialReturn, ratesFor, requestLoan } from './bank';
import { indexForYear, initMacro, macroMonthEnd, macroMonthStart, quarterLabel } from './macro';
import { initMarkets, levyPerLitre, marketsMonthStart, marketsRecord } from './markets';
import { clearProduceMarket, foodShare, initMicro, labourSnapshot, reservationWage } from './micro';
import { BANK, GOV, ROW, SCHEME, deposits, hhEntity, pay, payBatch, postInternal, type BatchItem } from './posting';
import type { EntityInfo, FinanceState, Filing, FilingKind, LoanPurpose, Sector } from './state';
import { SARS_2026_27, assessIndividual, companyTax, indexTables, payeMonthly, prescribedRate, sdlMonthly, uifMonthly, vatOnInclusive, type TaxRegime } from './tax';
import { COMMISSION, OUT_TAXI, fleetSync, initTransport, planTransport, transportOperators, transportYearEnd, type BudgetLike, type HouseholdTransport, type PlanInputs, type TransportPlan } from './transport';

export { taxYearLabel };

// ─── Calibrated shares (see docs/ASSUMPTIONS.md, "Economy and finance") ─────
// Fuel levies are no longer a fixed share: the pump price and the levies per litre come from markets.ts.
const LOCAL_FOOD_SHARE = 0.8; // food bought at the community shop rather than in town
const PRODUCE_SHARE = 0.35; // fresh produce within food spend
const FOOD_COGS = 0.7; // general dealer gross margin ≈ 30% on food
const GOODS_COGS = 0.68;
const OTHER_COGS = 0.82; // airtime and low-margin lines
const ZERO_RATED_POOR = 0.35; // share of food spend on zero-rated items, poor households
const ZERO_RATED = 0.25;
const FARM_OUTPUT_BASE = 60_000; // farmer alone, base prices per month
const FARM_OUTPUT_PER_HAND = 22_000;
const FARM_LOCAL_SHARE_MAX = 0.6; // at most this share of the farm's output goes through the community shop; the rest is under contract to a regional buyer
const VENDOR_MARGIN = 0.35; // informal traders' gross margin on what they sell
const FARM_INPUT_SHARE = 0.35;
const EXPORT_PARITY = 0.85; // farm-gate contract price relative to import parity
const PUBLIC_SERVICES_COST = 48_000; // per city: clinic and medical-centre medicines, school materials, police, court and council running costs
const CENTRAL_SERVICES_COST = 95_000; // the central hospital's theatres and wards, Government House, the Reserve Bank, the provincial police and the park
const FUNERAL_COST = 15_000;
const HOURS_PER_MONTH = (40 * 52) / 12;
const ADULT_COST = 2_450; // basic needs, ZAR / month, 2026 prices (Stats SA upper-bound poverty line + housing and transport)
const CHILD_COST = 1_500;

/**
 * The paying entity for a workplace: a business or church pays from its own
 * books, the state pays for its institutions, the Mutual Bank pays its head
 * office and every settlement counter, and a domestic worker's employer is the
 * household whose home it is.
 */
function employerFor(world: Ctx['world'], workplaceId: string): string | null {
  if (BUSINESS[workplaceId]) return workplaceId;
  if (PUBLIC_WORKPLACES.has(workplaceId)) return GOV;
  if (workplaceId === 'bank' || COUNTER_IDS.includes(workplaceId)) return BANK;
  const b = world.buildings[workplaceId];
  if (b?.kind === 'house' && b.householdId) return hhEntity(b.householdId);
  return null;
}

function comOf(world: Ctx['world'], hh: Household) {
  return world.buildings[hh.houseId]?.community ?? 'ebenezer';
}

/** The workshop and taxi association a household's own city keeps. */
function cityWorkshop(world: Ctx['world'], hh: Household): string {
  return landmark(comOf(world, hh), 'workshop');
}
function cityTaxi(world: Ctx['world'], hh: Household): string {
  return landmark(comOf(world, hh), 'taxi');
}

function taxYearLabel(cal: { year: number; month: number }): string {
  return String(cal.month >= 3 ? cal.year + 1 : cal.year);
}

export function emptyFinance(P: ScenarioParams): FinanceState {
  return {
    ledgers: createLedgers(P.journalRetentionMonths),
    entities: {},
    bank: initBank(`${P.regionName} Mutual Bank`, 0, P.repoRate, P.bankFoundingCapital),
    tax: {
      tables: SARS_2026_27,
      baseTables: SARS_2026_27,
      filings: [],
      nextFiling: 1,
      personYears: {},
      entityYears: {},
      compliance: {},
      collected: { paye: 0, vat: 0, cit: 0, uif: 0, sdl: 0, fuel: 0, fines: 0, dividends: 0, turnover: 0, penalties: 0, refunds: 0, rates: 0 },
      payrollYtd: {},
      vatPeriod: {},
      assessedLosses: {},
      provisional: {},
      lastAssessmentYear: 0,
      verifications: [],
    },
    macro: initMacro({ repo: P.repoRate, target: P.inflationTarget, saInflation: P.inflationStart, nmwHourly: P.minimumWageHourly, povertyLine: P.povertyLine, adultCost: ADULT_COST, childCost: CHILD_COST, childGrant: P.childGrant, oldAgeGrant: P.oldAgeGrant }),
    micro: initMicro(),
    markets: initMarkets(),
    transport: initTransport(),
    flows: [],
    log: [],
    month: 0,
    rainHistory: [],
    rainMonth: 0,
    taxIndexFactor: 1,
    payslips: {},
  };
}

function ready(ctx: Ctx): FinanceState | null {
  const F = ctx.world.finance;
  return F && F.entities[GOV] ? F : null;
}

function openEntity(F: FinanceState, id: string, name: string, kind: EntityInfo['kind'], sector: Sector, month: number, opts: Partial<EntityInfo> = {}): EntityInfo {
  openBook(F.ledgers, id, name, kind, month);
  const info: EntityInfo = { id, name, kind, sector, owner: null, regime: 'none', vatRegistered: false, sdl: false, vatCategory: null, ...opts };
  F.entities[id] = info;
  if (!F.tax.compliance[id]) F.tax.compliance[id] = { status: 'compliant', outstanding: 0, lastFiledDay: -1, penalties: 0 };
  return info;
}

function openingBalances(F: FinanceState, entity: string, day: number, month: number, assets: Record<string, number>, memo: string): void {
  const lines: Array<{ account: string; debit?: number; credit?: number }> = [];
  let total = 0;
  for (const code in assets) {
    const v = r2(assets[code]);
    if (v <= 0) continue;
    lines.push({ account: code, debit: v });
    total += v;
  }
  if (total <= 0) return;
  lines.push({ account: '3010', credit: r2(total) });
  postInternal(F, entity, day, month, 'OPEN', memo, lines, 'capital');
  const dep = assets['1020'] ?? 0;
  if (dep > 0 && entity !== BANK) postInternal(F, BANK, day, month, 'OPEN', `Opening deposit: ${F.entities[entity]?.name ?? entity}`, [{ account: '1030', debit: r2(dep) }, { account: '2100', credit: r2(dep) }], 'capital', entity);
}

/** Open the community's books at day 0 (after the population exists). */
export function initFinance(ctx: Ctx): void {
  const world = ctx.world;
  const P = ctx.params;
  const F = world.finance;
  const day = world.day;
  const month = 0;
  const B = world.buildings;
  F.month = 0;
  openEntity(F, GOV, 'Government: SARS, SASSA, the municipality and provincial services', 'government', 'government', month);
  openEntity(F, ROW, 'Rest of the economy (outside the community)', 'row', 'row', month);
  openEntity(F, BANK, F.bank.name, 'bank', 'bank', month, { regime: 'cit', sdl: true });
  openEntity(F, SCHEME, `${P.regionName} Burial and Life Society`, 'scheme', 'scheme', month, { regime: 'exempt' });
  const ownerAt = (job: string, wp: string) => {
    const p = alivePeople(world).find((q) => q.job === job && q.workplaceId === wp);
    return p ? hhEntity(p.householdId) : null;
  };
  // Every business and congregation in the region opens its books on the same
  // footing: regime, VAT status and owner from the registry, name from the map.
  for (const biz of BUSINESSES) {
    const church = biz.kind === 'church';
    openEntity(F, biz.id, biz.name ?? B[biz.id]?.name ?? biz.id, church ? 'church' : 'business', church ? 'church' : 'firms', month, {
      regime: biz.regime,
      vatRegistered: biz.vatRegistered,
      sdl: biz.sdl,
      vatCategory: biz.vatRegistered ? 'A' : null,
      owner: biz.ownerJob ? ownerAt(biz.ownerJob, biz.id) : null,
    });
  }
  if (B.bank) B.bank.name = F.bank.name;
  openingBalances(F, BANK, day, month, { '1030': P.bankFoundingCapital }, 'Founding preference share capital from the development fund, meeting the Mutual Banks Act minimum');
  openingBalances(F, SCHEME, day, month, { '1020': P.schemeReserve }, 'Opening reserve of the burial and life society');
  for (const biz of BUSINESSES) openingBalances(F, biz.id, day, month, biz.opening, biz.openingMemo);
  // The driver-partners already on the road rent their cars from the fleet, which brings them in at cost.
  fleetSync(ctx, F, month, true);
  for (const id in world.households) {
    const hh = world.households[id];
    if (hh.dissolvedDay) continue;
    householdOpened(ctx, hh, hh.savings, null, 'Opening savings brought into the books');
  }
}

// ─── Hooks used by the other submodels ───────────────────────────────────────

function ensureHousehold(ctx: Ctx, F: FinanceState, hh: Household): string {
  const e = hhEntity(hh.id);
  if (!F.ledgers.books[e]) householdOpened(ctx, hh, 0, null, 'Book opened');
  else if (F.entities[e].name !== `${hh.name} household`) {
    F.entities[e].name = `${hh.name} household`;
    F.ledgers.books[e].name = F.entities[e].name;
  }
  return e;
}

/** A household starts its books: savings brought in from outside or transferred from a parent household. */
export function householdOpened(ctx: Ctx, hh: Household, amount: number, from: Household | null, memo: string): void {
  const F = ready(ctx);
  if (!F) return;
  const world = ctx.world;
  const P = ctx.params;
  const e = hhEntity(hh.id);
  const day = world.day;
  const month = F.month;
  if (!F.ledgers.books[e]) openEntity(F, e, `${hh.name} household`, 'household', 'households', month, { regime: 'individual' });
  amount = r2(Math.max(0, amount));
  if (from && F.ledgers.books[hhEntity(from.id)]) {
    const give = r2(Math.min(amount, Math.max(0, deposits(F, hhEntity(from.id)))));
    if (give > 0) pay(F, { from: hhEntity(from.id), to: e, amount: give, day, month, ref: 'CAPITAL', memo, flow: 'transfer', fromAccount: '3010', toAccount: '3010' });
  } else if (amount > 0) pay(F, { from: ROW, to: e, amount, day, month, ref: 'CAPITAL', memo, flow: 'capital', fromAccount: '5370', toAccount: '3010' });
  if (hh.vehicleId && world.vehicles[hh.vehicleId] && natural(F.ledgers.books[e], '1510') <= 0) {
    const cars = [hh.vehicleId, ...hh.extraVehicleIds].map((id) => world.vehicles[id]).filter(Boolean);
    const v = cars.reduce((s, c) => s + (c.kind === 'bakkie' ? 140_000 : 90_000), 0);
    postInternal(F, e, day, month, 'CAPITAL', cars.length > 1 ? `${cars.length} vehicles brought into the books at cost` : 'Vehicle brought into the books at cost', [{ account: '1510', debit: v }, { account: '3010', credit: v }], 'capital');
  }
  if (P.bankMemberShare > 0 && !F.bank.shares[e] && deposits(F, e) >= P.bankMemberShare * 2) {
    pay(F, { from: e, to: BANK, amount: P.bankMemberShare, day, month, ref: 'SHARES', memo: `Member share subscription in ${F.bank.name}`, flow: 'capital', fromAccount: '1700', toAccount: '3010' });
    F.bank.shares[e] = P.bankMemberShare;
  }
  syncHousehold(F, hh);
}

/** Money moves with the people: the closing household's balance goes to the heir household or leaves with them. */
export function householdClosed(ctx: Ctx, hh: Household, heir: Household | null): void {
  const F = ready(ctx);
  if (!F) return;
  const e = hhEntity(hh.id);
  const book = F.ledgers.books[e];
  if (!book) return;
  if (F.bank.shares[e]) {
    // Shares are redeemed at par into the member's deposit account before it is emptied.
    const sh = F.bank.shares[e];
    delete F.bank.shares[e];
    pay(F, { from: BANK, to: e, amount: sh, day: ctx.world.day, month: F.month, ref: 'SHARES', memo: `Member shares of the ${hh.name} household redeemed at par`, flow: 'capital', fromAccount: '3010', toAccount: '1700' });
  }
  const bal = r2(deposits(F, e));
  if (bal > 0) {
    if (heir && F.ledgers.books[hhEntity(heir.id)]) pay(F, { from: e, to: hhEntity(heir.id), amount: bal, day: ctx.world.day, month: F.month, ref: 'CLOSE', memo: `${hh.name} household closed: balance to the ${heir.name} household`, flow: 'transfer', fromAccount: '3010', toAccount: '3010' });
    else pay(F, { from: e, to: ROW, amount: bal, day: ctx.world.day, month: F.month, ref: 'CLOSE', memo: `${hh.name} household closed: savings leave with the family`, flow: 'transfer', fromAccount: '3010', toAccount: '4900' });
  }
  book.closedMonth = F.month;
  syncHousehold(F, hh);
}

/**
 * The household pays out (a fine, a loss, a funeral, a medical bill). Pays what
 * it has, borrowing for the shortfall when a loan purpose is given.
 */
export function hhPayOut(ctx: Ctx, hh: Household, amount: number, account: string, memo: string, opts: { to?: string; toAccount?: string; loan?: LoanPurpose; flow?: FlowKind } = {}): number {
  const F = ready(ctx);
  if (!F) {
    hh.savings -= amount;
    return amount;
  }
  const e = ensureHousehold(ctx, F, hh);
  amount = r2(Math.max(0, amount));
  if (amount <= 0) return 0;
  let avail = Math.max(0, deposits(F, e));
  if (avail < amount && opts.loan) {
    const d = requestLoan(F, e, amount - avail + 500, opts.loan, Math.max(0, hh.monthlyIncome) * 0.85, ctx.world.day, F.month, F.tax.tables.vatRate);
    if (d.approved) {
      avail = Math.max(0, deposits(F, e));
      ctx.emit({ kind: 'economy', severity: 'info', text: `${F.bank.name} advanced R${Math.round(d.loan!.principal).toLocaleString()} to the ${hh.name} household for ${opts.loan}.`, householdId: hh.id });
    }
  }
  const paid = r2(Math.min(amount, avail));
  if (paid > 0) pay(F, { from: e, to: opts.to ?? ROW, amount: paid, day: ctx.world.day, month: F.month, ref: account === '5160' ? 'FINE' : account === '5150' ? 'FUNERAL' : 'LOSS', memo, flow: opts.flow ?? 'losses', fromAccount: account, toAccount: opts.toAccount ?? '4900' });
  if (opts.to === GOV && opts.toAccount === '4137') F.tax.collected.fines += paid;
  syncHousehold(F, hh);
  return paid;
}

/** Money received by a household from outside the wage economy (a benefit, a gift, a settlement). */
export function hhReceive(ctx: Ctx, hh: Household, amount: number, account: string, memo: string, from = ROW, fromAccount = '5370', flow: FlowKind = 'transfer'): void {
  const F = ready(ctx);
  if (!F) {
    hh.savings += amount;
    return;
  }
  const e = ensureHousehold(ctx, F, hh);
  amount = r2(Math.max(0, amount));
  if (amount <= 0) return;
  pay(F, { from, to: e, amount, day: ctx.world.day, month: F.month, ref: 'RECEIPT', memo, flow, fromAccount, toAccount: account });
  syncHousehold(F, hh);
}

/** Stock theft or damage on the farm hits the farm's books. */
export function farmLoss(ctx: Ctx, amount: number, memo: string): void {
  const F = ready(ctx);
  if (!F) return;
  const paid = r2(Math.min(Math.max(0, amount), Math.max(0, deposits(F, 'farm'))));
  if (paid > 0) pay(F, { from: 'farm', to: ROW, amount: paid, day: ctx.world.day, month: F.month, ref: 'LOSS', memo, flow: 'losses', fromAccount: '5170', toAccount: '4900' });
}

/** On a death: the society pays its benefits, then the household pays for the funeral. */
export function settleDeath(ctx: Ctx, p: Person): void {
  const world = ctx.world;
  const F = ready(ctx);
  const ins = world.insurance;
  const hh = world.households[p.householdId];
  if (!hh) return;
  const cpiF = F ? F.macro.cpi / 100 : 1;
  let benefit = 0;
  if (hh.insurance.funeral) benefit += Math.round(ctx.params.funeralBenefit * cpiF);
  if (hh.insurance.life && p.age >= 18 && p.age < 65) benefit += Math.round(ctx.params.lifeCoverSum * cpiF);
  if (benefit > 0) {
    if (ins.ruined) ctx.emit({ kind: 'insurance', severity: 'danger', text: `The scheme could not pay the R${benefit.toLocaleString()} claim for ${fullName(p)} — it is insolvent.`, personIds: [p.id], householdId: hh.id });
    else {
      ins.claimsOut += benefit;
      ins.claimCount++;
      if (F) {
        ensureHousehold(ctx, F, hh);
        pay(F, { from: SCHEME, to: hhEntity(hh.id), amount: benefit, day: world.day, month: F.month, ref: `CLAIM-${ins.claimCount}`, memo: `Claim on the death of ${fullName(p)}`, flow: 'claims', fromAccount: '5300', toAccount: '4090' });
        ins.reserve = cashBalance(F.ledgers.books[SCHEME]);
        syncHousehold(F, hh);
      } else {
        ins.reserve -= benefit;
        hh.savings += benefit;
      }
      const last = ins.surplusPath[ins.surplusPath.length - 1];
      if (last) last.claims += benefit;
      ctx.emit({ kind: 'insurance', severity: 'info', text: `Scheme paid R${benefit.toLocaleString()} to the ${hh.name} household for ${fullName(p)}.`, personIds: [p.id], householdId: hh.id, data: { benefit } });
      if (ins.reserve < 0 && !ins.ruined) {
        ins.ruined = true;
        ins.ruinMonth = Math.floor(world.day / 30.44);
        ctx.emit({ kind: 'insurance', severity: 'danger', text: `The community funeral & life scheme is RUINED: reserve fell to R${Math.round(ins.reserve).toLocaleString()}.`, data: { reserve: ins.reserve } });
      }
    }
  }
  const cost = Math.round(FUNERAL_COST * cpiF);
  hhPayOut(ctx, hh, cost, '5150', `Funeral of ${fullName(p)}`, { loan: 'funeral', flow: 'imports', to: ROW, toAccount: '4040' });
}

export function syncHousehold(F: FinanceState, hh: Household): void {
  const e = hhEntity(hh.id);
  if (!F.ledgers.books[e]) return;
  hh.savings = Math.round(deposits(F, e));
  let debt = 0;
  for (const id in F.bank.loans) {
    const l = F.bank.loans[id];
    if (l.status === 'active' && l.borrower === e) debt += l.balance;
  }
  hh.debt = Math.round(debt);
}

/** Bank interest is taxable in the hands of the household head (the account holder). */
function attributeInterest(ctx: Ctx, F: FinanceState, interestByMember: Record<string, number>): void {
  const world = ctx.world;
  const label = taxYearLabel(ctx.cal);
  for (const e in interestByMember) {
    if (!e.startsWith('hh:')) continue;
    const hh = world.households[e.slice(3)];
    if (!hh) continue;
    const members = householdMembers(world, hh.id);
    const holder = members.find((m) => m.id === hh.headId) ?? members.sort((a, b) => b.income - a.income)[0];
    if (!holder) continue;
    const rec = personYear(F, holder, label);
    rec.interest = r2(rec.interest + interestByMember[e]);
  }
}

function personYear(F: FinanceState, p: Person, label: string) {
  const key = `${p.id}:${label}`;
  let rec = F.tax.personYears[key];
  if (!rec) {
    rec = { personId: p.id, name: fullName(p), year: label, age: p.age, months: 0, remuneration: 0, paye: 0, uif: 0, interest: 0, donations: 0, medicalBeneficiaries: 0, medicalMonths: 0, assessed: null };
    F.tax.personYears[key] = rec;
  }
  rec.age = p.age;
  return rec;
}

function fileReturn(F: FinanceState, kind: FilingKind, entity: string, period: string, day: number, amount: number, paid: number, penalty: number, note: string): Filing {
  const status: Filing['status'] = amount < -0.5 ? 'refunded' : Math.abs(amount) < 0.5 ? 'nil' : paid + 0.5 >= amount ? 'paid' : 'outstanding';
  const f: Filing = { id: F.tax.nextFiling++, kind, entity, period, dueDay: day + 6, filedDay: day, amount: r2(amount), paid: r2(paid), status, penalty: r2(penalty), interest: 0, note };
  F.tax.filings.push(f);
  if (F.tax.filings.length > 1500) F.tax.filings.shift();
  const c = F.tax.compliance[entity];
  if (c) c.lastFiledDay = day;
  return f;
}

// ─── The monthly step ───────────────────────────────────────────────────────

interface Payroll {
  byHousehold: Record<string, { gross: number; net: number; paye: number; uif: number }>;
  byEmployer: Record<string, { gross: number; count: number }>;
  wages: number[];
  totalGross: number;
}

interface Budget {
  hh: Household;
  e: string;
  members: Person[];
  gross: number;
  netPay: number;
  vendorNet: number;
  grants: number;
  other: number;
  disposable: number;
  needs: number;
  consumption: number;
  tithe: number;
  prem: number;
  loanService: number;
  deprived: boolean;
  pcIncome: number;
  food: number;
  hasCar: boolean;
  medical: boolean;
  homeschool: boolean;
  zeroRated: number;
  /** The settlement's own general dealer and congregation (none in Newhaven). */
  shop: string;
  church: string | null;
  /** The shop's registry entry: how much of the household's food and goods it captures. */
  shopSpec: BusinessSpec;
}

interface Totals {
  vat: number;
  fuelLevies: number;
  rates: number;
  marketFoodExcl: number;
  marketGoodsExcl: number;
  marketOtherExcl: number;
  consumption: number;
  tithes: number;
  premiums: number;
  investment: number;
}

export function financeMonthStep(ctx: Ctx, month: number): void {
  const world = ctx.world;
  const P = ctx.params;
  const F = ready(ctx);
  if (!F) return;
  const rng = ctx.rng.stream('finance');
  const cal = ctx.cal;
  const day = world.day;
  const M = F.macro;
  F.month = month;
  F.rainHistory.push(F.rainMonth);
  if (F.rainHistory.length > 60) F.rainHistory.shift();
  F.rainMonth = 0;
  // 0. Year-end for the tax year that ended on the last day of February, then the previous month's close
  if (cal.month === 3 && month > 0) yearEnd(ctx, F, month);
  if (month > 0) closePreviousMonth(F, month - 1);
  // 1. The first Wednesday: the Budget's fuel levy and NERSA's tariff in April, this month's pump prices, oil and the rand
  const S = F.markets;
  const news = marketsMonthStart(S, ctx.rng.stream('markets'), { month, isoDate: cal.isoDate, calMonth: cal.month, year: cal.year, inflYoY: M.inflYoY, cpiFactor: M.cpi / 100, repo: M.repo, oilFactor: ctx.shocks.oilFactor });
  for (const t of [news.budget, news.nersa, news.relief, news.reliefEnded]) {
    if (!t) continue;
    ctx.emit({ kind: 'economy', severity: t === news.relief ? 'alert' : 'info', text: t });
    F.log.push({ day, kind: 'macro', text: t });
  }
  if (news.priceChange && Math.abs(news.priceChange.petrol) >= 0.25) {
    const up = news.priceChange.petrol > 0;
    ctx.emit({ kind: 'economy', severity: up ? 'alert' : 'joy', text: `Fuel prices ${up ? 'rose' : 'fell'} on the first Wednesday: 95 unleaded ${up ? 'up' : 'down'} ${Math.round(Math.abs(news.priceChange.petrol) * 100)}c to R${S.petrol.toFixed(2)}/l inland, diesel ${news.priceChange.diesel >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(news.priceChange.diesel) * 100)}c to R${S.diesel.toFixed(2)}/l (Brent US$${S.brent.toFixed(0)}, R${S.zar.toFixed(2)}/$).` });
  }
  // 2. Macro month start: national inflation, the Monetary Policy Committee, the March wage and grant rounds
  const mkAgo = S.months.length >= 12 ? S.months[S.months.length - 12] : null;
  const fuelYoY = mkAgo && mkAgo.petrol > 0 ? S.petrol / mkAgo.petrol - 1 : S.petrol / S.base.petrol - 1;
  const zarYoY = mkAgo && mkAgo.zar > 0 ? S.zar / mkAgo.zar - 1 : S.zar / S.base.zar - 1;
  // A stress test's rate shock sits on top of the committee's rate: off before it meets, so it decides on its own
  // rate as it would have, and back on after (shocks.ts).
  const stressBefore = M.repoStress ?? 0;
  if (M.repoStress) {
    M.repo -= M.repoStress;
    M.prime = M.repo + 0.035;
  }
  const decision = macroMonthStart(M, rng, { calMonth: cal.month, month, isoDate: cal.isoDate, fuelYoY, zarYoY, brent: S.brent, zar: S.zar });
  const stressBp = ctx.shocks.repoBp;
  if (stressBp || M.repoStress !== undefined) {
    const stressed = clamp(M.repo + stressBp / 10_000, 0.0025, 0.35);
    M.repoStress = stressed - M.repo;
    M.repo = stressed;
    M.prime = M.repo + 0.035;
  }
  if ((decision && decision.change !== 0) || (M.repoStress ?? 0) !== stressBefore) F.bank.rates = ratesFor(M.repo);
  if (decision) {
    const stressNote = stressBp ? ` A stress test adds ${stressBp > 0 ? '+' : ''}${stressBp} bp on top, so the repo rate stands at ${(M.repo * 100).toFixed(2)}%.` : '';
    ctx.emit({ kind: 'economy', severity: decision.change > 0 ? 'alert' : decision.change < 0 ? 'joy' : 'info', text: `${decision.statement}${stressNote}${decision.change !== 0 ? ` ${F.bank.name} repriced its loans and deposits.` : ''}` });
    F.log.push({ day, kind: 'macro', text: decision.statement + stressNote });
  }
  if (cal.month === 3 && month >= 12) {
    const idx = indexForYear(M, cal.month, cal.year, P.realWageGrowth);
    if (idx) {
      F.taxIndexFactor *= 1 + P.bracketIndexation * clamp(M.inflYoY, 0, 0.15);
      F.tax.tables = indexTables(F.tax.baseTables, F.taxIndexFactor, taxYearLabel(cal));
      ctx.emit({ kind: 'economy', severity: 'info', text: `March wage round: formal wages up ${((idx.wages - 1) * 100).toFixed(1)}%, grants up ${((idx.grants - 1) * 100).toFixed(1)}%, minimum wage R${M.nmwHourly.toFixed(2)}/h; SARS tables indexed for the ${taxYearLabel(cal)} year of assessment.` });
    }
  }
  const cpiF = M.cpi / 100;
  const nmwMonthly = r2(M.nmwHourly * HOURS_PER_MONTH);
  const hhs = Object.values(world.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  for (const hh of hhs) ensureHousehold(ctx, F, hh);
  // A rented car on the road for every driver-partner who signed up (bought on vehicle finance when none stands idle).
  for (const t of fleetSync(ctx, F, month)) ctx.emit({ kind: 'economy', severity: 'info', text: t });
  // 2. Payroll and grants
  const payroll = runPayroll(ctx, F, month, nmwMonthly);
  const grants = payGrants(ctx, F, month, hhs);
  const stipends = payCouncilStipends(ctx, F, month);
  const cities = CITIES.filter((c) => c.kind === 'city').length;
  pay(F, { from: GOV, to: ROW, amount: r2((PUBLIC_SERVICES_COST * cities + CENTRAL_SERVICES_COST) * cpiF), day, month, ref: `GOV-${cal.isoDate.slice(0, 7)}`, memo: 'Public services: three cities\' clinics, schools, police, courts and councils; the central hospital, Government House, the Reserve Bank and Unity Park', flow: 'imports', fromAccount: '5340', toAccount: '4040' });
  // 3. Household budgets, fares and the ways of getting about, the produce market, consumption
  const budgets = planBudgets(ctx, F, month, hhs, payroll, grants, stipends, cpiF, rng);
  const last = M.months[M.months.length - 1];
  const yearAgo = M.months.length >= 13 ? M.months[M.months.length - 13] : null;
  const planInputs: PlanInputs = {
    month,
    isoDate: cal.isoDate,
    calMonth: cal.month,
    cpiF,
    gap: last?.gap ?? 0,
    inflYoY: M.inflYoY,
    realIncomeGrowth: last && yearAgo && yearAgo.householdDisposable > 0 ? clamp(last.householdDisposable / yearAgo.householdDisposable / (last.cpi / yearAgo.cpi) - 1, -0.3, 0.3) : 0,
    unemployment: last?.unemploymentRate ?? 0.1,
    nmwHourly: M.nmwHourly,
    prime: M.prime,
    wageIndex: M.wageIndex,
    otherShares: (b) => {
      const c = categoryShares(b, cpiF);
      return c.housing + c.goods + c.education + c.health + c.other;
    },
  };
  const tplan = planTransport(ctx, F, budgets, planInputs);
  const market = clearMarket(ctx, F, month, budgets, cpiF);
  const { totals, spent } = postConsumption(ctx, F, month, budgets, cpiF, tplan);
  // The rental fleet's new cars this month are investment (bought before the budgets were drawn up).
  totals.investment += F.transport.fleet.capex;
  F.transport.fleet.capex = 0;
  investmentDecisions(ctx, F, month, budgets, totals, cpiF, rng);
  // 4. Businesses, church and society; the transport operators
  businessMonth(ctx, F, month, budgets, totals, market, payroll, cpiF, rng, spent);
  const tm = transportOperators(ctx, F, month, tplan, spent, planInputs, { employerFor: (wp) => employerFor(world, wp), workshopOf: (hh) => cityWorkshop(world, hh) }, totals);
  for (const t of tm.events) {
    ctx.emit({ kind: 'economy', severity: 'info', text: t });
    F.log.push({ day, kind: 'transport', text: t });
  }
  businessFinancing(ctx, F, month, cpiF, rng);
  householdRelief(ctx, F, month, cpiF);
  churchMonth(ctx, F, month, hhs, totals, cpiF);
  // 5. The bank
  const members = Object.keys(F.ledgers.books).filter((id) => id !== BANK && id !== GOV && id !== ROW && F.ledgers.books[id].closedMonth === null);
  // Account administration fees (R120/month, CPI-indexed) — the counters do not staff themselves.
  {
    const fee = r2(120 * cpiF);
    for (const mId of members) {
      if (deposits(F, mId) < 5 * fee) continue;
      pay(F, { from: mId, to: BANK, amount: fee, day, month, ref: `FEE-${cal.isoDate.slice(0, 7)}`, memo: 'Account administration fee', flow: 'purchases', fromAccount: '5320', toAccount: '4100' });
    }
  }
  const interest = bankMonthEnd(F, day, month, members, cpiF);
  attributeInterest(ctx, F, interest);
  if (month % 3 === 2) {
    const ret = prudentialReturn(F, month, quarterLabel(cal.isoDate));
    for (const b of ret.breaches) ctx.emit({ kind: 'economy', severity: 'alert', text: `${F.bank.name} prudential return ${ret.label}: ${b}.` });
  }
  // 6. SARS
  taxFilings(ctx, F, month);
  if (cal.month === 7) taxSeason(ctx, F, month);
  // 7. Month end: fiscal balancing, snapshots, macro and micro series, mirrors
  monthEnd(ctx, F, month, hhs, budgets, payroll, totals, market);
}

/** Snapshot every book and seal the journal for the month that has just ended (events posted during the month are included). */
function closePreviousMonth(F: FinanceState, month: number): void {
  const L = F.ledgers;
  for (const id in L.books) {
    const b = L.books[id];
    if (b.closedMonth === null || b.closedMonth >= month) snapshotMonth(b, month);
  }
  const bm = F.bank.monthly.find((m) => m.month === month);
  if (bm) bm.profit = incomeStatement(L.books[BANK], month, month).netProfit;
  endOfMonth(L, month);
}

function runPayroll(ctx: Ctx, F: FinanceState, month: number, nmwMonthly: number): Payroll {
  const world = ctx.world;
  const T = F.tax.tables;
  const M = F.macro;
  const cal = ctx.cal;
  const label = taxYearLabel(cal);
  const out: Payroll = { byHousehold: {}, byEmployer: {}, wages: [], totalGross: 0 };
  const slips: Array<{ p: Person; employer: string; gross: number; beneficiaries: number }> = [];
  const employerPayroll: Record<string, number> = {};
  for (const p of alivePeople(world)) {
    if (p.income <= 0 || p.away || !p.workplaceId) continue;
    if (p.job === 'vendor' || p.job === 'ehailer') continue; // informal traders and driver-partners work for their own account (see postConsumption and transport.ts)
    // Unity Transit employs the bus drivers; the airline (a national carrier, outside the province) employs the pilots.
    const employer = p.job === 'busdriver' ? 'transit' : p.job === 'pilot' ? ROW : employerFor(world, p.workplaceId);
    if (!employer || !F.ledgers.books[employer]) continue;
    const hh = world.households[p.householdId];
    if (!hh || hh.dissolvedDay) continue;
    const gross = Math.max(Math.round(p.income * M.wageIndex), nmwMonthly);
    const members = householdMembers(world, hh.id);
    const top = members.reduce((a, b) => (b.income > a.income ? b : a), members[0]);
    const beneficiaries = hh.insurance.medical && top?.id === p.id ? members.length : 0;
    slips.push({ p, employer, gross, beneficiaries });
    employerPayroll[employer] = (employerPayroll[employer] ?? 0) + gross;
  }
  F.payslips = {};
  for (const s of slips) {
    const { p, employer, gross, beneficiaries } = s;
    // Wages are paid from what the employer actually has: an empty till means an
    // unpaid month (and, for a domestic post, retrenchment at the next review).
    if (employer !== GOV && employer !== BANK && employer !== ROW && deposits(F, employer) < gross) continue;
    const hh = world.households[p.householdId];
    const e = hhEntity(hh.id);
    const paye = payeMonthly(gross, p.age, T, beneficiaries);
    const uif = uifMonthly(gross, T);
    const info = F.entities[employer];
    const sdl = info.sdl ? sdlMonthly(gross, employerPayroll[employer] * 12, T) : 0;
    const net = r2(gross - paye - uif);
    if (employer === ROW) {
      // A non-resident employer's payroll office withholds PAYE and UIF and pays them to SARS directly; the wage is
      // primary income from the rest of the world (compensation, but not the province's production).
      pay(F, { from: ROW, to: e, amount: net, day: world.day, month, ref: `PAY-${cal.isoDate.slice(0, 7)}`, memo: `Salary: ${fullName(p)}, ${JOBS[p.job].label} (the airline)`, flow: 'wages', fromAccount: '5210', toAccount: '4010', toExtra: [{ account: '5110', debit: paye }, { account: '5120', debit: uif }] });
      pay(F, { from: ROW, to: GOV, amount: paye, day: world.day, month, ref: `EMP201-${cal.isoDate.slice(0, 7)}`, memo: `PAYE withheld by the airline: ${fullName(p)}`, flow: 'tax', fromAccount: '5210', toAccount: '4131' });
      pay(F, { from: ROW, to: GOV, amount: r2(uif * 2), day: world.day, month, ref: `EMP201-${cal.isoDate.slice(0, 7)}`, memo: `UIF (employee and employer) from the airline: ${fullName(p)}`, flow: 'tax', fromAccount: '5210', toAccount: '4134' });
    } else pay(F, {
      from: employer,
      to: e,
      amount: net,
      day: world.day,
      month,
      ref: `PAY-${cal.isoDate.slice(0, 7)}`,
      memo: `Salary: ${fullName(p)}, ${JOBS[p.job].label}`,
      flow: 'wages',
      fromAccount: '5210',
      fromExtra: [
        { account: '5210', debit: r2(paye + uif) },
        { account: '5220', debit: uif },
        { account: '5230', debit: sdl },
        { account: '2200', credit: paye },
        { account: '2210', credit: r2(uif * 2) },
        { account: '2220', credit: sdl },
      ],
      toAccount: '4010',
      toExtra: [
        { account: '5110', debit: paye },
        { account: '5120', debit: uif },
      ],
    });
    F.payslips[p.id] = { personId: p.id, employer, gross, paye, uif, net, medicalBeneficiaries: beneficiaries };
    const rec = personYear(F, p, label);
    rec.months++;
    rec.remuneration = r2(rec.remuneration + gross);
    rec.paye = r2(rec.paye + paye);
    rec.uif = r2(rec.uif + uif);
    if (beneficiaries > 0) {
      rec.medicalBeneficiaries = beneficiaries;
      rec.medicalMonths++;
    }
    F.tax.payrollYtd[employer] = (F.tax.payrollYtd[employer] ?? 0) + gross;
    const h = (out.byHousehold[e] ??= { gross: 0, net: 0, paye: 0, uif: 0 });
    h.gross += gross;
    h.net += net;
    h.paye += paye;
    h.uif += uif;
    const em = (out.byEmployer[employer] ??= { gross: 0, count: 0 });
    em.gross += gross;
    em.count++;
    out.wages.push(gross);
    out.totalGross += gross;
  }
  return out;
}

function payGrants(ctx: Ctx, F: FinanceState, month: number, hhs: Household[]): Record<string, number> {
  const world = ctx.world;
  const M = F.macro;
  const out: Record<string, number> = {};
  for (const hh of hhs) {
    const members = householdMembers(world, hh.id);
    if (!members.length) continue;
    const earned = members.reduce((s, m) => s + m.income * M.wageIndex, 0);
    const perCapita = earned / members.length;
    let child = 0;
    let older = 0;
    let amount = 0;
    for (const m of members) {
      if (m.age < 18 && perCapita < M.povertyLine * 2.5) {
        child++;
        amount += M.grants.child;
      }
      if (m.age >= 60 && m.income === 0) {
        older++;
        amount += m.age >= 75 ? M.grants.oldAge75 : M.grants.oldAge;
      }
    }
    if (amount <= 0) continue;
    const e = hhEntity(hh.id);
    pay(F, { from: GOV, to: e, amount, day: world.day, month, ref: `SASSA-${ctx.cal.isoDate.slice(0, 7)}`, memo: `SASSA grants: ${child ? `${child} child support` : ''}${child && older ? ', ' : ''}${older ? `${older} older persons` : ''}`, flow: 'grants', fromAccount: '5330', toAccount: '4020' });
    out[e] = amount;
  }
  return out;
}

function activeLoans(F: FinanceState, e: string) {
  return Object.values(F.bank.loans).filter((l) => l.status === 'active' && l.borrower === e);
}

/** Elected councillors draw a monthly stipend from the district's public purse, PAYE withheld at the marginal rate. */
function payCouncilStipends(ctx: Ctx, F: FinanceState, month: number): Record<string, number> {
  const world = ctx.world;
  const T = F.tax.tables;
  const label = taxYearLabel(ctx.cal);
  const out: Record<string, number> = {};
  const gross = r2(ctx.params.councilStipend * F.macro.wageIndex);
  if (gross <= 0) return out;
  for (const seat of world.council) {
    if (seat.role === 'health') continue; // the DMO's public salary already carries the duty
    const p = seat.personId ? world.people[seat.personId] : null;
    if (!p || !p.alive || p.away) continue;
    const hh = world.households[p.householdId];
    if (!hh || hh.dissolvedDay) continue;
    const slip = F.payslips[p.id];
    const salGross = slip?.gross ?? 0;
    const beneficiaries = slip?.medicalBeneficiaries ?? 0;
    const paye = r2(Math.max(0, payeMonthly(salGross + gross, p.age, T, beneficiaries) - payeMonthly(salGross, p.age, T, beneficiaries)));
    const net = r2(gross - paye);
    const e = hhEntity(hh.id);
    pay(F, {
      from: GOV,
      to: e,
      amount: net,
      day: world.day,
      month,
      ref: `STIP-${ctx.cal.isoDate.slice(0, 7)}`,
      memo: `Council stipend: ${fullName(p)}, ${seat.title}`,
      flow: 'wages',
      fromAccount: '5345',
      fromExtra: [
        { account: '5345', debit: paye },
        { account: '2200', credit: paye },
      ],
      toAccount: '4025',
      toExtra: [{ account: '5110', debit: paye }],
    });
    const rec = personYear(F, p, label);
    if (!slip) rec.months++;
    rec.remuneration = r2(rec.remuneration + gross);
    rec.paye = r2(rec.paye + paye);
    out[e] = (out[e] ?? 0) + net;
  }
  return out;
}

function planBudgets(ctx: Ctx, F: FinanceState, month: number, hhs: Household[], payroll: Payroll, grants: Record<string, number>, stipends: Record<string, number>, cpiF: number, rng: ReturnType<Ctx['rng']['stream']>): Budget[] {
  const world = ctx.world;
  const P = ctx.params;
  const M = F.macro;
  const ins = world.insurance;
  const out: Budget[] = [];
  for (const hh of hhs) {
    const members = householdMembers(world, hh.id);
    if (!members.length) continue;
    const e = hhEntity(hh.id);
    const book = F.ledgers.books[e];
    const pr = payroll.byHousehold[e] ?? { gross: 0, net: 0, paye: 0, uif: 0 };
    const vendorNet = members.filter((m) => m.job === 'vendor' && !m.away).reduce((s, m) => s + Math.round(m.income * M.wageIndex), 0);
    // Driver-partners expect last month's takings less the service fee, fuel, the rent and the phone.
    const rideNet = members.filter((m) => m.job === 'ehailer' && !m.away).reduce((s, m) => s + Math.max(0, m.income), 0);
    const ownAccount = vendorNet + rideNet;
    const grantsAmt = grants[e] ?? 0;
    const stipendAmt = stipends[e] ?? 0;
    const other = month > 0 ? movement(book, '4090', month - 1, month - 1) + movement(book, '4110', month - 1, month - 1) + movement(book, '4120', month - 1, month - 1) + movement(book, '4030', month - 1, month - 1) : 0;
    const disposable = r2(pr.net + ownAccount + stipendAmt + grantsAmt + other);
    const hasCar = !!hh.vehicleId;
    const medical = hh.insurance.medical;
    let needs = 0;
    for (const m of members) needs += m.age < 15 ? M.childCost : M.adultCost;
    // Keeping a car on the road: petrol at the pump price, the rest with inflation.
    if (hasCar) needs += 1_800 * (0.55 * (F.markets.petrol / F.markets.base.petrol) + 0.45 * cpiF);
    if (medical) needs += members.length * 900 * cpiF;
    needs = r2(needs);
    const surplus = Math.max(0, disposable - needs);
    // Households spend about 78% of what they earn above basic needs; dearer money trims that (the monetary transmission channel).
    const realPrime = M.prime - M.inflYoY;
    const mpc = clamp(0.78 - 0.5 * (realPrime - (M.neutralReal + 0.035)), 0.62, 0.9);
    let consumption = r2(needs + mpc * surplus);
    const church = landmark(comOf(world, hh), 'church');
    let tithe = church ? r2((P.titheRate * (pr.net + ownAccount + stipendAmt) + 0.02 * grantsAmt) * clamp(hh.faith, 0, 1)) : 0;
    let prem = 0;
    if (hh.insurance.funeral) prem += Math.round(P.funeralPremium * cpiF);
    if (hh.insurance.life) prem += Math.round(P.lifeCoverPremium * cpiF) * members.filter((m) => m.age >= 18 && m.age < 65).length;
    if (ins.ruined) prem = 0;
    const loanService = r2(activeLoans(F, e).filter((l) => l.startMonth < month).reduce((s, l) => s + l.instalment, 0));
    let avail = Math.max(0, deposits(F, e));
    let deprived = false;
    const total = consumption + tithe + prem + loanService;
    if (avail < total) {
      const shortfall = total - avail;
      const structural = needs + loanService > disposable;
      const hasLiving = activeLoans(F, e).some((l) => l.purpose === 'living costs');
      if (!hasLiving && shortfall > 500 && rng.bernoulli(structural ? 0.7 : 0.4)) {
        const amount = clamp(shortfall * 2, 2_000, 3 * needs);
        const d = requestLoan(F, e, amount, 'living costs', disposable, world.day, month, F.tax.tables.vatRate);
        if (d.approved) {
          avail = Math.max(0, deposits(F, e));
          ctx.emit({ kind: 'economy', severity: 'info', text: `The ${hh.name} household borrowed R${Math.round(d.loan!.principal).toLocaleString()} from ${F.bank.name} to cover living costs (${d.loan!.termMonths} months, R${Math.round(d.loan!.instalment).toLocaleString()} a month).`, householdId: hh.id });
        } else ctx.emit({ kind: 'economy', severity: 'alert', text: `${F.bank.name} declined the ${hh.name} household's loan application: ${d.reason}.`, householdId: hh.id });
      }
      let left = Math.max(0, avail - loanService);
      consumption = r2(Math.min(consumption, left));
      left -= consumption;
      if (prem > 0 && left < prem) {
        hh.arrears++;
        if (hh.arrears >= 3 && !ins.ruined) {
          hh.insurance.funeral = false;
          hh.insurance.life = false;
          ctx.emit({ kind: 'insurance', severity: 'alert', text: `The ${hh.name} household's scheme cover has lapsed after three months of arrears.`, householdId: hh.id });
        }
        prem = 0;
      } else hh.arrears = 0;
      left -= prem;
      tithe = r2(Math.max(0, Math.min(tithe, left)));
      deprived = consumption < needs * 0.98;
    } else hh.arrears = 0;
    const income = pr.gross + ownAccount + stipendAmt + grantsAmt;
    hh.monthlyIncome = Math.round(income);
    hh.monthlyExpenses = Math.round(consumption + prem + tithe + pr.paye + pr.uif + loanService);
    const pcIncome = income / members.length;
    hh.poor = pcIncome < M.povertyLine || deprived;
    for (const m of members) if (m.age >= 15) m.stress = clamp(m.stress + (hh.poor ? 0.06 : -0.02) + (deprived ? 0.05 : 0), 0, 1);
    if (!ins.ruined && !hh.insurance.funeral && avail > 20_000 * cpiF && rng.bernoulli(0.08)) hh.insurance.funeral = true;
    const fs = foodShare(pcIncome);
    const shopSpec = shopOf(comOf(world, hh));
    out.push({ hh, e, members, gross: pr.gross + ownAccount, netPay: pr.net + ownAccount, vendorNet, grants: grantsAmt, other, disposable, needs, consumption, tithe, prem, loanService, deprived, pcIncome, food: r2(consumption * fs), hasCar, medical, homeschool: hh.homeschool, zeroRated: hh.poor ? ZERO_RATED_POOR : ZERO_RATED, shop: shopSpec.id, church, shopSpec });
  }
  return out;
}

function farmYield(F: FinanceState, tempMax: number): number {
  const h = F.rainHistory;
  if (h.length < 4) return 1;
  const rain3 = h.slice(-3).reduce((s, x) => s + x, 0);
  const base = h.slice(-27, -3);
  const normal3 = Math.max(20, (3 * base.reduce((s, x) => s + x, 0)) / Math.max(1, base.length));
  let y = clamp(0.6 + 0.4 * Math.sqrt(rain3 / normal3), 0.5, 1.25);
  if (tempMax > 33) y *= 0.92;
  return r2(y);
}

interface MarketResult {
  localValue: number;
  importValue: number;
  exportValue: number;
  outputValue: number;
  yield: number;
  price: number;
}

function clearMarket(ctx: Ctx, F: FinanceState, month: number, budgets: Budget[], cpiF: number): MarketResult {
  const world = ctx.world;
  const T = F.tax.tables;
  let produceWholesale = 0;
  for (const b of budgets) {
    if (b.shop !== 'market') continue; // the deli and spaza restock town-side; fresh produce clears through the market
    const localFoodExcl = vatOnInclusive(b.food * LOCAL_FOOD_SHARE, 1 - b.zeroRated, T).excl;
    produceWholesale += localFoodExcl * PRODUCE_SHARE * FOOD_COGS;
  }
  const people = alivePeople(world);
  const farmer = people.some((p) => p.job === 'farmer' && !p.away);
  const hands = people.filter((p) => p.job === 'farmhand' && !p.away).length;
  const capacityTotal = (farmer ? FARM_OUTPUT_BASE : FARM_OUTPUT_BASE * 0.5) + FARM_OUTPUT_PER_HAND * hands;
  const y = farmYield(F, world.weather.tempMax);
  // The share of the farm's output sold locally is set once so the produce market opens in balance at the base price.
  if (F.micro.localShare === null) F.micro.localShare = clamp(produceWholesale / Math.max(1, capacityTotal), 0.05, FARM_LOCAL_SHARE_MAX);
  const localShare = F.micro.localShare;
  const mm = clearProduceMarket(F.micro, month, { isoDate: ctx.cal.isoDate, spend: produceWholesale, capacity: capacityTotal * localShare, yield: y, priceLevel: cpiF });
  const localValue = r2(mm.localSupply * mm.price);
  const importValue = r2(mm.imports * mm.importParity);
  const contract = capacityTotal * (1 - localShare) * y;
  const exportValue = r2(contract * mm.importParity * EXPORT_PARITY);
  const day = world.day;
  const ref = `MKT-${ctx.cal.isoDate.slice(0, 7)}`;
  if (localValue > 0) pay(F, { from: 'market', to: 'farm', amount: localValue, day, month, ref, memo: `Fresh produce bought from the farm at ${mm.price.toFixed(2)} × base price (${mm.localSupply.toFixed(0)} units)`, flow: 'purchases', fromAccount: '5200', toAccount: '4040' });
  if (importValue > 0) pay(F, { from: 'market', to: ROW, amount: importValue, day, month, ref, memo: `Produce brought in from the wholesaler at import parity (${mm.imports.toFixed(0)} units)`, flow: 'imports', fromAccount: '5200', toAccount: '4040' });
  if (exportValue > 0) pay(F, { from: ROW, to: 'farm', amount: exportValue, day, month, ref, memo: `Contract sales to the regional buyer (yield ${y.toFixed(2)})`, flow: 'exports', fromAccount: '5370', toAccount: '4040' });
  if (mm.imports > 0 && y < 0.75) ctx.emit({ kind: 'economy', severity: 'alert', text: `Poor rains cut the farm's yield to ${Math.round(y * 100)}%: produce prices at the shop rose to ${Math.round((mm.price - 1) * 100)}% above base and the shop is buying in from town.` });
  return { localValue, importValue, exportValue, outputValue: r2(localValue + exportValue), yield: y, price: mm.price };
}

/** The non-food, non-transport budget shares by household type (transport comes from the transport plan). */
function categoryShares(b: BudgetLike, cpiF: number): { housing: number; goods: number; education: number; health: number; other: number } {
  const members = b.members.length;
  const c = Math.max(1, b.consumption);
  const health = b.medical ? Math.min(0.35, (members * 900 * cpiF) / c + 0.02) : 0.03;
  return { housing: 0.2, goods: 0.09, education: b.homeschool ? 0.05 : 0.02, health, other: 0.08 };
}

interface Spent {
  byMode: Record<string, number>;
  rideGross: number;
  rideBooking: number;
  rideCommission: number;
  petrolLitres: number;
  transitRes: { bus: number; hyper: number; busTrips: number; hyperTrips: number };
}

function postConsumption(ctx: Ctx, F: FinanceState, month: number, budgets: Budget[], cpiF: number, tplan: TransportPlan): { totals: Totals; spent: Spent } {
  const T = F.tax.tables;
  const S = F.markets;
  const spent: Spent = { byMode: { taxi: 0, bus: 0, hyper: 0, ride: 0, fuel: 0, carOther: 0, out: 0, air: 0, taxiTrips: 0, taxiDieselLitres: 0 }, rideGross: 0, rideBooking: 0, rideCommission: 0, petrolLitres: 0, transitRes: { bus: 0, hyper: 0, busTrips: 0, hyperTrips: 0 } };
  const day = ctx.world.day;
  const ref = `SPEND-${ctx.cal.isoDate.slice(0, 7)}`;
  const totals: Totals = { vat: 0, fuelLevies: 0, rates: 0, marketFoodExcl: 0, marketGoodsExcl: 0, marketOtherExcl: 0, consumption: 0, tithes: 0, premiums: 0, investment: 0 };
  const vatRate = T.vatRate;
  // Informal traders: their expected takings come out of what households would otherwise buy in town.
  const vendors = budgets.filter((b) => b.vendorNet > 0);
  const vendorSales = vendors.reduce((s, b) => s + b.vendorNet / VENDOR_MARGIN, 0);
  const townPool = budgets.reduce((s, b) => s + b.food * (1 - LOCAL_FOOD_SHARE) + b.consumption * 0.05, 0);
  const vendorShare = townPool > 0 ? Math.min(0.6, vendorSales / townPool) : 0;
  const vendorTake: Record<string, number> = {};
  for (const b of budgets) {
    const c0 = b.consumption;
    if (c0 <= 0) continue;
    const members = b.members.length;
    // Tickets for a day flown on a Saturday come first; the categories share what is left.
    const ht: HouseholdTransport | undefined = tplan.byHousehold[b.e];
    const air = ht?.air ?? 0;
    const c = c0 - air;
    // Category shares (Engel's law for food; transport from the transport plan; the rest by household type)
    const fs = Math.min(0.95, b.food / c);
    const raw = { ...categoryShares(b, cpiF), transport: ht?.share ?? (b.hasCar ? 0.17 : 0.1) };
    const rest = Object.values(raw).reduce((s, x) => s + x, 0);
    const k = (1 - fs) / rest;
    const A: BatchItem[] = [];
    const shopVatable = !!F.entities[b.shop]?.vatRegistered;
    const vatOut = (amountIncl: number, stdShare: number) => {
      const { excl, vat } = vatOnInclusive(amountIncl, stdShare, T);
      totals.vat += vat;
      return { excl, vat };
    };
    // A spaza below the VAT threshold charges no output VAT; the price is the price.
    const shopOut = (amountIncl: number, stdShare: number) => (shopVatable ? vatOut(amountIncl, stdShare) : { excl: amountIncl, vat: 0 });
    // Food
    const food = b.food;
    // A township buys nearly everything at the spaza; the estates lean on the deli.
    const localFoodShare = b.shopSpec.localFood ?? LOCAL_FOOD_SHARE;
    const localGoodsShare = b.shopSpec.localGoods ?? 0.5;
    const localFood = food * localFoodShare;
    {
      const { excl, vat } = shopOut(localFood, 1 - b.zeroRated);
      if (b.shop === 'market') totals.marketFoodExcl += excl;
      A.push({ to: b.shop, amount: localFood, fromAccount: '5010', toAccount: '4040', toExtra: vat > 0 ? [{ account: '2230', credit: vat }] : undefined, flow: 'consumption' });
      const townFood = food - localFood;
      const fromVendors = townFood * vendorShare;
      if (fromVendors > 0 && vendors.length) {
        const w = vendors.reduce((s, v) => s + v.vendorNet, 0);
        for (const v of vendors) {
          const amt = (fromVendors * v.vendorNet) / w;
          if (v.e === b.e) continue;
          A.push({ to: v.e, amount: amt, fromAccount: '5010', toAccount: '4040', flow: 'consumption' });
          vendorTake[v.e] = (vendorTake[v.e] ?? 0) + amt;
        }
      }
      const town = vatOut(townFood - fromVendors, 1 - b.zeroRated);
      A.push({ to: ROW, amount: town.excl, fromAccount: '5010', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: town.vat, fromAccount: '5010', toAccount: '4132', flow: 'tax' });
    }
    // Housing, rates and utilities
    {
      const h = c * raw.housing * k;
      const rates = h * 0.12;
      totals.rates += rates;
      A.push({ to: GOV, amount: rates, fromAccount: '5020', toAccount: '4150', flow: 'tax' });
      A.push({ to: cityWorkshop(ctx.world, b.hh), amount: h * 0.15, fromAccount: '5020', toAccount: '4050', flow: 'consumption' });
      const u = vatOut(h * 0.73, 0.5);
      A.push({ to: ROW, amount: u.excl, fromAccount: '5020', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: u.vat, fromAccount: '5020', toAccount: '4132', flow: 'tax' });
    }
    // Transport: by the mode shares of the transport plan (transport.ts)
    {
      const t = c * raw.transport * k;
      const sp = ht?.split ?? (b.hasCar ? { out: 0, taxi: 0, bus: 0, hyper: 0, ride: 0, fuel: 0.65, carOther: 0.35 } : { out: 0.4, taxi: 0.6, bus: 0, hyper: 0, ride: 0, fuel: 0, carOther: 0 });
      const fare = ht?.fare ?? { taxi: 15, bus: 14, hyper: 20, ride: 40 };
      const by = spent.byMode;
      // Petrol at the pump: the levies to SARS, the rest (import parity, margins) to the rest of the economy.
      const fuel = t * sp.fuel;
      if (fuel > 0) {
        const litres = fuel / S.petrol;
        const levy = litres * levyPerLitre(S, 'petrol');
        totals.fuelLevies += levy;
        spent.petrolLitres += litres;
        by.fuel += fuel;
        A.push({ to: GOV, amount: levy, fromAccount: '5030', toAccount: '4136', flow: 'tax' });
        A.push({ to: ROW, amount: fuel - levy, fromAccount: '5030', toAccount: '4040', flow: 'imports' });
      }
      const carOther = t * sp.carOther;
      if (carOther > 0) {
        by.carOther += carOther;
        A.push({ to: ROW, amount: carOther, fromAccount: '5030', toAccount: '4040', flow: 'imports' });
      }
      // Beyond the province: the long-distance minibus taxi from the city's rank, or an intercity coach.
      const out = t * sp.out;
      if (out > 0) {
        by.out += out;
        A.push({ to: cityTaxi(ctx.world, b.hh), amount: out * OUT_TAXI, fromAccount: '5030', toAccount: '4050', flow: 'consumption' });
        A.push({ to: ROW, amount: out * (1 - OUT_TAXI), fromAccount: '5030', toAccount: '4040', flow: 'imports' });
      }
      // Minibus taxi fares to the city's association; bus and Hyperline fares to Unity Transit (passenger fares are VAT-exempt).
      const taxi = t * sp.taxi;
      if (taxi > 0) {
        by.taxi += taxi;
        by.taxiTrips += taxi / Math.max(1, fare.taxi);
        A.push({ to: cityTaxi(ctx.world, b.hh), amount: taxi, fromAccount: '5030', toAccount: '4050', flow: 'consumption' });
      }
      const bus = t * sp.bus;
      const hyper = t * sp.hyper;
      if (bus + hyper > 0) {
        by.bus += bus;
        by.hyper += hyper;
        spent.transitRes.bus += bus;
        spent.transitRes.hyper += hyper;
        spent.transitRes.busTrips += bus / Math.max(1, fare.bus);
        spent.transitRes.hyperTrips += hyper / Math.max(1, fare.hyper);
        A.push({ to: 'transit', amount: bus + hyper, fromAccount: '5030', toAccount: '4050', flow: 'consumption' });
      }
      // E-hailing: the app collects the fare as agent — the driver's 75% is held for payout, the service fee and the
      // booking fee are its revenue (standard-rated; the fare itself is exempt passenger transport).
      const ride = t * sp.ride;
      if (ride > 0) {
        const trips = ride / Math.max(1, fare.ride);
        const booking = trips * F.transport.fares.ride.booking;
        const gross = ride - booking;
        const fee = gross * COMMISSION + booking;
        const vat = (fee * T.vatRate) / (1 + T.vatRate);
        by.ride += ride;
        spent.rideGross += gross;
        spent.rideBooking += booking;
        spent.rideCommission += gross * COMMISSION;
        totals.vat += vat;
        A.push({ to: 'hamba', amount: ride, fromAccount: '5030', toAccount: '2010', toExtra: [{ account: '2010', debit: r2(fee) }, { account: '4100', credit: r2(fee - vat) }, { account: '2230', credit: r2(vat) }], flow: 'consumption' });
      }
      // A day flown on a Saturday: the carrier's fare, surcharge and passenger service charge, VAT on top.
      if (air > 0) {
        const v = r2((air * T.vatRate) / (1 + T.vatRate));
        by.air += air;
        totals.vat += v;
        A.push({ to: ROW, amount: r2(air - v), fromAccount: '5030', toAccount: '4040', flow: 'imports' });
        A.push({ to: GOV, amount: v, fromAccount: '5030', toAccount: '4132', flow: 'tax' });
      }
    }
    // Clothing and household goods
    {
      const g = c * raw.goods * k;
      const local = shopOut(g * localGoodsShare, 1);
      if (b.shop === 'market') totals.marketGoodsExcl += local.excl;
      A.push({ to: b.shop, amount: g * localGoodsShare, fromAccount: '5040', toAccount: '4040', toExtra: local.vat > 0 ? [{ account: '2230', credit: local.vat }] : undefined, flow: 'consumption' });
      const town = vatOut(g * (1 - localGoodsShare), 1);
      A.push({ to: ROW, amount: town.excl, fromAccount: '5040', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: town.vat, fromAccount: '5040', toAccount: '4132', flow: 'tax' });
    }
    // Education
    {
      const ed = vatOut(c * raw.education * k, 0.5);
      A.push({ to: ROW, amount: ed.excl, fromAccount: '5050', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: ed.vat, fromAccount: '5050', toAccount: '4132', flow: 'tax' });
    }
    // Health: medical scheme contributions (exempt) and other care
    {
      const h = c * raw.health * k;
      const premium = b.medical ? Math.min(h, members * 900 * cpiF) : 0;
      A.push({ to: ROW, amount: premium, fromAccount: '5060', toAccount: '4040', flow: 'imports' });
      const o = vatOut(h - premium, 0.5);
      A.push({ to: ROW, amount: o.excl, fromAccount: '5060', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: o.vat, fromAccount: '5060', toAccount: '4132', flow: 'tax' });
    }
    // Communication and other
    {
      const o = c * raw.other * k;
      const local = shopOut(o * localGoodsShare, 1);
      if (b.shop === 'market') totals.marketOtherExcl += local.excl;
      A.push({ to: b.shop, amount: o * localGoodsShare, fromAccount: '5070', toAccount: '4040', toExtra: local.vat > 0 ? [{ account: '2230', credit: local.vat }] : undefined, flow: 'consumption' });
      const town = vatOut(o * (1 - localGoodsShare), 1);
      A.push({ to: ROW, amount: town.excl, fromAccount: '5070', toAccount: '4040', flow: 'imports' });
      A.push({ to: GOV, amount: town.vat, fromAccount: '5070', toAccount: '4132', flow: 'tax' });
    }
    payBatch(F, b.e, day, month, ref, `Household spending for ${ctx.cal.isoDate.slice(0, 7)}`, A, 'consumption');
    totals.consumption += c0;
  }
  // The traders restock from the wholesaler (their takings less the margin).
  for (const v of vendors) {
    const sales = vendorTake[v.e] ?? 0;
    const cost = r2(sales * (1 - VENDOR_MARGIN));
    if (cost > 0) pay(F, { from: v.e, to: ROW, amount: cost, day, month, ref, memo: 'Stock for the market stall from the wholesaler', flow: 'imports', fromAccount: '5200', toAccount: '4040' });
  }
  for (const b of budgets) {
    if (b.tithe > 0 && b.church) {
      pay(F, { from: b.e, to: b.church, amount: b.tithe, day, month, ref: `TITHE-${ctx.cal.isoDate.slice(0, 7)}`, memo: 'Tithes and offerings', flow: 'tithes', fromAccount: '5080', toAccount: '4060' });
      totals.tithes += b.tithe;
      const label = taxYearLabel(ctx.cal);
      const head = b.members.find((m) => m.id === b.hh.headId) ?? b.members[0];
      if (head) personYear(F, head, label).donations = r2(personYear(F, head, label).donations + b.tithe);
    }
    if (b.prem > 0) {
      pay(F, { from: b.e, to: SCHEME, amount: b.prem, day, month, ref: `PREM-${ctx.cal.isoDate.slice(0, 7)}`, memo: 'Burial and life society premiums', flow: 'premiums', fromAccount: '5090', toAccount: '4070' });
      totals.premiums += b.prem;
    }
  }
  return { totals, spent };
}

/** Big-ticket household decisions: a car on finance, a home improvement with the builder. */
function investmentDecisions(ctx: Ctx, F: FinanceState, month: number, budgets: Budget[], totals: Totals, cpiF: number, rng: ReturnType<Ctx['rng']['stream']>): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const day = world.day;
  const ym = ctx.cal.isoDate.slice(0, 7);
  for (const b of budgets) {
    const hh = b.hh;
    const savings = Math.max(0, deposits(F, b.e));
    // A car: a household without one, with a driver, a solid income and a third of the price saved.
    const drivers = b.members.filter((m) => m.age >= 18 && m.age < 75);
    if (!hh.vehicleId && drivers.length && b.disposable > 12_000 * cpiF && rng.bernoulli(0.02)) {
      const bakkie = rng.bernoulli(0.3);
      const price = Math.round((bakkie ? 180_000 : 120_000) * cpiF);
      const depositShare = 0.3;
      if (savings >= price * depositShare) {
        let financed = 0;
        if (savings < price) {
          const d = requestLoan(F, b.e, price - Math.min(savings, price * 0.5), 'vehicle finance', b.disposable, day, month, T.vatRate);
          if (!d.approved) continue;
          financed = d.loan!.principal;
        }
        const { excl, vat } = vatOnInclusive(price, 1, T);
        payBatch(F, b.e, day, month, `CAR-${ym}`, `${bakkie ? 'Bakkie' : 'Car'} bought${financed ? ' on finance' : ' for cash'}`, [
          { to: ROW, amount: excl, fromAccount: '1510', toAccount: '4040', flow: 'imports' },
          { to: GOV, amount: vat, fromAccount: '1510', toAccount: '4132', flow: 'tax' },
        ], 'consumption');
        totals.vat += vat;
        totals.consumption += price;
        const house = world.buildings[hh.houseId];
        // Beside any car already in the yard (a household's own, or an e-hailing car kept there).
        const park = freeYardSlot(world, house);
        const v = createVehicle(ctx, hh.id, bakkie ? 'bakkie' : 'car', park.x, park.y);
        hh.vehicleId = v.id;
        for (const d of drivers) d.driver = true;
        ctx.emit({ kind: 'economy', severity: 'joy', text: `The ${hh.name} household bought a ${bakkie ? 'bakkie' : 'car'} for R${price.toLocaleString()}${financed ? ` with R${Math.round(financed).toLocaleString()} of vehicle finance from ${F.bank.name}` : ''}.`, householdId: hh.id });
        continue;
      }
    }
    // A home improvement built by the workshop (dwelling investment), half on a loan.
    if (b.disposable > 9_000 * cpiF && savings > 20_000 * cpiF && rng.bernoulli(0.006)) {
      const cost = Math.round(rng.range(25_000, 60_000) * cpiF);
      let financed = 0;
      if (savings < cost) {
        const d = requestLoan(F, b.e, cost - savings * 0.6, 'home improvement', b.disposable, day, month, T.vatRate);
        if (!d.approved) continue;
        financed = d.loan!.principal;
      }
      pay(F, { from: b.e, to: cityWorkshop(world, hh), amount: cost, day, month, ref: `BUILD-${ym}`, memo: 'Home improvement built by the workshop', flow: 'purchases', fromAccount: '1500', toAccount: '4050' });
      totals.investment += cost;
      ctx.emit({ kind: 'economy', severity: 'info', text: `The ${hh.name} household is extending its home: R${cost.toLocaleString()} of work for the workshop${financed ? `, R${Math.round(financed).toLocaleString()} of it borrowed` : ''}.`, householdId: hh.id });
    }
  }
}

/**
 * Debt relief for a household whose overdraft the family plainly cannot repay
 * (funeral costs without cover, a failed loan): the bank writes it off — its
 * loss, priced by the overdraft interest charged until now — and the household
 * starts afresh with a 24-month bar on new credit. Without this, a hole dug in
 * year 40 compounds at the business rate into the billions by year 80.
 */
function householdRelief(ctx: Ctx, F: FinanceState, month: number, cpiF: number): void {
  const world = ctx.world;
  const day = world.day;
  for (const hh of Object.values(world.households)) {
    if (hh.dissolvedDay || !hh.memberIds.length) continue;
    const e = hhEntity(hh.id);
    if (!F.ledgers.books[e]) continue;
    const cash = deposits(F, e);
    const limit = Math.max(6 * Math.max(hh.monthlyIncome, 1_000), 60_000 * cpiF);
    if (cash >= -limit) continue;
    const wo = r2(-cash);
    pay(F, { from: BANK, to: e, amount: wo, day, month, ref: `RELIEF-${hh.id}-${month}`, memo: `Debt relief for the ${hh.name} household: the overdraft written off by the bank`, flow: 'losses', fromAccount: '5280', toAccount: '4900' });
    F.bank.stats.writtenOffAmount += wo;
    F.bank.blocked[e] = month + 24;
    ctx.emit({ kind: 'economy', severity: 'alert', text: `${F.bank.name} wrote off the ${hh.name} household's overdraft of R${Math.round(wo).toLocaleString()} under debt relief; no new credit for two years.`, householdId: hh.id });
    F.log.push({ day, kind: 'bank', text: `Debt relief: ${hh.name} household, overdraft R${Math.round(wo).toLocaleString()} written off.`, entity: e });
  }
}

/** Businesses: an overdraft-style working-capital loan when cash runs short; the farm replaces its tractor on finance. */
function businessFinancing(ctx: Ctx, F: FinanceState, month: number, cpiF: number, rng: ReturnType<Ctx['rng']['stream']>): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const day = world.day;
  for (const id of BUSINESSES.map((b) => b.id)) {
    const book = F.ledgers.books[id];
    if (!book) continue;
    const cash = deposits(F, id);
    const revenue = movement(book, '4040', month, month) + movement(book, '4050', month, month) + movement(book, '4060', month, month);
    if (cash < -100) {
      const d = requestLoan(F, id, -cash + 0.5 * revenue, 'working capital', revenue, day, month, T.vatRate);
      if (d.approved) ctx.emit({ kind: 'economy', severity: 'info', text: `${F.entities[id].name} took a working-capital loan of R${Math.round(d.loan!.principal).toLocaleString()} from ${F.bank.name}.` });
      else ctx.emit({ kind: 'economy', severity: 'alert', text: `${F.entities[id].name} is short of cash and ${F.bank.name} declined a working-capital loan (${d.reason}).` });
    }
    // Business rescue: an overdraft the trade can plainly never repay is written off by the bank
    // (its loss, priced by the overdraft interest until now) and the business restructures.
    const limit = Math.max(6 * Math.max(revenue, 1_000), 20_000 * cpiF);
    const after = deposits(F, id);
    if (after < -limit) {
      const wo = r2(-after);
      pay(F, { from: BANK, to: id, amount: wo, day, month, ref: `RESCUE-${id}-${month}`, memo: `Business rescue of ${F.entities[id].name}: the overdraft written off by the bank`, flow: 'losses', fromAccount: '5280', toAccount: '4900' });
      F.bank.stats.writtenOffAmount += wo;
      F.bank.blocked[id] = month + 24;
      ctx.emit({ kind: 'economy', severity: 'danger', text: `${F.entities[id].name} went through business rescue: ${F.bank.name} wrote off its overdraft of R${Math.round(wo).toLocaleString()} and it starts afresh.` });
      F.log.push({ day, kind: 'bank', text: `Business rescue: ${F.entities[id].name}, overdraft R${Math.round(wo).toLocaleString()} written off.`, entity: id });
    }
  }
  for (const spec of BUSINESSES.filter((b) => b.kind === 'farm')) {
    const farm = F.ledgers.books[spec.id];
    if (!farm) continue;
    const scale = (spec.opening['1500'] ?? 600_000) / 600_000;
    const nbv = natural(farm, '1500') - natural(farm, '1590');
    const cost = Math.round(400_000 * scale * cpiF);
    if (nbv < 0.35 * 600_000 * scale * cpiF && rng.bernoulli(0.02)) {
      const revenue = movement(farm, '4040', month, month);
      const d = requestLoan(F, spec.id, 0.75 * cost, 'equipment finance', revenue, day, month, T.vatRate);
      if (d.approved && deposits(F, spec.id) >= cost * 1.15) {
        payBatch(F, spec.id, day, month, `CAPEX-${ctx.cal.isoDate.slice(0, 7)}`, 'New tractor and implements', [{ to: ROW, amount: cost, fromAccount: '1500', toAccount: '4040', fromExtra: spec.vatRegistered ? vatInput(cost, T) : [], flow: 'imports' }], 'purchases');
        ctx.emit({ kind: 'economy', severity: 'info', text: `${F.entities[spec.id].name} bought a new tractor for R${cost.toLocaleString()} with equipment finance from ${F.bank.name}.` });
      }
    }
  }
}

function vatInput(amountExcl: number, T: { vatRate: number }, share = 1): Array<{ account: string; debit?: number; credit?: number }> {
  const v = r2(amountExcl * share * T.vatRate);
  return v > 0 ? [{ account: '2230', debit: v }] : [];
}

function depreciate(F: FinanceState, entity: string, day: number, month: number, monthly: number): void {
  const book = F.ledgers.books[entity];
  const nbv = natural(book, '1500') + natural(book, '1510') - natural(book, '1590');
  const d = r2(Math.min(monthly, Math.max(0, nbv)));
  if (d > 0) postInternal(F, entity, day, month, `DEP-${month}`, 'Depreciation, straight line', [{ account: '5250', debit: d }, { account: '1590', credit: d }], 'other');
}

function businessMonth(ctx: Ctx, F: FinanceState, month: number, budgets: Budget[], totals: Totals, market: MarketResult, payroll: Payroll, cpiF: number, rng: ReturnType<Ctx['rng']['stream']>, spent: Spent): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const day = world.day;
  const ym = ctx.cal.isoDate.slice(0, 7);
  const people = alivePeople(world);
  const staffAt = (job: string, wp: string) => people.filter((p) => p.job === job && p.workplaceId === wp && !p.away).length;
  // ── The produce hub: the Ebenezer market restocks from the farm and the wholesaler ──
  {
    const produceCost = market.localValue + market.importValue;
    const produceRetail = produceCost / FOOD_COGS;
    const processed = Math.max(0, (totals.marketFoodExcl - produceRetail) * FOOD_COGS);
    const goods = totals.marketGoodsExcl * GOODS_COGS;
    const other = totals.marketOtherExcl * OTHER_COGS;
    const items: BatchItem[] = [
      { to: ROW, amount: r2(processed), fromAccount: '5200', toAccount: '4040', fromExtra: vatInput(processed, T, 0.75), flow: 'imports' },
      { to: ROW, amount: r2(goods), fromAccount: '5200', toAccount: '4040', fromExtra: vatInput(goods, T), flow: 'imports' },
      { to: ROW, amount: r2(other), fromAccount: '5200', toAccount: '4040', fromExtra: vatInput(other, T), flow: 'imports' },
      { to: ROW, amount: r2(2_800 * cpiF), fromAccount: '5270', toAccount: '4040', fromExtra: vatInput(2_800 * cpiF, T), flow: 'imports' },
      { to: GOV, amount: r2(500 * cpiF), fromAccount: '5270', toAccount: '4150', flow: 'tax' },
    ];
    payBatch(F, 'market', day, month, `PUR-${ym}`, 'Stock from the wholesaler, electricity and rates', items, 'purchases');
    depreciate(F, 'market', day, month, BUSINESS.market.dep ?? 150_000 / 120);
  }
  // ── Every other shop, the delis, the spazas and the mall restock on their own sales ──
  for (const shop of BUSINESSES.filter((b) => (b.kind === 'shop' || b.kind === 'mall') && b.id !== 'market')) {
    const book = F.ledgers.books[shop.id];
    if (!book) continue;
    const sales = movement(book, '4040', month, month);
    const stock = r2(sales * (shop.cogs ?? 0.7));
    const over = r2((shop.overhead ?? 1_000) * cpiF);
    if (shop.vatRegistered) {
      payBatch(F, shop.id, day, month, `PUR-${ym}`, 'Stock from the wholesaler and running costs', [
        { to: ROW, amount: stock, fromAccount: '5200', toAccount: '4040', fromExtra: vatInput(stock, T, 0.8), flow: 'imports' },
        { to: ROW, amount: over, fromAccount: '5270', toAccount: '4040', fromExtra: vatInput(over, T), flow: 'imports' },
      ], 'purchases');
    } else {
      const st = vatOnInclusive(stock, 0.8, T);
      const ov = vatOnInclusive(over, 1, T);
      payBatch(F, shop.id, day, month, `PUR-${ym}`, 'Stock from the cash-and-carry (VAT not recoverable: not a vendor)', [
        { to: ROW, amount: r2(st.excl + ov.excl), fromAccount: '5200', toAccount: '4040', flow: 'imports' },
        { to: GOV, amount: r2(st.vat + ov.vat), fromAccount: '5200', toAccount: '4132', flow: 'tax' },
      ], 'purchases');
      totals.vat += st.vat + ov.vat;
    }
    depreciate(F, shop.id, day, month, shop.dep ?? 1_000);
  }
  // Passing trade: commuters and the school run at the general dealers, travellers at the delis, the whole region at the mall.
  for (const shop of BUSINESSES.filter((b) => (b.kind === 'market' || b.kind === 'shop' || b.kind === 'mall') && (b.walkIn ?? 0) > 0)) {
    if (!F.ledgers.books[shop.id]) continue;
    const walkIn = r2((shop.walkIn ?? 0) * cpiF);
    const vat = shop.vatRegistered ? r2(walkIn * T.vatRate) : 0;
    pay(F, { from: ROW, to: shop.id, amount: r2(walkIn + vat), day, month, ref: `WLK-${ym}`, memo: shop.kind === 'mall' ? 'Sales to shoppers from across the region and beyond' : 'Walk-in sales to travellers passing through', flow: 'exports', fromAccount: '5370', toAccount: '4040', toExtra: vat > 0 ? [{ account: '2230', credit: vat }] : undefined });
  }
  // ── The chambers: professional fees from the region and from their city's firms ──
  for (const prac of BUSINESSES.filter((b) => b.kind === 'practice')) {
    if (!F.ledgers.books[prac.id]) continue;
    const pros = people.filter((p) => (p.job === 'attorney' || p.job === 'accountant') && p.workplaceId === prac.id && !p.away).length;
    const retainers = r2(pros * (prac.retainer ?? 50_000) * cpiF);
    if (retainers > 0) {
      const vat = r2(retainers * T.vatRate);
      pay(F, { from: ROW, to: prac.id, amount: r2(retainers + vat), day, month, ref: `FEE-${ym}`, memo: 'Retainers and briefs from clients in the region (standard-rated)', flow: 'exports', fromAccount: '5370', toAccount: '4050', toExtra: [{ account: '2230', credit: vat }] });
    }
    // Ithemba's firms brief the regional chambers at the centre.
    const clientCity = prac.city === 'unity' ? 'ithemba' : prac.city;
    for (const client of businessesIn(clientCity, ['market', 'shop', 'farm', 'office', 'combank', 'mall'])) {
      if (!F.ledgers.books[client.id] || !client.vatRegistered) continue;
      const feeExcl = r2((client.kind === 'shop' ? 1_500 : 2_500) * cpiF);
      const vat = r2(feeExcl * T.vatRate);
      pay(F, { from: client.id, to: prac.id, amount: r2(feeExcl + vat), day, month, ref: `FEE-${ym}`, memo: `Accounting, audit and legal retainer: ${F.entities[prac.id].name}`, flow: 'purchases', fromAccount: '5320', fromExtra: [{ account: '2230', debit: vat }, { account: '5320', credit: vat }], toAccount: '4050', toExtra: [{ account: '2230', credit: vat }] });
    }
    payBatch(F, prac.id, day, month, `PUR-${ym}`, 'Chambers running costs', [{ to: ROW, amount: r2((prac.running ?? 6_500) * cpiF), fromAccount: '5320', toAccount: '4040', fromExtra: vatInput((prac.running ?? 6_500) * cpiF, T), flow: 'imports' }], 'purchases');
    depreciate(F, prac.id, day, month, prac.dep ?? 3_500);
  }
  // ── The taxi associations: fares came in through household transport; diesel, washing and rank fees go out ──
  // Diesel is 42% of the fare box at the start; the share moves with the pump price against the fares the associations charge.
  const Tr = F.transport;
  const Mk = F.markets;
  const taxiFareIdx = (Tr.fares.taxiBase + 3 * Tr.fares.taxiPerKm) / (Tr.base.taxiBase + 3 * Tr.base.taxiPerKm);
  const dieselShare = clamp((0.42 * (Mk.dieselRetail / Mk.base.dieselRetail)) / taxiFareIdx, 0.2, 0.75);
  for (const taxi of BUSINESSES.filter((b) => b.kind === 'taxi')) {
    if (!F.ledgers.books[taxi.id]) continue;
    const drivers = staffAt('taxidriver', taxi.id);
    const route = r2(drivers * (taxi.routeFares ?? 15_000) * taxiFareIdx);
    if (route > 0) pay(F, { from: ROW, to: taxi.id, amount: route, day, month, ref: `RTE-${ym}`, memo: 'Long-distance and town-route fares collected outside the region', flow: 'exports', fromAccount: '5370', toAccount: '4050' });
    const fares = movement(F.ledgers.books[taxi.id], '4050', month, month);
    const diesel = r2(fares * dieselShare);
    const litres = diesel / Mk.dieselRetail;
    const levy = r2(litres * levyPerLitre(Mk, 'diesel'));
    spent.byMode.taxiDieselLitres += litres;
    if (fares > 0) {
      payBatch(F, taxi.id, day, month, `PUR-${ym}`, 'Diesel, parts and rank fees', [
        { to: GOV, amount: levy, fromAccount: '5200', toAccount: '4136', flow: 'tax' },
        { to: ROW, amount: r2(diesel - levy), fromAccount: '5200', toAccount: '4040', flow: 'imports' },
        { to: ROW, amount: r2(fares * 0.08), fromAccount: '5270', toAccount: '4040', flow: 'imports' },
      ], 'purchases');
      totals.fuelLevies += levy;
    }
    depreciate(F, taxi.id, day, month, taxi.dep ?? 7_300);
  }
  // ── The commercial banks: service fees from their city's firms, the public purse and the Mutual Bank ──
  for (const cb of BUSINESSES.filter((b) => b.kind === 'combank')) {
    if (!F.ledgers.books[cb.id]) continue;
    const clientCities = cb.city === 'emmaus' ? ['emmaus', 'ithemba', 'unity'] : [cb.city];
    for (const city of clientCities) {
      for (const client of businessesIn(city as 'emmaus', ['market', 'shop', 'farm', 'office', 'practice', 'mall'])) {
        if (!F.ledgers.books[client.id] || !client.vatRegistered) continue;
        const feeExcl = r2(600 * cpiF);
        const vat = r2(feeExcl * T.vatRate);
        pay(F, { from: client.id, to: cb.id, amount: r2(feeExcl + vat), day, month, ref: `BNK-${ym}`, memo: `Business banking fees: ${F.entities[cb.id].name}`, flow: 'purchases', fromAccount: '5320', fromExtra: [{ account: '2230', debit: vat }, { account: '5320', credit: vat }], toAccount: '4050', toExtra: [{ account: '2230', credit: vat }] });
      }
    }
    {
      const feeExcl = r2((cb.publicFees ?? 26_000) * cpiF);
      const vat = r2(feeExcl * T.vatRate);
      pay(F, { from: GOV, to: cb.id, amount: r2(feeExcl + vat), day, month, ref: `BNK-${ym}`, memo: 'Transaction banking for the administration', flow: 'purchases', fromAccount: '5340', toAccount: '4050', toExtra: [{ account: '2230', credit: vat }] });
    }
    {
      const feeExcl = r2((cb.correspondentFees ?? 22_000) * cpiF);
      const vat = r2(feeExcl * T.vatRate);
      pay(F, { from: BANK, to: cb.id, amount: r2(feeExcl + vat), day, month, ref: `BNK-${ym}`, memo: 'Correspondent settlement services for the Mutual Bank', flow: 'purchases', fromAccount: '5320', toAccount: '4050', toExtra: [{ account: '2230', credit: vat }] });
    }
    pay(F, { from: ROW, to: cb.id, amount: r2((cb.treasury ?? 55_000) * cpiF), day, month, ref: `TRS-${ym}`, memo: 'Treasury and money-market income (primary income, not production)', flow: 'transfer', fromAccount: '5370', toAccount: '4030' });
    payBatch(F, cb.id, day, month, `PUR-${ym}`, 'Systems, premises and running costs', [{ to: ROW, amount: r2((cb.running ?? 14_000) * cpiF), fromAccount: '5320', toAccount: '4040', fromExtra: vatInput((cb.running ?? 14_000) * cpiF, T), flow: 'imports' }], 'purchases');
    depreciate(F, cb.id, day, month, cb.dep ?? 9_200);
  }
  // ── The farms: Emmaus's clears through the produce market; the others sell under contract ──
  for (const farm of BUSINESSES.filter((b) => b.kind === 'farm')) {
    if (!F.ledgers.books[farm.id]) continue;
    let output = market.outputValue;
    if (farm.id !== 'farm') {
      const farmer = staffAt('farmer', farm.id) > 0;
      const hands = staffAt('farmhand', farm.id);
      const capacity = ((farmer ? farm.outputBase ?? 40_000 : (farm.outputBase ?? 40_000) * 0.5) + (farm.outputPerHand ?? 18_000) * hands) * cpiF;
      output = r2(capacity * market.yield * EXPORT_PARITY);
      if (output > 0) pay(F, { from: ROW, to: farm.id, amount: output, day, month, ref: `MKT-${ym}`, memo: `Contract sales to the regional buyer (yield ${market.yield.toFixed(2)})`, flow: 'exports', fromAccount: '5370', toAccount: '4040' });
    }
    const inputs = r2(FARM_INPUT_SHARE * output);
    const capex = deposits(F, farm.id) > 0 ? r2(0.03 * output) : 0;
    const vat = farm.vatRegistered;
    const items: BatchItem[] = [
      { to: ROW, amount: inputs, fromAccount: '5200', toAccount: '4040', fromExtra: vat ? vatInput(inputs, T) : [], flow: 'imports' },
      { to: ROW, amount: r2(1_800 * cpiF), fromAccount: '5270', toAccount: '4040', fromExtra: vat ? vatInput(1_800 * cpiF, T) : [], flow: 'imports' },
      { to: ROW, amount: capex, fromAccount: '1500', toAccount: '4040', fromExtra: vat ? vatInput(capex, T) : [], flow: 'imports' },
    ];
    payBatch(F, farm.id, day, month, `PUR-${ym}`, 'Seed, feed, fertiliser, diesel, water and equipment', items, 'purchases');
    totals.investment += capex;
    depreciate(F, farm.id, day, month, farm.dep ?? 3_300);
  }
  // ── The workshops (turnover-tax micro businesses, not VAT registered) ──
  for (const ws of BUSINESSES.filter((b) => b.kind === 'workshop')) {
    if (!F.ledgers.books[ws.id]) continue;
    const office = businessesIn(ws.city, ['office']).find((o) => o.id !== 'towers');
    if (office && F.ledgers.books[office.id]) pay(F, { from: office.id, to: ws.id, amount: r2(5_000 * cpiF), day, month, ref: `MAINT-${ym}`, memo: `Maintenance contract with ${F.entities[office.id].name}`, flow: 'purchases', fromAccount: '5260', toAccount: '4050' });
    const builders = staffAt('builder', ws.id);
    const external = r2(builders * rng.range(8_000, 24_000) * cpiF);
    if (external > 0) pay(F, { from: ROW, to: ws.id, amount: external, day, month, ref: `JOB-${ym}`, memo: 'Building and repair jobs for clients outside the community', flow: 'exports', fromAccount: '5370', toAccount: '4050' });
    const revenue = movement(F.ledgers.books[ws.id], '4050', month, month);
    const materialsIncl = r2(0.4 * revenue);
    const { excl, vat } = vatOnInclusive(materialsIncl, 1, T);
    payBatch(F, ws.id, day, month, `PUR-${ym}`, 'Building materials and consumables (VAT not recoverable: not a vendor)', [
      { to: ROW, amount: excl, fromAccount: '5260', toAccount: '4040', flow: 'imports' },
      { to: GOV, amount: vat, fromAccount: '5260', toAccount: '4132', flow: 'tax' },
    ], 'purchases');
    totals.vat += vat;
    depreciate(F, ws.id, day, month, ws.dep ?? 1_300);
  }
  // ── The offices and the towers (services sold to the region, VAT vendors, company tax) ──
  for (const of of BUSINESSES.filter((b) => b.kind === 'office')) {
    if (!F.ledgers.books[of.id]) continue;
    const wages = payroll.byEmployer[of.id]?.gross ?? 0;
    const base = of.id === 'towers' ? 30_000 : of.id === 'it-office' ? 4_000 : 8_000;
    const excl = r2(1.18 * wages + base * cpiF);
    const vat = r2(excl * T.vatRate);
    pay(F, { from: ROW, to: of.id, amount: r2(excl + vat), day, month, ref: `INV-${ym}`, memo: of.id === 'it-office' ? 'Grant income and services invoiced (standard-rated)' : 'Services invoiced to clients in the region (standard-rated)', flow: 'exports', fromAccount: '5370', toAccount: '4040', toExtra: [{ account: '2230', credit: vat }] });
    const admin = r2((of.id === 'towers' ? 18_000 : 6_000) * cpiF);
    const util = r2((of.id === 'towers' ? 10_000 : 4_000) * cpiF);
    const capex = deposits(F, of.id) > 0 ? r2(0.02 * excl) : 0;
    payBatch(F, of.id, day, month, `PUR-${ym}`, 'Office running costs and equipment', [
      { to: ROW, amount: admin, fromAccount: '5320', toAccount: '4040', fromExtra: vatInput(admin, T), flow: 'imports' },
      { to: ROW, amount: util, fromAccount: '5270', toAccount: '4040', fromExtra: vatInput(util, T), flow: 'imports' },
      { to: ROW, amount: capex, fromAccount: '1500', toAccount: '4040', fromExtra: vatInput(capex, T), flow: 'imports' },
    ], 'purchases');
    totals.investment += capex;
    depreciate(F, of.id, day, month, of.dep ?? 2_500);
  }
  // ── The burial and life society ──
  {
    const admin = r2(0.02 * totals.premiums);
    if (admin > 0) pay(F, { from: SCHEME, to: ROW, amount: admin, day, month, ref: `ADM-${ym}`, memo: 'Administration of the society', flow: 'imports', fromAccount: '5320', toAccount: '4040' });
    const ins = world.insurance;
    ins.premiumsIn += totals.premiums;
    ins.reserve = cashBalance(F.ledgers.books[SCHEME]);
    ins.policies = Object.values(world.households).filter((h) => !h.dissolvedDay && (h.insurance.funeral || h.insurance.life)).length;
    ins.surplusPath.push({ month, reserve: Math.round(ins.reserve), premiums: Math.round(totals.premiums), claims: 0 });
    if (ins.surplusPath.length > 480) ins.surplusPath.shift();
  }
}

function churchMonth(ctx: Ctx, F: FinanceState, month: number, hhs: Household[], totals: Totals, cpiF: number): void {
  const T = F.tax.tables;
  const world = ctx.world;
  const day = world.day;
  const ym = ctx.cal.isoDate.slice(0, 7);
  const congregations = BUSINESSES.filter((b) => b.kind === 'church').map((b) => ({ id: b.id, util: b.util ?? 1_000, other: b.other ?? 500 }));
  for (const cong of congregations) {
    const book = F.ledgers.books[cong.id];
    if (!book) continue;
    const util = vatOnInclusive(cong.util * cpiF, 0.6, T);
    const other = vatOnInclusive(cong.other * cpiF, 1, T);
    const tithes = movement(book, '4060', month, month);
    const ministry = vatOnInclusive(0.12 * tithes, 0.6, T);
    const outlay = cong.util * cpiF + cong.other * cpiF + 0.12 * tithes + 0.13 * tithes;
    if (cashBalance(book) < outlay) continue; // maintenance and the assessment wait for the offering plate
    payBatch(F, cong.id, day, month, `RUN-${ym}`, 'Church running costs, ministry and denominational assessment (a PBO is not a VAT vendor)', [
      { to: ROW, amount: util.excl + other.excl + ministry.excl, fromAccount: '5270', toAccount: '4040', flow: 'imports' },
      { to: GOV, amount: util.vat + other.vat + ministry.vat, fromAccount: '5270', toAccount: '4132', flow: 'tax' },
      { to: ROW, amount: r2(0.1 * tithes), fromAccount: '5140', toAccount: '4900', flow: 'transfer' },
      { to: landmark(world.buildings[cong.id]?.community, 'workshop'), amount: r2(0.03 * tithes), fromAccount: '5260', toAccount: '4050', flow: 'purchases' },
    ], 'purchases');
    totals.vat += util.vat + other.vat + ministry.vat;
    // Benevolence: each diaconal fund helps its own congregation's households in hardship.
    const costs = movement(book, '5210', month, month) + movement(book, '5270', month, month) + 1;
    const cash = cashBalance(book);
    const flock = hhs.filter((h) => h.poor && landmark(comOf(world, h), 'church') === cong.id);
    if (flock.length && cash > 3 * costs) {
      const pool = r2(Math.min(0.3 * Math.max(tithes, 0), cash - 3 * costs));
      const each = r2(pool / flock.length);
      if (each >= 50) {
        for (const hh of flock) pay(F, { from: cong.id, to: hhEntity(hh.id), amount: each, day, month, ref: `GIFT-${ym}`, memo: `Benevolence from the diaconal fund to the ${hh.name} household`, flow: 'transfer', fromAccount: '5140', toAccount: '4110' });
        ctx.emit({ kind: 'church', severity: 'joy', text: `${F.entities[cong.id].name}'s diaconal fund gave R${Math.round(each).toLocaleString()} to each of ${flock.length} household${flock.length > 1 ? 's' : ''} in hardship.`, buildingId: cong.id });
      }
    }
  }
}

// ─── SARS ───────────────────────────────────────────────────────────────────

function settleTax(ctx: Ctx, F: FinanceState, entity: string, parts: Array<{ code: string; revenue: string; head: keyof FinanceState['tax']['collected'] }>, kind: FilingKind, period: string): void {
  const book = F.ledgers.books[entity];
  if (!book) return;
  const day = ctx.world.day;
  const month = F.month;
  const T = F.tax.tables;
  const name = F.entities[entity]?.name ?? entity;
  let due = 0;
  const amounts = parts.map((p) => {
    const v = Math.max(0, natural(book, p.code));
    due += v;
    return v;
  });
  if (due < 0.5) return;
  if (entity === GOV) {
    // The state's own payroll taxes are a book transfer to the revenue fund.
    parts.forEach((p, i) => {
      if (amounts[i] > 0) postInternal(F, GOV, day, month, `${kind}-${period}`, `${kind} ${period}: ${p.head.toUpperCase()} on public-service pay transferred to the revenue fund`, [{ account: p.code, debit: amounts[i] }, { account: p.revenue, credit: amounts[i] }], 'tax', GOV);
    });
    fileReturn(F, kind, entity, period, day, due, due, 0, 'book transfer');
    return;
  }
  const avail = Math.max(0, entity === BANK ? natural(book, '1030') : deposits(F, entity));
  const payNow = r2(Math.min(due, avail));
  let paid = 0;
  parts.forEach((p, i) => {
    const amt = r2((payNow * amounts[i]) / due);
    if (amt <= 0) return;
    pay(F, { from: entity, to: GOV, amount: amt, day, month, ref: `${kind}-${period}`, memo: `${kind} ${period}: ${p.head.toUpperCase()} paid to SARS`, flow: 'tax', fromAccount: p.code, toAccount: p.revenue });
    if (p.head === 'turnover') F.tax.collected.turnover += amt;
    paid += amt;
  });
  const unpaid = r2(due - paid);
  let penalty = 0;
  const c = F.tax.compliance[entity];
  if (unpaid > 1) {
    // A 10% penalty on the amount newly paid late (the carried-over balance already bears its penalty and interest).
    const newlyLate = r2(Math.max(0, unpaid - c.outstanding));
    penalty = r2(newlyLate * T.latePaymentPenalty);
    if (penalty > 0) postInternal(F, entity, day, month, `${kind}-${period}`, `Late-payment penalty (10%) on ${kind} ${period}`, [{ account: '5360', debit: penalty }, { account: '2260', credit: penalty }], 'tax', GOV);
    c.status = 'non-compliant';
    c.outstanding = unpaid;
    c.penalties = r2(c.penalties + penalty);
    if (newlyLate > 1) {
      ctx.emit({ kind: 'economy', severity: 'alert', text: `${name} could not pay R${Math.round(newlyLate).toLocaleString()} of its ${kind} for ${period}; SARS levied a 10% penalty and interest accrues at the prescribed rate.` });
      F.log.push({ day, kind: 'penalty', text: `${name}: ${kind} ${period} short by R${Math.round(newlyLate).toLocaleString()}, penalty R${Math.round(penalty).toLocaleString()}.`, entity });
    }
  } else {
    c.outstanding = 0;
    if (c.status === 'non-compliant' && natural(book, '2260') < 0.5 && natural(book, '2200') < 0.5 && natural(book, '2230') < 0.5 && natural(book, '2240') < 0.5) c.status = 'compliant';
  }
  fileReturn(F, kind, entity, period, day, due, paid, penalty, unpaid > 1 ? `R${Math.round(unpaid).toLocaleString()} outstanding` : '');
}

function taxFilings(ctx: Ctx, F: FinanceState, month: number): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const cal = ctx.cal;
  const day = world.day;
  const prev = calendarForDay(ctx.startMs, world.day - 1);
  const period = prev.isoDate.slice(0, 7);
  for (const id in F.ledgers.books) {
    const book = F.ledgers.books[id];
    if (book.closedMonth !== null || id === ROW) continue;
    // Interest on tax debt at the prescribed rate, then penalties settled when cash allows
    const debt = natural(book, '2260');
    if (debt > 0.5 && id !== GOV) {
      const i = r2(debt * (prescribedRate(F.macro.repo, T) / 12));
      if (i > 0) postInternal(F, id, day, month, `SARS-INT-${period}`, 'Interest on outstanding tax at the prescribed rate', [{ account: '5360', debit: i }, { account: '2260', credit: i }], 'tax', GOV);
      const avail = Math.max(0, id === BANK ? natural(book, '1030') : deposits(F, id));
      const settle = r2(Math.min(natural(book, '2260'), avail * 0.5));
      if (settle > 0.5) {
        pay(F, { from: id, to: GOV, amount: settle, day, month, ref: `SARS-PEN-${period}`, memo: 'Penalties and interest paid to SARS', flow: 'tax', fromAccount: '2260', toAccount: '4137' });
        F.tax.collected.penalties += settle;
        const c = F.tax.compliance[id];
        if (c && natural(book, '2260') < 0.5 && natural(book, '2200') < 0.5 && natural(book, '2230') < 0.5 && natural(book, '2240') < 0.5) c.status = 'compliant';
      }
    }
    // EMP201: PAYE, UIF and SDL withheld last month
    if (natural(book, '2200') + natural(book, '2210') + natural(book, '2220') > 0.5) settleTax(ctx, F, id, [{ code: '2200', revenue: '4131', head: 'paye' }, { code: '2210', revenue: '4134', head: 'uif' }, { code: '2220', revenue: '4135', head: 'sdl' }], 'EMP201', period);
    // VAT201 for the two-month period just ended (category A: periods end in even months)
    const info = F.entities[id];
    if (info?.vatRegistered && cal.month % 2 === 1) {
      const bal = natural(book, '2230');
      const per = `${calendarForDay(ctx.startMs, world.day - 45).isoDate.slice(0, 7)}/${period}`;
      if (bal > 0.5) settleTax(ctx, F, id, [{ code: '2230', revenue: '4132', head: 'vat' }], 'VAT201', per);
      else if (bal < -0.5) {
        const refund = r2(-bal);
        pay(F, { from: GOV, to: id, amount: refund, day, month, ref: `VAT201-${per}`, memo: `VAT201 ${per}: refund of input tax from SARS`, flow: 'tax', fromAccount: '4132', toAccount: '2230' });
        F.tax.collected.refunds += refund;
        fileReturn(F, 'VAT201', id, per, day, -refund, 0, 0, 'refund');
        ctx.emit({ kind: 'economy', severity: 'info', text: `SARS refunded R${Math.round(refund).toLocaleString()} of input VAT to ${info.name}.` });
      } else fileReturn(F, 'VAT201', id, per, day, 0, 0, 0, 'nil return');
    }
    // First provisional payment at the end of August (six months into the year of assessment)
    if (cal.month === 9 && (info?.regime === 'sbc' || info?.regime === 'cit' || info?.regime === 'turnover')) {
      const from = book.lastCloseMonth + 1;
      const is = incomeStatement(book, from, month - 1);
      const months = Math.max(1, month - from);
      const turnover = (movement(book, '4040', from, month - 1) + movement(book, '4050', from, month - 1)) * (12 / months);
      const taxable = Math.max(0, (is.profitBeforeTax + movement(book, '5360', from, month - 1) + movement(book, '5160', from, month - 1)) * (12 / months) - (F.tax.assessedLosses[id] ?? 0));
      const est = r2(companyTax(taxable, info.regime, turnover, T) / 2);
      const kind: FilingKind = info.regime === 'turnover' ? 'TT03' : 'IRP6';
      const pv = (F.tax.provisional[id] ??= { first: 0, second: 0 });
      if (est > 0.5) {
        postInternal(F, id, day, month, `${kind}-1-${taxYearLabel(cal)}`, 'First provisional tax payment: estimate for the year', [{ account: '5350', debit: est }, { account: '2240', credit: est }], 'tax', GOV);
        settleTax(ctx, F, id, [{ code: '2240', revenue: '4133', head: info.regime === 'turnover' ? 'turnover' : 'cit' }], kind, `${taxYearLabel(cal)}-1`);
        pv.first = est;
      } else fileReturn(F, kind, id, `${taxYearLabel(cal)}-1`, day, 0, 0, 0, 'nil estimate');
    }
  }
}

/** Tax season (July): ITR12 assessments for individuals and ITR14/TT03 assessments for businesses for the year ended in February. */
function taxSeason(ctx: Ctx, F: FinanceState, month: number): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const cal = ctx.cal;
  const closed = String(cal.year);
  if (F.tax.lastAssessmentYear === cal.year) return;
  F.tax.lastAssessmentYear = cal.year;
  const day = world.day;
  let n = 0;
  let refunds = 0;
  let owing = 0;
  for (const key in F.tax.personYears) {
    const rec = F.tax.personYears[key];
    if (rec.year !== closed || rec.assessed) continue;
    const p = world.people[rec.personId];
    const a = assessIndividual({ age: rec.age, remuneration: rec.remuneration, payeWithheld: rec.paye, interest: rec.interest, donations: rec.donations, s18a: ctx.params.churchS18A, medicalBeneficiaries: rec.medicalBeneficiaries, medicalMonths: rec.medicalMonths }, T);
    rec.assessed = { taxableIncome: a.taxableIncome, normalTax: a.normalTax, rebates: a.rebates, medicalCredit: a.medicalCredit, taxPayable: a.taxPayable, balance: a.balance, day };
    n++;
    const hh = p && p.alive && !p.emigrated ? world.households[p.householdId] : null;
    if (!hh || hh.dissolvedDay || !F.ledgers.books[hhEntity(hh.id)]) continue;
    const e = hhEntity(hh.id);
    if (a.balance < -1) {
      pay(F, { from: GOV, to: e, amount: -a.balance, day, month, ref: `ITR12-${closed}`, memo: `ITR12 ${closed}: refund to ${rec.name}`, flow: 'tax', fromAccount: '4131', toAccount: '5110' });
      F.tax.collected.refunds += -a.balance;
      refunds += -a.balance;
      fileReturn(F, 'ITR12', e, closed, day, a.balance, 0, 0, `${rec.name}: refund`);
    } else if (a.balance > 1) {
      const paid = r2(Math.min(a.balance, Math.max(0, deposits(F, e))));
      if (paid > 0) pay(F, { from: e, to: GOV, amount: paid, day, month, ref: `ITR12-${closed}`, memo: `ITR12 ${closed}: assessed tax owing by ${rec.name}`, flow: 'tax', fromAccount: '5110', toAccount: '4131' });
      owing += a.balance;
      fileReturn(F, 'ITR12', e, closed, day, a.balance, paid, 0, `${rec.name}: owing`);
    } else fileReturn(F, 'ITR12', e, closed, day, 0, 0, 0, `${rec.name}: no balance`);
    syncHousehold(F, hh);
  }
  // Businesses
  for (const key in F.tax.entityYears) {
    const ey = F.tax.entityYears[key];
    if (ey.year !== closed || ey.assessedTax !== null) continue;
    const book = F.ledgers.books[ey.entity];
    if (!book) continue;
    const actual = companyTax(ey.taxableIncome, ey.regime, ey.turnover, T);
    ey.assessedTax = actual;
    ey.assessedDay = day;
    const diff = r2(actual - ey.provisionalPaid);
    const kind: FilingKind = ey.regime === 'turnover' ? 'TT03' : 'ITR14';
    const head = ey.regime === 'turnover' ? 'turnover' : 'cit';
    if (diff > 1) {
      postInternal(F, ey.entity, day, month, `${kind}-${closed}`, `${kind} ${closed}: assessment top-up`, [{ account: '5350', debit: diff }, { account: '2240', credit: diff }], 'tax', GOV);
      settleTax(ctx, F, ey.entity, [{ code: '2240', revenue: '4133', head }], kind, closed);
    } else if (diff < -1) {
      pay(F, { from: GOV, to: ey.entity, amount: -diff, day, month, ref: `${kind}-${closed}`, memo: `${kind} ${closed}: refund of provisional tax overpaid`, flow: 'tax', fromAccount: '4133', toAccount: '5350' });
      F.tax.collected.refunds += -diff;
      fileReturn(F, kind, ey.entity, closed, day, diff, 0, 0, 'refund');
    } else fileReturn(F, kind, ey.entity, closed, day, 0, 0, 0, 'assessed as estimated');
  }
  if (n) ctx.emit({ kind: 'economy', severity: 'info', text: `Tax season: SARS assessed ${n} individual return${n > 1 ? 's' : ''} for ${closed}; refunds R${Math.round(refunds).toLocaleString()}, amounts owing R${Math.round(owing).toLocaleString()}.` });
}

// ─── Year end ───────────────────────────────────────────────────────────────

function yearEnd(ctx: Ctx, F: FinanceState, month: number): void {
  const world = ctx.world;
  const T = F.tax.tables;
  const cal = ctx.cal;
  const day = world.day;
  const closedMonth = month - 1;
  const label = String(cal.year);
  const summaries: string[] = [];
  // Second provisional payments for companies and the micro business (posted in the closed year)
  for (const id in F.entities) {
    const info = F.entities[id];
    const book = F.ledgers.books[id];
    if (!book || book.closedMonth !== null) continue;
    if (info.regime !== 'sbc' && info.regime !== 'cit' && info.regime !== 'turnover') continue;
    const from = book.lastCloseMonth + 1;
    const is = incomeStatement(book, from, closedMonth);
    const turnover = movement(book, '4040', from, closedMonth) + movement(book, '4050', from, closedMonth);
    // Fines and penalties are not deductible; an assessed loss carries forward against future taxable income (s20).
    const raw = r2(is.profitBeforeTax + movement(book, '5360', from, closedMonth) + movement(book, '5160', from, closedMonth));
    const lossCf = F.tax.assessedLosses[id] ?? 0;
    const taxable = r2(Math.max(0, raw - lossCf));
    F.tax.assessedLosses[id] = r2(Math.max(0, lossCf - Math.max(0, raw)) + Math.max(0, -raw));
    const pv = (F.tax.provisional[id] ??= { first: 0, second: 0 });
    // The second estimate is made before the last month's figures are final: eleven months annualised.
    const months = Math.max(1, closedMonth - from + 1);
    const est = months >= 12 ? companyTax(taxable * (12 / months) * (11 / 12) * (12 / 11), info.regime, turnover, T) : companyTax(taxable, info.regime, turnover, T);
    const second = r2(Math.max(0, est - pv.first));
    const kind: FilingKind = info.regime === 'turnover' ? 'TT03' : 'IRP6';
    if (second > 0.5) {
      postInternal(F, id, day, closedMonth, `${kind}-2-${label}`, 'Second provisional tax payment at year end', [{ account: '5350', debit: second }, { account: '2240', credit: second }], 'tax', GOV);
      F.month = closedMonth;
      settleTax(ctx, F, id, [{ code: '2240', revenue: '4133', head: info.regime === 'turnover' ? 'turnover' : 'cit' }], kind, `${label}-2`);
      F.month = month;
      pv.second = second;
    }
    F.tax.entityYears[`${id}:${label}`] = { entity: id, year: label, regime: info.regime, turnover: r2(turnover), profitBeforeTax: is.profitBeforeTax, taxableIncome: taxable, provisionalPaid: r2(pv.first + pv.second), assessedTax: null, assessedDay: null };
  }
  // Close every open book
  const profits: Record<string, number> = {};
  for (const id in F.ledgers.books) {
    const book = F.ledgers.books[id];
    if (book.closedMonth !== null) continue;
    const c = closeYear(F.ledgers, book, day, closedMonth, label);
    profits[id] = c.income.netProfit;
    const info = F.entities[id];
    if (info && (info.sector === 'firms' || info.sector === 'bank' || info.sector === 'church' || info.sector === 'scheme')) summaries.push(`${info.name} ${c.income.netProfit >= 0 ? 'profit' : 'loss'} R${Math.round(Math.abs(c.income.netProfit)).toLocaleString()}`);
  }
  // The bank: preference dividend out of profit, statutory reserve and the dividend on member shares
  bankYearEnd(F, day, month, label, profits[BANK] ?? 0, F.macro.repo, T.dividendsTaxRate);
  // Each city's co-operative distributes most of its surplus to its member households (every household of the city is a member)
  for (const co of BUSINESSES.filter((b) => b.kind === 'office' && b.id !== 'towers')) {
    const book = F.ledgers.books[co.id];
    const profit = profits[co.id] ?? 0;
    const open = Object.values(world.households).filter((h) => !h.dissolvedDay && h.memberIds.length && cityOf(world.buildings[h.houseId]?.community) === co.city).map((h) => hhEntity(h.id)).filter((e) => F.ledgers.books[e] && F.ledgers.books[e].closedMonth === null);
    if (!book) continue;
    const costs = (movement(book, '5210', closedMonth - 11, closedMonth) + movement(book, '5320', closedMonth - 11, closedMonth)) / 12;
    if (profit > 0 && open.length && cashBalance(book) > 3 * costs) {
      const pool = r2(Math.min(0.6 * profit, cashBalance(book) - 3 * costs));
      const each = r2(pool / open.length);
      if (each >= 100) {
        const dtEach = r2(each * T.dividendsTaxRate);
        for (const e of open) pay(F, { from: co.id, to: e, amount: r2(each - dtEach), day, month, ref: `PATRON-${label}`, memo: `Co-operative surplus distribution for ${label} (net of dividends tax)`, flow: 'dividends', fromAccount: '3050', toAccount: '4120' });
        pay(F, { from: co.id, to: GOV, amount: r2(dtEach * open.length), day, month, ref: `DTR01-${label}`, memo: 'Dividends tax withheld on the surplus distribution', flow: 'tax', fromAccount: '3050', toAccount: '4138' });
        ctx.emit({ kind: 'economy', severity: 'joy', text: `${F.entities[co.id].name} distributed R${Math.round(pool).toLocaleString()} of its ${label} surplus to the ${open.length} member households.` });
      }
    }
  }
  // The airport company pays the province its dividend; the app pays its parent.
  for (const t of transportYearEnd(F, day, month, label, profits, T.dividendsTaxRate)) F.log.push({ day, kind: 'dividend', text: t });
  // Owner-managed businesses: a dividend to the owner household when the year allows
  for (const id in F.entities) {
    const info = F.entities[id];
    const book = F.ledgers.books[id];
    if (!info.owner || !book || !F.ledgers.books[info.owner] || book.closedMonth !== null) continue;
    const profit = profits[id] ?? 0;
    const retained = natural(book, '3020');
    const costs = (movement(book, '5210', closedMonth - 11, closedMonth) + movement(book, '5200', closedMonth - 11, closedMonth)) / 12;
    const cash = cashBalance(book);
    if (profit <= 0 || retained <= 0 || cash < 2 * costs) continue;
    const gross = r2(Math.min(0.5 * profit, cash - 2 * costs, retained));
    if (gross < 100) continue;
    const dt = r2(gross * T.dividendsTaxRate);
    pay(F, { from: id, to: info.owner, amount: r2(gross - dt), day, month, ref: `DIV-${label}`, memo: `Dividend to the owner for ${label} (net of dividends tax)`, flow: 'dividends', fromAccount: '3050', toAccount: '4120' });
    pay(F, { from: id, to: GOV, amount: dt, day, month, ref: `DTR01-${label}`, memo: 'Dividends tax withheld (20%)', flow: 'tax', fromAccount: '3050', toAccount: '4138' });
    F.log.push({ day, kind: 'dividend', text: `${info.name} paid a dividend of R${Math.round(gross).toLocaleString()} to the ${F.entities[info.owner].name}.`, entity: id });
  }
  F.tax.payrollYtd = {};
  F.tax.provisional = {};
  ctx.emit({ kind: 'economy', severity: 'info', text: `Books closed for the ${label} year of assessment: ${summaries.join('; ')}.` });
  F.log.push({ day, kind: 'audit', text: `Year-end close ${label}: ${Object.keys(profits).length} books closed, statements filed.` });
}

// ─── Month end ──────────────────────────────────────────────────────────────

function monthEnd(ctx: Ctx, F: FinanceState, month: number, hhs: Household[], budgets: Budget[], payroll: Payroll, totals: Totals, market: MarketResult): void {
  const world = ctx.world;
  const L = F.ledgers;
  const M = F.macro;
  const day = world.day;
  const rng = ctx.rng.stream('finance');
  // Fiscal balancing with the national fiscus (the community's public sector is a net recipient)
  const gov = L.books[GOV];
  const govCash = natural(gov, '1020');
  let fiscalTransfer = 0;
  if (govCash < -0.5) {
    fiscalTransfer = r2(-govCash);
    pay(F, { from: ROW, to: GOV, amount: fiscalTransfer, day, month, ref: `FISCUS-${month}`, memo: 'Transfer from the national fiscus to fund the month\'s shortfall', flow: 'transfer', fromAccount: '5370', toAccount: '4140' });
  } else if (govCash > 0.5) {
    fiscalTransfer = r2(-govCash);
    pay(F, { from: GOV, to: ROW, amount: govCash, day, month, ref: `FISCUS-${month}`, memo: 'Surplus remitted to the national fiscus', flow: 'transfer', fromAccount: '5380', toAccount: '4900' });
  }
  const bankBook = L.books[BANK];
  // National accounts from this month's movements
  const mv = (id: string, code: string) => (L.books[id] ? movement(L.books[id], code, month, month) : 0);
  const flows = F.flows[F.flows.length - 1]?.month === month ? F.flows[F.flows.length - 1].cells : {};
  // The bank's output is its domestic intermediation (FISIM); interest earned on treasury bills is primary income from outside, not GDP.
  const tbill = flows[`${ROW}>${BANK}>interest`] ?? 0;
  const fisim = Math.max(0, mv(BANK, '4030') - tbill + mv(BANK, '4100') - mv(BANK, '5290'));
  // Value added = output less intermediate consumption (stock 5200, utilities 5270,
  // maintenance 5260 and bought-in services 5320), producer by producer. Churches
  // and government produce at cost (their compensation); the commercial bank's
  // treasury income (4030) is primary income from outside, like the T-bills.
  const tradeVa = (id: string, out: string) => mv(id, out) - mv(id, '5200') - mv(id, '5270') - mv(id, '5260') - mv(id, '5320');
  const va: Record<string, number> = {
    bank: fisim - mv(BANK, '5320'),
    gov: mv(GOV, '5210') + mv(GOV, '5220') + mv(GOV, '5230') + mv(GOV, '5345'),
  };
  // Unity Transit passes the SNA 50% test (fares cover half its running costs over the year) or it does not: a
  // market producer's value added is its fares less intermediate consumption; a non-market producer's is its
  // compensation of employees, and the state buys the rest of its output (government consumption: costs less fares).
  const tmRow = F.transport.months[F.transport.months.length - 1];
  const transitMarket = tmRow?.month === month ? tmRow.transit.market : false;
  const transitComp = mv('transit', '5210') + mv('transit', '5220') + mv('transit', '5230');
  const transitIc = mv('transit', '5200') + mv('transit', '5270') + mv('transit', '5260') + mv('transit', '5320');
  const transitG = transitMarket ? 0 : Math.max(0, transitComp + transitIc - mv('transit', '4050'));
  for (const b of BUSINESSES) {
    if (b.kind === 'church') va[b.id] = mv(b.id, '5210') + mv(b.id, '5220');
    else if (b.kind === 'workshop') va[b.id] = mv(b.id, '4050') - mv(b.id, '5260') - mv(b.id, '5270');
    else if (b.kind === 'office') va[b.id] = mv(b.id, '4040') - mv(b.id, '5320') - mv(b.id, '5270') - mv(b.id, '5260');
    else if (b.kind === 'transit') va[b.id] = transitMarket ? tradeVa(b.id, '4050') : transitComp;
    // The app is an agent: its output is the service and booking fees, not the fares it collects for the drivers.
    else if (b.kind === 'platform') va[b.id] = tradeVa(b.id, '4100');
    else va[b.id] = tradeVa(b.id, b.kind === 'practice' || b.kind === 'taxi' || b.kind === 'combank' || b.kind === 'fleet' || b.kind === 'airport' ? '4050' : '4040');
  }
  // The driver-partners' mixed income: payouts less fuel, the rent and the phone (own-account production of households).
  va.drivers = tmRow?.month === month ? tmRow.ride.driverNet : 0;
  const valueAdded = Object.values(va).reduce((s, x) => s + x, 0);
  // Compensation of employees: every employer that issued a payslip this month
  // (domestic workers' employers are households), plus council stipends. The
  // airline's pilots are paid from outside the province: primary income, not
  // the province's production.
  const employerIds = new Set<string>([BANK, GOV, ...BUSINESSES.map((b) => b.id)]);
  for (const pid in F.payslips) if (F.payslips[pid].employer !== ROW) employerIds.add(F.payslips[pid].employer);
  const compensation = [...employerIds].reduce((s, id) => s + mv(id, '5210') + mv(id, '5220') + mv(id, '5230'), 0) + mv(GOV, '5345');
  const taxesOnProducts = totals.vat + totals.fuelLevies + totals.rates;
  let exports = 0;
  let imports = 0;
  for (const key in flows) {
    const [from, to, kind] = key.split('>');
    if (from === ROW && kind === 'exports') exports += flows[key];
    if (to === ROW && kind === 'imports') imports += flows[key];
  }
  const taxHeads = ['4131', '4132', '4133', '4134', '4135', '4136', '4137', '4138', '4150'];
  const taxRevenue = taxHeads.reduce((s, c) => s + mv(GOV, c), 0);
  const col = F.tax.collected;
  col.paye += mv(GOV, '4131');
  col.vat += mv(GOV, '4132');
  col.cit += mv(GOV, '4133');
  col.uif += mv(GOV, '4134');
  col.sdl += mv(GOV, '4135');
  col.fuel += mv(GOV, '4136');
  col.fines += mv(GOV, '4137');
  col.dividends += mv(GOV, '4138');
  col.rates += mv(GOV, '4150');
  const govSpending = mv(GOV, '5210') + mv(GOV, '5220') + mv(GOV, '5230') + mv(GOV, '5330') + mv(GOV, '5335') + mv(GOV, '5340') + mv(GOV, '5345');
  const incomes: number[] = [];
  const wealth: number[] = [];
  let disposable = 0;
  let saving = 0;
  const engel: FinanceState['micro']['engel'] = [];
  for (const b of budgets) {
    incomes.push(b.pcIncome);
    const book = L.books[b.e];
    wealth.push(natural(book, '1020') + natural(book, '1510') + natural(book, '1700') - natural(book, '2050'));
    disposable += b.disposable;
    saving += b.disposable - b.consumption - b.tithe - b.prem;
    engel.push({ household: b.hh.id, name: b.hh.name, perCapita: r2(b.pcIncome), foodShare: b.consumption > 0 ? r2(b.food / b.consumption) : 0, income: r2(b.gross + b.grants) });
  }
  F.micro.engel = engel;
  const people = alivePeople(world);
  const adults = people.filter((p) => p.age >= 15 && p.age < ctx.params.retirementAge);
  const employed = adults.filter((p) => p.income > 0).length;
  const unemployed = adults.filter((p) => p.job === 'unemployed').length;
  const npish = BUSINESSES.filter((b) => b.kind === 'church').reduce((s, b) => s + mv(b.id, '5210') + mv(b.id, '5220') + mv(b.id, '5270'), 0);
  const Mk = F.markets;
  const row = macroMonthEnd(M, rng, month, {
    isoDate: ctx.cal.isoDate,
    foodPrice: market.price,
    produceWeight: PRODUCE_SHARE * LOCAL_FOOD_SHARE * (F.micro.localShare ?? 0.2) / 0.2,
    fuelPrice: Mk.petrol / Mk.base.petrol,
    farePrice: tmRow?.month === month ? tmRow.fareIndex : 1,
    petrol: Mk.petrol,
    brent: Mk.brent,
    zar: Mk.zar,
    consumption: totals.consumption + fisim,
    investment: totals.investment,
    // Grants and the transport operations grant are transfers, not government consumption; a non-market Unity Transit's output is.
    government: govSpending - mv(GOV, '5330') - mv(GOV, '5335') + npish + transitG,
    exports,
    imports,
    compensation,
    operatingSurplus: valueAdded - compensation,
    taxesOnProducts,
    valueAdded,
    employed,
    unemployed,
    workingAge: adults.length,
    taxRevenue,
    govSpending,
    fiscalTransfer,
    deposits: natural(bankBook, '2100'),
    loans: natural(bankBook, '1150'),
    householdDisposable: disposable,
    householdSaving: saving,
    tithes: totals.tithes,
    incomes,
    wealth,
  });
  row.participation = adults.length ? (employed + unemployed) / adults.length : 0;
  marketsRecord(Mk, month, ctx.cal.isoDate);
  if (tmRow?.month === month) tmRow.levyRevenue = r2(mv(GOV, '4136'));
  // Labour market snapshot
  const nmwMonthly = r2(M.nmwHourly * HOURS_PER_MONTH);
  const reservations = adults.filter((p) => p.income > 0 || p.job === 'unemployed').map((p) => {
    const hh = world.households[p.householdId];
    return reservationWage(nmwMonthly, eduRank(p.education), p.age, !!hh && (hh.monthlyIncome - p.income * M.wageIndex) > 0);
  });
  F.micro.labour = labourSnapshot(month, { wages: payroll.wages, reservations, nmwMonthly, employed, unemployed });
  // Mirrors for the rest of the simulation and the UI
  for (const b of budgets) {
    syncHousehold(F, b.hh);
    b.hh.ledger.push({ month, income: Math.round(b.gross + b.grants), expenses: Math.round(b.consumption + b.tithe + b.prem + (payroll.byHousehold[b.e]?.paye ?? 0) + (payroll.byHousehold[b.e]?.uif ?? 0) + b.loanService), savings: b.hh.savings, tax: Math.round((payroll.byHousehold[b.e]?.paye ?? 0) + (payroll.byHousehold[b.e]?.uif ?? 0)), debt: b.hh.debt });
    if (b.hh.ledger.length > 480) b.hh.ledger.shift();
  }
  for (const hh of hhs) if (!budgets.some((b) => b.hh === hh)) syncHousehold(F, hh);
  world.insurance.reserve = cashBalance(L.books[SCHEME]);
  if (F.log.length > 2000) F.log.splice(0, F.log.length - 2000);
}
