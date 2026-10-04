// The community's Mutual Bank, run under the Mutual Banks Act 124 of 1993:
// member shares as capital, member deposits as funding, loans to members as
// the main earning asset and liquid assets (Reserve Bank balances and treasury
// bills) for the prudential liquidity requirement. Credit risk follows the
// IFRS 9 three-stage model; the quarterly prudential return reports capital
// adequacy (Basel I risk weights, the regime mutual banks still report on),
// liquidity, non-performing loans and large exposures.

import { r2, natural } from './accounts';
import { BANK, GOV, ROW, deposits, pay, postInternal } from './posting';
import type { BankState, FinanceState, Loan, LoanPurpose, PrudentialReturn } from './state';

export const BANK_RULES: BankState['rules'] = {
  carMin: 0.1, // Mutual Banks Act minimum 10% of risk-weighted assets
  carBuffer: 0.025, // conservation buffer the board holds above the minimum
  liquidMin: 0.05, // prescribed liquid assets: 5% of liabilities to the public
  largeExposure: 0.1, // single exposure above 10% of capital needs board approval; 25% is the ceiling
  pd12: 0.045, // 12-month probability of default, stage 1
  pdLifetime: 0.28, // lifetime PD once 30 days past due
  lgd: 0.6, // loss given default on unsecured retail lending
  reserveTransfer: 0.1, // share of net profit transferred to the statutory reserve each year
  payoutRatio: 0.4, // dividend payout when capital is comfortably above target
  maxInstalmentShare: 0.3, // NCA affordability: instalment at most 30% of net income
  maxDebtService: 0.4, // all instalments at most 40% of net income
};

export function initBank(name: string, month: number, repo: number, foundingCapital = 0): BankState {
  return {
    name,
    foundedMonth: month,
    loans: {},
    nextLoan: 1,
    rates: ratesFor(repo),
    rules: { ...BANK_RULES },
    returns: [],
    shares: {},
    blocked: {},
    stats: { originated: 0, originatedAmount: 0, declined: 0, declinedReasons: {}, settled: 0, writtenOff: 0, writtenOffAmount: 0, dividendsPaid: 0, preferenceDividends: 0, interestPaid: 0, interestEarned: 0, tbillInterest: 0 },
    foundingCapital,
    monthly: [],
  };
}

/** Lending and deposit rates move with the repo rate (prime = repo + 3.5). */
export function ratesFor(repo: number): BankState['rates'] {
  const prime = repo + 0.035;
  return { deposit: Math.max(0.005, repo - 0.045), personal: prime + 0.05, business: prime + 0.02, emergency: prime + 0.04, tbill: Math.max(0.002, repo - 0.0025) };
}

/** Equal monthly instalment for an amortising loan. */
export function pmt(principal: number, annualRate: number, n: number): number {
  const r = annualRate / 12;
  if (n <= 0) return principal;
  if (r === 0) return r2(principal / n);
  return r2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export function amortisation(principal: number, annualRate: number, n: number): Array<{ k: number; opening: number; interest: number; principal: number; instalment: number; closing: number }> {
  const out = [];
  const inst = pmt(principal, annualRate, n);
  let bal = principal;
  for (let k = 1; k <= n; k++) {
    const interest = r2(bal * (annualRate / 12));
    const prin = k === n ? r2(bal) : r2(Math.min(bal, inst - interest));
    const closing = r2(bal - prin);
    out.push({ k, opening: r2(bal), interest, principal: prin, instalment: r2(prin + interest), closing });
    bal = closing;
  }
  return out;
}

export function loanRate(B: BankState, purpose: LoanPurpose): number {
  switch (purpose) {
    case 'working capital':
      return B.rates.business;
    case 'vehicle finance':
      return B.rates.personal - 0.04;
    case 'equipment finance':
      return B.rates.business - 0.005;
    case 'funeral':
    case 'medical':
    case 'legal':
      return B.rates.emergency;
    default:
      return B.rates.personal;
  }
}

export function defaultTerm(purpose: LoanPurpose, amount: number): number {
  switch (purpose) {
    case 'living costs':
      return amount > 15_000 ? 18 : 12;
    case 'funeral':
    case 'medical':
      return amount > 20_000 ? 24 : 12;
    case 'legal':
      return 12;
    case 'working capital':
      return 12;
    case 'home improvement':
      return 36;
    case 'vehicle finance':
      return 48;
    case 'equipment finance':
      return 60;
  }
}

/** NCA initiation fee: R165 plus 10% of the amount above R1,000, capped at R1,050, plus VAT. */
export function initiationFee(amount: number, vatRate: number): number {
  return r2(Math.min(1_050, 165 + 0.1 * Math.max(0, amount - 1_000)) * (1 + vatRate));
}

export function bankCapital(F: FinanceState): number {
  const b = F.ledgers.books[BANK];
  if (!b) return 0;
  let e = natural(b, '3010') + natural(b, '3020') + natural(b, '3030') + natural(b, '3050');
  // Current-year earnings count once audited; the board includes them net of a haircut.
  let ytd = 0;
  for (const code in b.balances) {
    const t = code[0];
    if (t === '4') ytd -= b.balances[code];
    else if (t === '5') ytd -= b.balances[code];
  }
  e += Math.min(0, ytd) + Math.max(0, ytd) * 0.5;
  return r2(e);
}

export function riskWeightedAssets(F: FinanceState): number {
  const b = F.ledgers.books[BANK];
  if (!b) return 0;
  const loans = Math.max(0, natural(b, '1150') - natural(b, '1160'));
  const other = natural(b, '1500') + natural(b, '1100');
  // Basel I: retail unsecured 100%, sovereign paper and central-bank balances 0%.
  return r2(loans * 1.0 + other * 1.0);
}

export function liquidAssets(F: FinanceState): number {
  const b = F.ledgers.books[BANK];
  return b ? r2(natural(b, '1030') + natural(b, '1600') + natural(b, '1010')) : 0;
}

export function bankDeposits(F: FinanceState): number {
  const b = F.ledgers.books[BANK];
  return b ? natural(b, '2100') : 0;
}

export interface LoanDecision {
  approved: boolean;
  reason: string;
  loan: Loan | null;
}

/** Board-approved credit policy applied to one application. */
export function requestLoan(F: FinanceState, borrower: string, amount: number, purpose: LoanPurpose, netIncome: number, day: number, month: number, vatRate: number): LoanDecision {
  const B = F.bank;
  const decline = (reason: string): LoanDecision => {
    B.stats.declined++;
    B.stats.declinedReasons[reason] = (B.stats.declinedReasons[reason] ?? 0) + 1;
    F.log.push({ day, kind: 'loan', text: `${F.entities[borrower]?.name ?? borrower}: loan of R${Math.round(amount).toLocaleString()} for ${purpose} declined (${reason}).`, entity: borrower });
    return { approved: false, reason, loan: null };
  };
  amount = r2(amount);
  if (amount < 500) return { approved: false, reason: 'below the minimum advance', loan: null };
  if ((B.blocked[borrower] ?? -1) > month) return decline('previous loan written off');
  const existing = Object.values(B.loans).filter((l) => l.status === 'active' && l.borrower === borrower);
  if (existing.some((l) => l.arrears >= 2)) return decline('existing loan in arrears');
  const rate = loanRate(B, purpose);
  const term = defaultTerm(purpose, amount);
  const inst = pmt(amount, rate, term);
  const service = existing.reduce((s, l) => s + l.instalment, 0);
  if (netIncome <= 0 || inst > B.rules.maxInstalmentShare * netIncome) return decline('instalment unaffordable');
  if (service + inst > B.rules.maxDebtService * netIncome) return decline('debt-service ratio too high');
  const capital = bankCapital(F);
  const exposure = existing.reduce((s, l) => s + l.balance, 0) + amount;
  if (capital <= 0 || exposure > 0.25 * capital) return decline('exposure above 25% of capital');
  const rwa = riskWeightedAssets(F) + amount;
  if (capital / Math.max(1, rwa) < B.rules.carMin + B.rules.carBuffer) return decline('capital adequacy');
  const dep = bankDeposits(F);
  if (liquidAssets(F) - amount < B.rules.liquidMin * (dep + amount) + 20_000) return decline('liquidity');
  const id = `L${B.nextLoan++}`;
  const loan: Loan = { id, borrower, purpose, principal: amount, balance: amount, rate, termMonths: term, instalment: inst, startMonth: month, monthsPaid: 0, arrears: 0, dpd: 0, stage: 1, provision: 0, status: 'active', endMonth: null };
  B.loans[id] = loan;
  const name = F.entities[borrower]?.name ?? borrower;
  pay(F, { from: BANK, to: borrower, amount, day, month, ref: `LOAN-${id}`, memo: `Loan ${id} advanced to ${name}: ${purpose}, ${term} months at ${(rate * 100).toFixed(2)}%`, flow: 'loan', fromAccount: '1150', toAccount: '2050' });
  const fee = initiationFee(amount, vatRate);
  pay(F, { from: borrower, to: BANK, amount: fee, day, month, ref: `LOAN-${id}`, memo: `Initiation fee on loan ${id}`, flow: 'fees', fromAccount: '5130', toAccount: '4100' });
  provisionLoan(F, loan, day, month);
  B.stats.originated++;
  B.stats.originatedAmount += amount;
  F.log.push({ day, kind: 'loan', text: `${B.name} advanced R${Math.round(amount).toLocaleString()} to ${name} for ${purpose} (${term} months at ${(rate * 100).toFixed(2)}%, instalment R${Math.round(inst).toLocaleString()}).`, entity: borrower });
  if (exposure > B.rules.largeExposure * capital) F.log.push({ day, kind: 'bank', text: `Large exposure: ${name} now owes ${((exposure / capital) * 100).toFixed(1)}% of the bank's capital (board approval minuted).`, entity: borrower });
  return { approved: true, reason: 'approved', loan };
}

/**
 * Early settlement (in part or in full) from the borrower's deposit: the
 * capital comes off the loan, and a loan paid up releases its provision.
 * Returns the amount applied.
 */
export function prepayLoan(F: FinanceState, loan: Loan, amount: number, day: number, month: number, memo = 'Early settlement'): number {
  if (loan.status !== 'active') return 0;
  const paid = r2(Math.min(amount, loan.balance));
  if (paid <= 0) return 0;
  pay(F, { from: loan.borrower, to: BANK, amount: paid, day, month, ref: `LOAN-${loan.id}`, memo: `${memo}: capital repaid on loan ${loan.id}`, flow: 'repayment', fromAccount: '2050', toAccount: '1150' });
  loan.balance = r2(loan.balance - paid);
  if (loan.balance <= 0.01) {
    loan.balance = 0;
    loan.status = 'settled';
    loan.endMonth = month;
    F.bank.stats.settled++;
    F.log.push({ day, kind: 'loan', text: `${F.entities[loan.borrower]?.name ?? loan.borrower} settled loan ${loan.id} early.`, entity: loan.borrower });
  }
  provisionLoan(F, loan, day, month);
  return paid;
}

function provisionLoan(F: FinanceState, loan: Loan, day: number, month: number): void {
  const R = F.bank.rules;
  const target = loan.status !== 'active' ? 0 : r2(loan.balance * (loan.stage === 3 ? R.lgd : loan.stage === 2 ? R.pdLifetime * R.lgd : R.pd12 * R.lgd));
  const delta = r2(target - loan.provision);
  if (Math.abs(delta) < 0.01) return;
  postInternal(F, BANK, day, month, `ECL-${loan.id}`, `Expected credit loss on ${loan.id} (stage ${loan.stage})`, delta > 0 ? [{ account: '5280', debit: delta }, { account: '1160', credit: delta }] : [{ account: '1160', debit: -delta }, { account: '5280', credit: -delta }]);
  loan.provision = target;
}

/** Interest on member deposits, instalment collection, staging, write-offs, provisions and liquidity placement. */
export function bankMonthEnd(F: FinanceState, day: number, month: number, members: string[], cpiFactor: number): Record<string, number> {
  const B = F.bank;
  const interestByMember: Record<string, number> = {};
  // Deposit interest on credit balances; an overdrawn account is priced credit, not a free loan.
  for (const m of members) {
    const bal = deposits(F, m);
    if (bal < -1) {
      const oi = r2(-bal * (B.rates.business / 12));
      if (oi >= 0.01) {
        pay(F, { from: m, to: BANK, amount: oi, day, month, ref: `OD-${month}`, memo: `Interest on the overdrawn account at ${(B.rates.business * 100).toFixed(2)}%`, flow: 'interest', fromAccount: '5100', toAccount: '4030' });
        B.stats.interestEarned += oi;
      }
      continue;
    }
    if (bal <= 0) continue;
    const i = r2(bal * (B.rates.deposit / 12));
    if (i < 0.01) continue;
    pay(F, { from: BANK, to: m, amount: i, day, month, ref: `INT-${month}`, memo: `Interest on deposits at ${(B.rates.deposit * 100).toFixed(2)}%`, flow: 'interest', fromAccount: '5290', toAccount: '4030' });
    interestByMember[m] = i;
    B.stats.interestPaid += i;
  }
  // Loan book
  for (const id in B.loans) {
    const loan = B.loans[id];
    if (loan.status !== 'active' || loan.startMonth === month) continue;
    const name = F.entities[loan.borrower]?.name ?? loan.borrower;
    const interest = r2(loan.balance * (loan.rate / 12));
    const due = r2(Math.min(loan.instalment, loan.balance + interest));
    const avail = Math.max(0, deposits(F, loan.borrower));
    const paid = r2(Math.min(due, avail));
    const intPaid = r2(Math.min(interest, paid));
    const prinPaid = r2(paid - intPaid);
    if (intPaid > 0) pay(F, { from: loan.borrower, to: BANK, amount: intPaid, day, month, ref: `LOAN-${loan.id}`, memo: `Interest on loan ${loan.id}`, flow: 'interest', fromAccount: '5100', toAccount: '4030' });
    if (prinPaid > 0) pay(F, { from: loan.borrower, to: BANK, amount: prinPaid, day, month, ref: `LOAN-${loan.id}`, memo: `Capital repayment on loan ${loan.id}`, flow: 'repayment', fromAccount: '2050', toAccount: '1150' });
    B.stats.interestEarned += intPaid;
    loan.balance = r2(loan.balance - prinPaid);
    const unpaidInterest = r2(interest - intPaid);
    if (unpaidInterest > 0) {
      // Capitalise the interest not met this month.
      postInternal(F, BANK, day, month, `LOAN-${loan.id}`, `Interest capitalised on loan ${loan.id}`, [{ account: '1150', debit: unpaidInterest }, { account: '4030', credit: unpaidInterest }], 'interest', loan.borrower);
      if (F.ledgers.books[loan.borrower]) postInternal(F, loan.borrower, day, month, `LOAN-${loan.id}`, `Interest capitalised on loan ${loan.id}`, [{ account: '5100', debit: unpaidInterest }, { account: '2050', credit: unpaidInterest }], 'interest', BANK);
      loan.balance = r2(loan.balance + unpaidInterest);
    }
    if (paid + 0.01 < due) {
      loan.arrears++;
      loan.dpd += 30;
      if (loan.arrears === 1) F.log.push({ day, kind: 'bank', text: `${name} missed the instalment on loan ${loan.id}.`, entity: loan.borrower });
    } else {
      loan.monthsPaid++;
      if (loan.arrears > 0) F.log.push({ day, kind: 'bank', text: `${name} caught up on loan ${loan.id}.`, entity: loan.borrower });
      loan.arrears = 0;
      loan.dpd = 0;
    }
    loan.stage = loan.dpd >= 90 ? 3 : loan.dpd >= 30 ? 2 : 1;
    if (loan.balance <= 0.01) {
      loan.status = 'settled';
      loan.endMonth = month;
      B.stats.settled++;
      F.log.push({ day, kind: 'loan', text: `${name} settled loan ${loan.id}.`, entity: loan.borrower });
    } else if (loan.dpd >= 180) {
      // Write off against the allowance; the shortfall hits the income statement.
      const cover = Math.min(loan.provision, loan.balance);
      const shortfall = r2(loan.balance - cover);
      const lines = [{ account: '1160', debit: cover }, ...(shortfall > 0 ? [{ account: '5280', debit: shortfall }] : []), { account: '1150', credit: loan.balance }];
      postInternal(F, BANK, day, month, `WO-${loan.id}`, `Loan ${loan.id} written off (${loan.dpd} days past due)`, lines, 'losses', loan.borrower);
      if (F.ledgers.books[loan.borrower]) postInternal(F, loan.borrower, day, month, `WO-${loan.id}`, `Loan ${loan.id} written off by the bank`, [{ account: '2050', debit: loan.balance }, { account: '4900', credit: loan.balance }], 'losses', BANK);
      loan.provision = 0;
      loan.status = 'written-off';
      loan.endMonth = month;
      B.stats.writtenOff++;
      B.stats.writtenOffAmount += loan.balance;
      B.blocked[loan.borrower] = month + 36;
      F.log.push({ day, kind: 'bank', text: `${B.name} wrote off R${Math.round(loan.balance).toLocaleString()} owed by ${name} (loan ${loan.id}).`, entity: loan.borrower });
      loan.balance = 0;
    }
    provisionLoan(F, loan, day, month);
  }
  // Treasury: interest on treasury bills, then rebalance liquid assets.
  const book = F.ledgers.books[BANK];
  const tbills = natural(book, '1600');
  if (tbills > 0) {
    const i = r2(tbills * (B.rates.tbill / 12));
    if (i > 0) pay(F, { from: ROW, to: BANK, amount: i, day, month, ref: `TB-${month}`, memo: 'Interest on treasury bills', flow: 'interest', fromAccount: '5370', toAccount: '4030' });
    B.stats.tbillInterest += i;
  }
  const dep = bankDeposits(F);
  const settlement = natural(book, '1030');
  const target = Math.max(60_000, 0.12 * dep);
  const move = r2(settlement - target);
  if (move > 5_000) postInternal(F, BANK, day, month, `TB-${month}`, 'Surplus liquidity placed in treasury bills', [{ account: '1600', debit: move }, { account: '1030', credit: move }], 'capital', ROW);
  else if (move < -5_000) {
    const sell = r2(Math.min(-move, natural(book, '1600')));
    if (sell > 0) postInternal(F, BANK, day, month, `TB-${month}`, 'Treasury bills redeemed for liquidity', [{ account: '1030', debit: sell }, { account: '1600', credit: sell }], 'capital', ROW);
  }
  // Running costs (systems, audit, insurance, regulator levies)
  const admin = r2(5_500 * cpiFactor);
  pay(F, { from: BANK, to: ROW, amount: admin, day, month, ref: `ADM-${month}`, memo: 'Administration: systems, audit fee, insurance, Prudential Authority levy', flow: 'imports', fromAccount: '5320', toAccount: '4040' });
  // Monthly metrics
  const loans = natural(book, '1150');
  const allowance = natural(book, '1160');
  const npl = Object.values(B.loans).filter((l) => l.status === 'active' && l.stage === 3).reduce((s, l) => s + l.balance, 0);
  const capital = bankCapital(F);
  const rwa = riskWeightedAssets(F);
  const mv = book.movements[book.movements.length - 1]?.month === month ? book.movements[book.movements.length - 1].m : {};
  B.monthly.push({ month, deposits: dep, loans, allowance, npl: r2(npl), capital, car: rwa > 0 ? capital / rwa : 9.99, liquidity: dep > 0 ? liquidAssets(F) / dep : 9.99, interestIncome: -(mv['4030'] ?? 0), interestExpense: mv['5290'] ?? 0, impairment: mv['5280'] ?? 0, profit: 0 });
  if (B.monthly.length > 600) B.monthly.shift();
  return interestByMember;
}

/** Quarterly prudential return to the Prudential Authority. */
export function prudentialReturn(F: FinanceState, month: number, label: string): PrudentialReturn {
  const B = F.bank;
  const book = F.ledgers.books[BANK];
  const capital = bankCapital(F);
  const rwa = riskWeightedAssets(F);
  const dep = bankDeposits(F);
  const liquid = liquidAssets(F);
  const loansGross = natural(book, '1150');
  const allowance = natural(book, '1160');
  const active = Object.values(B.loans).filter((l) => l.status === 'active');
  const npl = active.filter((l) => l.stage === 3).reduce((s, l) => s + l.balance, 0);
  const byBorrower: Record<string, number> = {};
  for (const l of active) byBorrower[l.borrower] = (byBorrower[l.borrower] ?? 0) + l.balance;
  const largest = Math.max(0, ...Object.values(byBorrower));
  const car = rwa > 0 ? capital / rwa : 9.99;
  const liq = dep > 0 ? liquid / dep : 9.99;
  const breaches: string[] = [];
  if (car < B.rules.carMin) breaches.push(`capital adequacy ${(car * 100).toFixed(1)}% below the ${(B.rules.carMin * 100).toFixed(0)}% minimum`);
  if (liq < B.rules.liquidMin) breaches.push(`liquid assets ${(liq * 100).toFixed(1)}% below the ${(B.rules.liquidMin * 100).toFixed(0)}% requirement`);
  if (capital > 0 && largest > 0.25 * capital) breaches.push('a single exposure exceeds 25% of capital');
  // Net interest margin and return on equity over the last 12 months
  const last12 = B.monthly.slice(-12);
  const nii = last12.reduce((s, m) => s + m.interestIncome - m.interestExpense, 0);
  const earning = loansGross - allowance + natural(book, '1600') + natural(book, '1030');
  const nim = earning > 0 ? (nii * (12 / Math.max(1, last12.length))) / earning : 0;
  const profit12 = book.monthly.slice(-12).reduce((s, m) => s + m.profit, 0) * (12 / Math.max(1, Math.min(12, book.monthly.length)));
  const roe = capital > 0 ? profit12 / capital : 0;
  const ret: PrudentialReturn = { month, label, qualifyingCapital: capital, rwa, car, liquidAssets: liquid, deposits: dep, liquidityRatio: liq, loansGross, allowance, npl: r2(npl), nplRatio: loansGross > 0 ? npl / loansGross : 0, coverage: npl > 0 ? allowance / npl : 0, largestExposure: r2(largest), largestShare: capital > 0 ? largest / capital : 0, nim, roe, breaches };
  B.returns.push(ret);
  if (B.returns.length > 200) B.returns.shift();
  return ret;
}

/** After the year-end close: statutory reserve transfer and the dividend on member shares. */
export function bankYearEnd(F: FinanceState, day: number, month: number, yearLabel: string, netProfit: number, repo: number, dividendsTaxRate: number): void {
  const B = F.bank;
  // The founding preference shares are non-cumulative: their dividend (half the repo rate) is paid only out of the year's profit.
  let distributable = netProfit;
  if (B.foundingCapital > 0 && netProfit > 0) {
    const pref = r2(Math.min(B.foundingCapital * repo * 0.5, netProfit));
    if (pref > 1) {
      pay(F, { from: BANK, to: ROW, amount: pref, day, month, ref: `PREF-${yearLabel}`, memo: 'Preference dividend on founding shares for the year, at half the repo rate (non-cumulative)', flow: 'dividends', fromAccount: '3050', toAccount: '4900' });
      B.stats.preferenceDividends += pref;
      distributable = r2(netProfit - pref);
    }
  }
  if (netProfit > 0) {
    const transfer = r2(netProfit * B.rules.reserveTransfer);
    postInternal(F, BANK, day, month, `RES-${yearLabel}`, `Transfer of ${(B.rules.reserveTransfer * 100).toFixed(0)}% of net profit to the statutory reserve`, [{ account: '3020', debit: transfer }, { account: '3030', credit: transfer }], 'capital');
  }
  const capital = bankCapital(F);
  const rwa = riskWeightedAssets(F);
  const car = rwa > 0 ? capital / rwa : 9.99;
  if (distributable <= 0 || car < B.rules.carMin + B.rules.carBuffer + 0.05) return;
  const totalShares = Object.values(B.shares).reduce((s, v) => s + v, 0);
  if (totalShares <= 0) return;
  const pool = r2(distributable * B.rules.payoutRatio);
  let paid = 0;
  for (const holder in B.shares) {
    if (!F.ledgers.books[holder]) continue;
    const gross = r2((pool * B.shares[holder]) / totalShares);
    if (gross < 1) continue;
    const dt = r2(gross * dividendsTaxRate);
    const net = r2(gross - dt);
    pay(F, { from: BANK, to: holder, amount: net, day, month, ref: `DIV-${yearLabel}`, memo: `Dividend on member shares for ${yearLabel} (net of 20% dividends tax)`, flow: 'dividends', fromAccount: '3050', toAccount: '4120' });
    pay(F, { from: BANK, to: GOV, amount: dt, day, month, ref: `DTR01-${yearLabel}`, memo: `Dividends tax withheld on ${F.entities[holder]?.name ?? holder}'s dividend`, flow: 'tax', fromAccount: '3050', toAccount: '4138' });
    F.tax.collected.dividends += dt;
    paid += gross;
  }
  if (paid > 0) {
    B.stats.dividendsPaid += paid;
    F.log.push({ day, kind: 'dividend', text: `${B.name} declared a dividend of R${Math.round(paid).toLocaleString()} on member shares for ${yearLabel} (payout ${(B.rules.payoutRatio * 100).toFixed(0)}% of profit, CAR ${(car * 100).toFixed(1)}%).` });
  }
}
