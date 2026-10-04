// Double-entry accounting core: a standard chart of accounts, a hash-chained
// general journal, per-entity ledgers, and the statements an auditor expects
// (trial balance, income statement, balance sheet, cash-flow statement and a
// statement of changes in equity). Every rand that moves in the community is
// posted here, so the books are the single source of truth for the economics.
//
// Conventions (IFRS for SMEs / GRAP-style presentation):
//   - Assets and expenses carry debit balances; liabilities, equity and revenue
//     carry credit balances. `natural()` returns each balance with its normal
//     sign so statements read the way an accountant lays them out.
//   - Account codes follow the customary numbering: 1xxx assets, 2xxx
//     liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses.
//   - The financial year is the South African tax year (1 March to end of
//     February); `closeYear` transfers the profit or loss to retained earnings.
//   - Every journal entry is chained to the previous one with a 64-bit FNV-1a
//     digest, so a retained journal can be verified end to end and pruned
//     history still leaves a verifiable chain of month-end digests.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountSpec {
  code: string;
  name: string;
  type: AccountType;
  /** Presentation group inside the statement. */
  group: string;
  /** Cash-flow classification of the counter-entries when cash moves. */
  cashFlow?: 'operating' | 'investing' | 'financing';
  /** True for cash and cash equivalents. */
  cash?: boolean;
  /** Contra account (shown as a deduction, e.g. the loss allowance). */
  contra?: boolean;
}

export const CHART: AccountSpec[] = [
  // ── Assets ──
  { code: '1010', name: 'Cash on hand', type: 'asset', group: 'Current assets', cash: true },
  { code: '1020', name: 'Bank: deposits at the Mutual Bank', type: 'asset', group: 'Current assets', cash: true },
  { code: '1030', name: 'Balances with the Reserve Bank and other banks', type: 'asset', group: 'Current assets', cash: true },
  { code: '1100', name: 'Accounts receivable', type: 'asset', group: 'Current assets', cashFlow: 'operating' },
  { code: '1110', name: 'VAT receivable from SARS', type: 'asset', group: 'Current assets', cashFlow: 'operating' },
  { code: '1120', name: 'Income tax receivable from SARS', type: 'asset', group: 'Current assets', cashFlow: 'operating' },
  { code: '1150', name: 'Loans and advances to members', type: 'asset', group: 'Loans and advances', cashFlow: 'operating' },
  { code: '1160', name: 'Allowance for expected credit losses', type: 'asset', group: 'Loans and advances', cashFlow: 'operating', contra: true },
  { code: '1200', name: 'Inventory', type: 'asset', group: 'Current assets', cashFlow: 'operating' },
  { code: '1500', name: 'Property, plant and equipment', type: 'asset', group: 'Non-current assets', cashFlow: 'investing' },
  { code: '1510', name: 'Vehicles', type: 'asset', group: 'Non-current assets', cashFlow: 'investing' },
  { code: '1590', name: 'Accumulated depreciation', type: 'asset', group: 'Non-current assets', cashFlow: 'investing', contra: true },
  { code: '1600', name: 'Treasury bills and government stock', type: 'asset', group: 'Investments', cashFlow: 'investing' },
  { code: '1700', name: 'Shares in the Mutual Bank', type: 'asset', group: 'Investments', cashFlow: 'investing' },
  // ── Liabilities ──
  { code: '2010', name: 'Accounts payable', type: 'liability', group: 'Current liabilities', cashFlow: 'operating' },
  { code: '2050', name: 'Loans from the Mutual Bank', type: 'liability', group: 'Borrowings', cashFlow: 'financing' },
  { code: '2100', name: 'Member deposits', type: 'liability', group: 'Deposits', cashFlow: 'operating' },
  { code: '2200', name: 'PAYE payable to SARS', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2210', name: 'UIF contributions payable', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2220', name: 'Skills development levy payable', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2230', name: 'VAT control (output less input)', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2240', name: 'Income tax payable to SARS', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2250', name: 'Dividends tax payable', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2260', name: 'SARS penalties and interest payable', type: 'liability', group: 'Tax liabilities', cashFlow: 'operating' },
  { code: '2300', name: 'Claims outstanding', type: 'liability', group: 'Insurance liabilities', cashFlow: 'operating' },
  { code: '2400', name: 'Policyholder liabilities (technical reserve)', type: 'liability', group: 'Insurance liabilities', cashFlow: 'operating' },
  // ── Equity ──
  { code: '3010', name: 'Share capital / capital introduced', type: 'equity', group: 'Capital', cashFlow: 'financing' },
  { code: '3020', name: 'Retained earnings', type: 'equity', group: 'Reserves', cashFlow: 'financing' },
  { code: '3030', name: 'Statutory general reserve', type: 'equity', group: 'Reserves', cashFlow: 'financing' },
  { code: '3050', name: 'Dividends declared', type: 'equity', group: 'Distributions', cashFlow: 'financing' },
  // ── Revenue ──
  { code: '4010', name: 'Salaries and wages earned', type: 'revenue', group: 'Employment income', cashFlow: 'operating' },
  { code: '4020', name: 'Social grants (SASSA)', type: 'revenue', group: 'Transfers received', cashFlow: 'operating' },
  { code: '4025', name: 'Council stipends received', type: 'revenue', group: 'Employment income', cashFlow: 'operating' },
  { code: '4030', name: 'Interest income', type: 'revenue', group: 'Investment income', cashFlow: 'operating' },
  { code: '4040', name: 'Sales', type: 'revenue', group: 'Trading income', cashFlow: 'operating' },
  { code: '4050', name: 'Fees for services', type: 'revenue', group: 'Trading income', cashFlow: 'operating' },
  { code: '4060', name: 'Tithes and offerings', type: 'revenue', group: 'Donations', cashFlow: 'operating' },
  { code: '4070', name: 'Premium income', type: 'revenue', group: 'Insurance income', cashFlow: 'operating' },
  { code: '4090', name: 'Insurance benefits received', type: 'revenue', group: 'Transfers received', cashFlow: 'operating' },
  { code: '4100', name: 'Fee and commission income', type: 'revenue', group: 'Trading income', cashFlow: 'operating' },
  { code: '4110', name: 'Gifts and benevolence received', type: 'revenue', group: 'Transfers received', cashFlow: 'operating' },
  { code: '4120', name: 'Dividends received', type: 'revenue', group: 'Investment income', cashFlow: 'operating' },
  { code: '4131', name: 'Tax revenue: PAYE', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4132', name: 'Tax revenue: VAT', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4133', name: 'Tax revenue: corporate and turnover tax', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4134', name: 'UIF contributions', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4135', name: 'Skills development levy', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4136', name: 'Fuel levies', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4137', name: 'Fines and penalties', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4138', name: 'Dividends tax', type: 'revenue', group: 'Tax revenue', cashFlow: 'operating' },
  { code: '4140', name: 'Transfers from the national fiscus', type: 'revenue', group: 'Transfers received', cashFlow: 'operating' },
  { code: '4150', name: 'Municipal rates and service charges', type: 'revenue', group: 'Trading income', cashFlow: 'operating' },
  { code: '4160', name: 'Operating subsidies received', type: 'revenue', group: 'Transfers received', cashFlow: 'operating' },
  { code: '4900', name: 'Other income', type: 'revenue', group: 'Other income', cashFlow: 'operating' },
  // ── Expenses ──
  { code: '5010', name: 'Food and groceries', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5020', name: 'Housing, rates and utilities', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5030', name: 'Transport and fuel', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5040', name: 'Clothing and household goods', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5050', name: 'Education', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5060', name: 'Health and medical', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5070', name: 'Communication and other', type: 'expense', group: 'Household consumption', cashFlow: 'operating' },
  { code: '5080', name: 'Tithes and offerings given', type: 'expense', group: 'Giving', cashFlow: 'operating' },
  { code: '5090', name: 'Insurance premiums', type: 'expense', group: 'Insurance', cashFlow: 'operating' },
  { code: '5100', name: 'Interest expense', type: 'expense', group: 'Finance costs', cashFlow: 'operating' },
  { code: '5110', name: 'Income tax (PAYE and assessments)', type: 'expense', group: 'Taxes', cashFlow: 'operating' },
  { code: '5120', name: 'UIF contributions (employee)', type: 'expense', group: 'Taxes', cashFlow: 'operating' },
  { code: '5130', name: 'Bank charges', type: 'expense', group: 'Finance costs', cashFlow: 'operating' },
  { code: '5140', name: 'Gifts and benevolence paid', type: 'expense', group: 'Giving', cashFlow: 'operating' },
  { code: '5150', name: 'Funeral costs', type: 'expense', group: 'Life events', cashFlow: 'operating' },
  { code: '5160', name: 'Fines, legal and court costs', type: 'expense', group: 'Life events', cashFlow: 'operating' },
  { code: '5170', name: 'Losses from theft and fraud', type: 'expense', group: 'Life events', cashFlow: 'operating' },
  { code: '5200', name: 'Cost of sales', type: 'expense', group: 'Cost of sales', cashFlow: 'operating' },
  { code: '5210', name: 'Salaries and wages', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5220', name: 'UIF contributions (employer)', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5230', name: 'Skills development levy', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5240', name: 'Rent and premises', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5245', name: 'Vehicle rental', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5250', name: 'Depreciation', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5260', name: 'Repairs, maintenance and materials', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5270', name: 'Utilities and municipal services', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5280', name: 'Impairment of loans and advances', type: 'expense', group: 'Credit losses', cashFlow: 'operating' },
  { code: '5290', name: 'Interest on member deposits', type: 'expense', group: 'Finance costs', cashFlow: 'operating' },
  { code: '5300', name: 'Claims and benefits paid', type: 'expense', group: 'Insurance', cashFlow: 'operating' },
  { code: '5320', name: 'Administration and other operating costs', type: 'expense', group: 'Operating expenses', cashFlow: 'operating' },
  { code: '5330', name: 'Social grants paid', type: 'expense', group: 'Public spending', cashFlow: 'operating' },
  { code: '5335', name: 'Public transport operations grant', type: 'expense', group: 'Public spending', cashFlow: 'operating' },
  { code: '5340', name: 'Public services (health, education, policing, justice)', type: 'expense', group: 'Public spending', cashFlow: 'operating' },
  { code: '5345', name: 'Council stipends and allowances', type: 'expense', group: 'Public spending', cashFlow: 'operating' },
  { code: '5350', name: 'Income tax expense', type: 'expense', group: 'Taxes', cashFlow: 'operating' },
  { code: '5360', name: 'SARS penalties and interest', type: 'expense', group: 'Taxes', cashFlow: 'operating' },
  { code: '5370', name: 'Other expenses', type: 'expense', group: 'Other expenses', cashFlow: 'operating' },
  { code: '5380', name: 'Surplus remitted to the national fiscus', type: 'expense', group: 'Public spending', cashFlow: 'operating' },
];

export const ACCOUNT: Record<string, AccountSpec> = Object.fromEntries(CHART.map((a) => [a.code, a]));
const CASH_CODES = new Set(CHART.filter((a) => a.cash).map((a) => a.code));

export type EntityKind = 'household' | 'business' | 'church' | 'scheme' | 'bank' | 'government' | 'row';

/** Economic classification of a transaction (drives the circular-flow and GDP accounts). */
export type FlowKind =
  | 'wages'
  | 'grants'
  | 'consumption'
  | 'tithes'
  | 'premiums'
  | 'claims'
  | 'interest'
  | 'loan'
  | 'repayment'
  | 'tax'
  | 'dividends'
  | 'purchases'
  | 'sales'
  | 'exports'
  | 'imports'
  | 'transfer'
  | 'capital'
  | 'losses'
  | 'fees'
  | 'other';

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  seq: number;
  entity: string;
  day: number;
  month: number;
  /** Source document reference (payslip, EMP201, VAT201, loan number ...). */
  ref: string;
  memo: string;
  lines: JournalLine[];
  counterparty: string | null;
  flow: FlowKind;
  prev: string;
  hash: string;
}

export interface YearClose {
  /** Label of the year of assessment, e.g. "2027" for 1 Mar 2026 – 28 Feb 2027. */
  year: string;
  /** Month index (from scenario start) of the closing entry. */
  month: number;
  income: IncomeStatement;
  balance: BalanceSheet;
  cashFlow: CashFlowStatement;
  /** Dividends declared during the year (folded into retained earnings at the close). */
  dividends: number;
}

export interface Book {
  id: string;
  name: string;
  kind: EntityKind;
  /** Net debit balance (debit − credit) by account, since inception for real accounts, since the last close for nominal accounts. */
  balances: Record<string, number>;
  /** Net debit movement by account for each month index (sparse). */
  movements: Array<{ month: number; m: Record<string, number> }>;
  /** Cash movement by month and cash-flow class. */
  cashFlows: Array<{ month: number; operating: number; investing: number; financing: number }>;
  /** Compact monthly performance for charts. */
  monthly: Array<{ month: number; revenue: number; expenses: number; profit: number; cash: number; assets: number; liabilities: number; equity: number }>;
  closes: YearClose[];
  openedMonth: number;
  closedMonth: number | null;
  entryCount: number;
  lastHash: string;
  lastCloseMonth: number;
}

export interface Journal {
  entries: JournalEntry[];
  /** Months of full journal kept in memory; older entries are pruned after their month-end digest is stored. */
  retentionMonths: number;
  seq: number;
  count: number;
  pruned: number;
  lastHash: string;
  monthDigests: Array<{ month: number; hash: string; count: number; debits: number }>;
}

export interface Ledgers {
  books: Record<string, Book>;
  journal: Journal;
}

export const GENESIS_HASH = '0000000000000000';

// ─── Hashing ────────────────────────────────────────────────────────────────

/** 64-bit FNV-1a as two 32-bit lanes (deterministic, dependency-free). */
export function fnv64(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function entryDigest(prev: string, e: Omit<JournalEntry, 'hash' | 'prev'>): string {
  const body = `${prev}|${e.seq}|${e.entity}|${e.day}|${e.month}|${e.ref}|${e.memo}|${e.counterparty ?? ''}|${e.flow}|${e.lines.map((l) => `${l.account}:${l.debit.toFixed(2)}:${l.credit.toFixed(2)}`).join(',')}`;
  return fnv64(body);
}

// ─── Books ──────────────────────────────────────────────────────────────────

export function createLedgers(retentionMonths: number): Ledgers {
  return {
    books: {},
    journal: { entries: [], retentionMonths, seq: 0, count: 0, pruned: 0, lastHash: GENESIS_HASH, monthDigests: [] },
  };
}

export function openBook(L: Ledgers, id: string, name: string, kind: EntityKind, month: number): Book {
  const existing = L.books[id];
  if (existing) return existing;
  const b: Book = { id, name, kind, balances: {}, movements: [], cashFlows: [], monthly: [], closes: [], openedMonth: month, closedMonth: null, entryCount: 0, lastHash: GENESIS_HASH, lastCloseMonth: month - 1 };
  L.books[id] = b;
  return b;
}

export interface PostInput {
  entity: string;
  day: number;
  month: number;
  ref: string;
  memo: string;
  lines: Array<{ account: string; debit?: number; credit?: number }>;
  counterparty?: string | null;
  flow?: FlowKind;
  /** Period-end transfer (year-end close): affects balances but not the period's activity. */
  closing?: boolean;
}

export class UnbalancedEntryError extends Error {}

/**
 * Post one balanced journal entry to an entity's book. Debits must equal
 * credits to the cent; zero lines are dropped; an unbalanced entry throws.
 */
export function post(L: Ledgers, input: PostInput): JournalEntry | null {
  const book = L.books[input.entity];
  if (!book) throw new Error(`No book for entity ${input.entity}`);
  const lines: JournalLine[] = [];
  let dr = 0;
  let cr = 0;
  for (const l of input.lines) {
    if (!ACCOUNT[l.account]) throw new Error(`Unknown account ${l.account}`);
    const d = r2(l.debit ?? 0);
    const c = r2(l.credit ?? 0);
    if (d < 0 || c < 0) {
      // Negative amounts are re-expressed on the other side so the journal reads naturally.
      const nd = d < 0 ? c - d : d;
      const nc = c < 0 ? d - c : c;
      if (nd - nc === 0) continue;
      lines.push({ account: l.account, debit: r2(Math.max(0, nd - nc)), credit: r2(Math.max(0, nc - nd)) });
    } else {
      if (d === 0 && c === 0) continue;
      lines.push({ account: l.account, debit: d, credit: c });
    }
  }
  for (const l of lines) {
    dr += l.debit;
    cr += l.credit;
  }
  if (Math.abs(dr - cr) > 0.011) throw new UnbalancedEntryError(`Unbalanced entry ${input.ref} for ${input.entity}: Dr ${dr.toFixed(2)} vs Cr ${cr.toFixed(2)} (${input.memo})`);
  if (!lines.length) return null;
  const J = L.journal;
  const seq = ++J.seq;
  const base = { seq, entity: input.entity, day: input.day, month: input.month, ref: input.ref, memo: input.memo, lines, counterparty: input.counterparty ?? null, flow: input.flow ?? 'other' };
  const hash = entryDigest(J.lastHash, base);
  const entry: JournalEntry = { ...base, prev: J.lastHash, hash };
  J.lastHash = hash;
  J.count++;
  J.entries.push(entry);
  // Ledger balances and movements (closing transfers touch balances only)
  if (input.closing) {
    for (const l of lines) book.balances[l.account] = r2((book.balances[l.account] ?? 0) + l.debit - l.credit);
    book.entryCount++;
    book.lastHash = hash;
    return entry;
  }
  let mv = book.movements[book.movements.length - 1];
  if (!mv || mv.month !== input.month) {
    mv = { month: input.month, m: {} };
    book.movements.push(mv);
  }
  let cashDelta = 0;
  let cls: 'operating' | 'investing' | 'financing' = 'operating';
  let clsWeight = 0;
  for (const l of lines) {
    const net = l.debit - l.credit;
    book.balances[l.account] = r2((book.balances[l.account] ?? 0) + net);
    mv.m[l.account] = r2((mv.m[l.account] ?? 0) + net);
    if (CASH_CODES.has(l.account)) cashDelta += net;
    else {
      const spec = ACCOUNT[l.account];
      const w = Math.abs(net);
      // Banks: deposits and loans are operating (IAS 7 allows it); everyone else: loans are financing, investments investing.
      let c = spec.cashFlow ?? 'operating';
      if (book.kind === 'bank' && (l.account === '2100' || l.account === '1150' || l.account === '1160')) c = 'operating';
      if (w > clsWeight) {
        clsWeight = w;
        cls = c;
      }
    }
  }
  if (cashDelta !== 0) {
    let cf = book.cashFlows[book.cashFlows.length - 1];
    if (!cf || cf.month !== input.month) {
      cf = { month: input.month, operating: 0, investing: 0, financing: 0 };
      book.cashFlows.push(cf);
    }
    cf[cls] = r2(cf[cls] + cashDelta);
  }
  book.entryCount++;
  book.lastHash = hash;
  return entry;
}

/** Signed balance in the account's natural sense (assets/expenses debit-positive, the rest credit-positive). */
export function natural(book: Book, code: string): number {
  const v = book.balances[code] ?? 0;
  const t = ACCOUNT[code].type;
  return t === 'asset' || t === 'expense' ? v : -v;
}

/** Net movement of an account over an inclusive month range, in natural sign. */
export function movement(book: Book, code: string, from: number, to: number): number {
  let s = 0;
  for (const mv of book.movements) if (mv.month >= from && mv.month <= to) s += mv.m[code] ?? 0;
  const t = ACCOUNT[code].type;
  return r2(t === 'asset' || t === 'expense' ? s : -s);
}

export function cashBalance(book: Book): number {
  let s = 0;
  for (const c of CASH_CODES) s += book.balances[c] ?? 0;
  return r2(s);
}

// ─── Statements ─────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  code: string;
  name: string;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export function trialBalance(book: Book): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  let td = 0;
  let tc = 0;
  for (const a of CHART) {
    const v = book.balances[a.code] ?? 0;
    if (Math.abs(v) < 0.005) continue;
    const debit = v > 0 ? v : 0;
    const credit = v < 0 ? -v : 0;
    rows.push({ code: a.code, name: a.name, debit: r2(debit), credit: r2(credit) });
    td += debit;
    tc += credit;
  }
  return { rows, totalDebit: r2(td), totalCredit: r2(tc), balanced: Math.abs(td - tc) < 0.011 };
}

export interface StatementLine {
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatement {
  from: number;
  to: number;
  revenue: StatementLine[];
  expenses: StatementLine[];
  totalRevenue: number;
  totalExpenses: number;
  /** Profit before tax (income tax expense 5350 is shown separately). */
  profitBeforeTax: number;
  incomeTax: number;
  netProfit: number;
}

export function incomeStatement(book: Book, from: number, to: number): IncomeStatement {
  const revenue: StatementLine[] = [];
  const expenses: StatementLine[] = [];
  let tr = 0;
  let te = 0;
  let tax = 0;
  for (const a of CHART) {
    if (a.type !== 'revenue' && a.type !== 'expense') continue;
    const v = movement(book, a.code, from, to);
    if (Math.abs(v) < 0.005) continue;
    if (a.type === 'revenue') {
      revenue.push({ code: a.code, name: a.name, amount: v });
      tr += v;
    } else if (a.code === '5350') tax += v;
    else {
      expenses.push({ code: a.code, name: a.name, amount: v });
      te += v;
    }
  }
  return { from, to, revenue, expenses, totalRevenue: r2(tr), totalExpenses: r2(te), profitBeforeTax: r2(tr - te), incomeTax: r2(tax), netProfit: r2(tr - te - tax) };
}

export interface BalanceSheet {
  month: number;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Profit since the last year-end close, shown inside equity. */
  currentEarnings: number;
  balanced: boolean;
}

export function balanceSheet(book: Book, month: number): BalanceSheet {
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let ta = 0;
  let tl = 0;
  let te = 0;
  let earnings = 0;
  for (const a of CHART) {
    const v = natural(book, a.code);
    if (a.type === 'revenue') earnings += v;
    else if (a.type === 'expense') earnings -= v;
    if (Math.abs(v) < 0.005) continue;
    if (a.type === 'asset') {
      assets.push({ code: a.code, name: a.name, amount: v });
      ta += v;
    } else if (a.type === 'liability') {
      liabilities.push({ code: a.code, name: a.name, amount: v });
      tl += v;
    } else if (a.type === 'equity') {
      equity.push({ code: a.code, name: a.name, amount: v });
      te += v;
    }
  }
  if (Math.abs(earnings) >= 0.005) equity.push({ code: '3090', name: 'Current-year earnings', amount: r2(earnings) });
  te += earnings;
  return { month, assets, liabilities, equity, totalAssets: r2(ta), totalLiabilities: r2(tl), totalEquity: r2(te), currentEarnings: r2(earnings), balanced: Math.abs(ta - tl - te) < 0.011 };
}

export interface CashFlowStatement {
  from: number;
  to: number;
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  opening: number;
  closing: number;
  reconciles: boolean;
}

export function cashFlowStatement(book: Book, from: number, to: number): CashFlowStatement {
  let o = 0;
  let i = 0;
  let f = 0;
  for (const cf of book.cashFlows) {
    if (cf.month < from || cf.month > to) continue;
    o += cf.operating;
    i += cf.investing;
    f += cf.financing;
  }
  const closing = cashBalance(book);
  // Opening cash = closing less all cash movements after `from` (movements are kept for every month).
  let after = 0;
  for (const cf of book.cashFlows) if (cf.month >= from) after += cf.operating + cf.investing + cf.financing;
  const opening = r2(closing - after);
  let beyond = 0;
  for (const cf of book.cashFlows) if (cf.month > to) beyond += cf.operating + cf.investing + cf.financing;
  const closingAtTo = r2(closing - beyond);
  const net = r2(o + i + f);
  return { from, to, operating: r2(o), investing: r2(i), financing: r2(f), netChange: net, opening, closing: closingAtTo, reconciles: Math.abs(opening + net - closingAtTo) < 0.011 };
}

export interface EquityStatement {
  opening: number;
  profit: number;
  capital: number;
  dividends: number;
  transfers: number;
  closing: number;
}

export function changesInEquity(book: Book, from: number, to: number): EquityStatement {
  const is = incomeStatement(book, from, to);
  const capital = movement(book, '3010', from, to);
  const dividends = movement(book, '3050', from, to);
  const transfers = movement(book, '3030', from, to);
  const bs = balanceSheet(book, to);
  const closing = bs.totalEquity;
  return { opening: r2(closing - is.netProfit - capital - dividends - transfers), profit: is.netProfit, capital, dividends, transfers, closing };
}

/** Ledger view of one account: running balance from the retained journal. */
export function ledgerLines(L: Ledgers, entity: string, code: string): Array<{ seq: number; day: number; month: number; ref: string; memo: string; debit: number; credit: number; balance: number }> {
  const book = L.books[entity];
  if (!book) return [];
  const out: Array<{ seq: number; day: number; month: number; ref: string; memo: string; debit: number; credit: number; balance: number }> = [];
  // Start from the balance before the retained window: current balance less retained movements.
  let retained = 0;
  for (const e of L.journal.entries) if (e.entity === entity) for (const l of e.lines) if (l.account === code) retained += l.debit - l.credit;
  let bal = (book.balances[code] ?? 0) - retained;
  const natSign = ACCOUNT[code].type === 'asset' || ACCOUNT[code].type === 'expense' ? 1 : -1;
  for (const e of L.journal.entries) {
    if (e.entity !== entity) continue;
    for (const l of e.lines) {
      if (l.account !== code) continue;
      bal += l.debit - l.credit;
      out.push({ seq: e.seq, day: e.day, month: e.month, ref: e.ref, memo: e.memo, debit: l.debit, credit: l.credit, balance: r2(bal * natSign) });
    }
  }
  return out;
}

// ─── Period-end ─────────────────────────────────────────────────────────────

/** Record a compact monthly snapshot for charts (call once per book at month end). */
export function snapshotMonth(book: Book, month: number): void {
  const is = incomeStatement(book, month, month);
  const bs = balanceSheet(book, month);
  book.monthly.push({ month, revenue: is.totalRevenue, expenses: r2(is.totalExpenses + is.incomeTax), profit: is.netProfit, cash: cashBalance(book), assets: bs.totalAssets, liabilities: bs.totalLiabilities, equity: bs.totalEquity });
  if (book.monthly.length > 600) book.monthly.shift();
}

/** Close the nominal accounts to retained earnings and file the annual statements. */
export function closeYear(L: Ledgers, book: Book, day: number, month: number, yearLabel: string): YearClose {
  const from = book.lastCloseMonth + 1;
  const is = incomeStatement(book, from, month);
  const cf = cashFlowStatement(book, from, month);
  const dividends = movement(book, '3050', from, month);
  const lines: PostInput['lines'] = [];
  let net = 0;
  for (const a of CHART) {
    if (a.type !== 'revenue' && a.type !== 'expense') continue;
    const v = book.balances[a.code] ?? 0;
    if (Math.abs(v) < 0.005) continue;
    // Reverse the balance
    lines.push(v > 0 ? { account: a.code, credit: v } : { account: a.code, debit: -v });
    net += v;
  }
  // Dividends declared reduce retained earnings.
  const div = book.balances['3050'] ?? 0;
  if (Math.abs(div) >= 0.005) {
    lines.push(div > 0 ? { account: '3050', credit: div } : { account: '3050', debit: -div });
    net += div;
  }
  // net > 0 means expenses (and distributions) exceeded revenue (debit balance overall) → reduces retained earnings.
  if (Math.abs(net) >= 0.005) lines.push(net > 0 ? { account: '3020', debit: net } : { account: '3020', credit: -net });
  if (lines.length) post(L, { entity: book.id, day, month, ref: `CLOSE-${yearLabel}`, memo: `Year-end close: ${yearLabel} profit or loss and distributions transferred to retained earnings`, lines, flow: 'other', closing: true });
  const bs = balanceSheet(book, month);
  const close: YearClose = { year: yearLabel, month, income: is, balance: bs, cashFlow: cf, dividends: r2(-dividends) };
  book.closes.push(close);
  book.lastCloseMonth = month;
  return close;
}

/** Store the month-end digest and prune journal entries older than the retention window. */
export function endOfMonth(L: Ledgers, month: number): void {
  const J = L.journal;
  let count = 0;
  let debits = 0;
  for (const e of J.entries) if (e.month === month) {
    count++;
    for (const l of e.lines) debits += l.debit;
  }
  J.monthDigests.push({ month, hash: J.lastHash, count, debits: r2(debits) });
  if (J.monthDigests.length > 600) J.monthDigests.shift();
  const cutoff = month - J.retentionMonths;
  let i = 0;
  while (i < J.entries.length && J.entries[i].month <= cutoff) i++;
  if (i > 0) {
    J.entries.splice(0, i);
    J.pruned += i;
  }
}

/** Recompute every retained entry's digest from its predecessor: the auditor's chain check. */
export function verifyChain(L: Ledgers): { ok: boolean; checked: number; firstBad: number | null } {
  const J = L.journal;
  let prev = J.entries.length ? J.entries[0].prev : GENESIS_HASH;
  for (let i = 0; i < J.entries.length; i++) {
    const e = J.entries[i];
    if (e.prev !== prev) return { ok: false, checked: i, firstBad: e.seq };
    const h = entryDigest(prev, { seq: e.seq, entity: e.entity, day: e.day, month: e.month, ref: e.ref, memo: e.memo, lines: e.lines, counterparty: e.counterparty, flow: e.flow });
    if (h !== e.hash) return { ok: false, checked: i, firstBad: e.seq };
    prev = e.hash;
  }
  if (J.entries.length && prev !== J.lastHash) return { ok: false, checked: J.entries.length, firstBad: null };
  return { ok: true, checked: J.entries.length, firstBad: null };
}

/**
 * Every book's trial balance must balance, and the bank's books must agree
 * with its members': deposits it owes equal what members hold at it, and
 * advances it holds equal what members owe it. Returns the exceptions.
 */
export function auditBooks(L: Ledgers, bankId = 'bank', outside: string[] = ['gov', 'row']): Array<{ entity: string; problem: string }> {
  const out: Array<{ entity: string; problem: string }> = [];
  let memberDeposits = 0;
  let memberLoans = 0;
  for (const id in L.books) {
    const b = L.books[id];
    const tb = trialBalance(b);
    if (!tb.balanced) out.push({ entity: id, problem: `trial balance out by R${(tb.totalDebit - tb.totalCredit).toFixed(2)}` });
    const bs = balanceSheet(b, 0);
    if (!bs.balanced) out.push({ entity: id, problem: `balance sheet does not balance (A ${bs.totalAssets} ≠ L ${bs.totalLiabilities} + E ${bs.totalEquity})` });
    if (id !== bankId && !outside.includes(id)) {
      memberDeposits += b.balances['1020'] ?? 0;
      memberLoans += -(b.balances['2050'] ?? 0);
    }
  }
  const bank = L.books[bankId];
  if (bank) {
    const dep = -(bank.balances['2100'] ?? 0);
    if (Math.abs(dep - memberDeposits) > 0.05) out.push({ entity: bankId, problem: `member deposits R${dep.toFixed(2)} do not agree with the members' bank balances R${memberDeposits.toFixed(2)}` });
    const adv = bank.balances['1150'] ?? 0;
    if (Math.abs(adv - memberLoans) > 0.05) out.push({ entity: bankId, problem: `advances R${adv.toFixed(2)} do not agree with the members' loan balances R${memberLoans.toFixed(2)}` });
  }
  return out;
}
