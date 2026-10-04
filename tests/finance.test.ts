import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/sim/engine';
import { auditBooks, balanceSheet, cashFlowStatement, createLedgers, incomeStatement, openBook, post, trialBalance, verifyChain, UnbalancedEntryError, closeYear } from '../src/sim/finance/accounts';
import { amortisation, pmt } from '../src/sim/finance/bank';
import { gini, lorenz } from '../src/sim/finance/macro';
import { clearProduceMarket, initMicro } from '../src/sim/finance/micro';
import { SARS_2026_27, annualTax, assessIndividual, bracketTax, companyTax, indexTables, payeMonthly, sdlMonthly, taxThreshold, uifMonthly, vatOnInclusive } from '../src/sim/finance/tax';

describe('SARS 2026/27 tables', () => {
  const T = SARS_2026_27;
  test('bracket tax matches the published cumulative amounts', () => {
    expect(bracketTax(245_100, T.brackets)).toBe(44_118);
    expect(bracketTax(383_100, T.brackets)).toBe(79_998);
    expect(bracketTax(1_878_600, T.brackets)).toBe(666_339);
    expect(bracketTax(360_000, T.brackets)).toBe(44_118 + 0.26 * (360_000 - 245_100));
  });
  test('thresholds follow from the rebates', () => {
    expect(taxThreshold(40, T)).toBe(99_000);
    expect(taxThreshold(65, T)).toBe(153_250);
    expect(taxThreshold(75, T)).toBe(171_300);
    expect(annualTax(99_000, 40, T)).toBe(0);
    expect(annualTax(99_001, 40, T)).toBeGreaterThan(0);
  });
  test('PAYE by the annual-equivalent method', () => {
    // R30,000 a month: annual 360,000 → 73,992 less the primary rebate 17,820 = 56,172 → 4,681 a month
    expect(payeMonthly(30_000, 35, T)).toBe(4_681);
    // A pensioner of 70 on R12,000 a month is below the 65+ threshold
    expect(payeMonthly(12_000, 70, T)).toBe(0);
    // Medical credits reduce PAYE: two beneficiaries = R376 × 2 a month
    expect(payeMonthly(30_000, 35, T, 2)).toBe(4_681 - 752);
  });
  test('UIF is 1% capped at the R17,712 ceiling and SDL applies above R500k payroll', () => {
    expect(uifMonthly(10_000, T)).toBe(100);
    expect(uifMonthly(25_000, T)).toBe(177.12);
    expect(sdlMonthly(40_000, 480_000, T)).toBe(0);
    expect(sdlMonthly(40_000, 520_000, T)).toBe(400);
  });
  test('VAT split and company taxes', () => {
    const v = vatOnInclusive(1_150, 1, T);
    expect(v.vat).toBe(150);
    expect(v.excl).toBe(1_000);
    expect(vatOnInclusive(1_000, 0, T).vat).toBe(0);
    expect(companyTax(1_000_000, 'cit', 0, T)).toBe(270_000);
    expect(companyTax(99_000, 'sbc', 0, T)).toBe(0);
    expect(companyTax(365_000, 'sbc', 0, T)).toBe(18_620);
    expect(companyTax(600_000, 'sbc', 0, T)).toBe(57_470 + 0.27 * 50_000);
    expect(companyTax(0, 'turnover', 600_000, T)).toBe(0);
    expect(companyTax(0, 'turnover', 950_000, T)).toBe(3_500);
    expect(companyTax(0, 'turnover', 1_400_000, T)).toBe(12_500);
  });
  test('ITR12 assessment refunds PAYE over-withheld on a part year', () => {
    // Five months at R30,000: PAYE 5 × 4,681 = 23,405 withheld; tax on 150,000 = 27,000 − 17,820 = 9,180
    const a = assessIndividual({ age: 35, remuneration: 150_000, payeWithheld: 23_405, interest: 0, donations: 0, s18a: false, medicalBeneficiaries: 0, medicalMonths: 0 }, T);
    expect(a.taxPayable).toBe(9_180);
    expect(a.balance).toBe(-14_225);
    // Interest above the exemption is taxed; below it is not
    expect(assessIndividual({ age: 35, remuneration: 300_000, payeWithheld: 0, interest: 30_000, donations: 0, s18a: false, medicalBeneficiaries: 0, medicalMonths: 0 }, T).taxableInterest).toBe(6_200);
  });
  test('indexation keeps the bracket structure', () => {
    const T2 = indexTables(T, 1.05, '2028');
    expect(T2.brackets[1].from).toBe(257_400);
    expect(T2.brackets[1].base).toBeCloseTo(257_400 * 0.18, 2);
    expect(T2.primaryRebate).toBe(Math.round(17_820 * 1.05));
  });
});

describe('double-entry core', () => {
  test('rejects an unbalanced entry and keeps the trial balance balanced', () => {
    const L = createLedgers(12);
    openBook(L, 'a', 'A', 'business', 0);
    expect(() => post(L, { entity: 'a', day: 0, month: 0, ref: 'x', memo: 'bad', lines: [{ account: '1020', debit: 100 }, { account: '4040', credit: 90 }] })).toThrow(UnbalancedEntryError);
    post(L, { entity: 'a', day: 0, month: 0, ref: 'OPEN', memo: 'capital', lines: [{ account: '1020', debit: 1000 }, { account: '3010', credit: 1000 }] });
    post(L, { entity: 'a', day: 1, month: 0, ref: 'S1', memo: 'sale', lines: [{ account: '1020', debit: 230 }, { account: '4040', credit: 200 }, { account: '2230', credit: 30 }] });
    post(L, { entity: 'a', day: 2, month: 0, ref: 'P1', memo: 'stock', lines: [{ account: '5200', debit: 120 }, { account: '1020', credit: 120 }] });
    const tb = trialBalance(L.books.a);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(1110 + 120);
    const is = incomeStatement(L.books.a, 0, 0);
    expect(is.netProfit).toBe(80);
    const bs = balanceSheet(L.books.a, 0);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(1110);
    expect(bs.currentEarnings).toBe(80);
    const cf = cashFlowStatement(L.books.a, 0, 0);
    expect(cf.reconciles).toBe(true);
    expect(cf.closing).toBe(1110);
    expect(cf.financing).toBe(1000);
    expect(cf.operating).toBe(110);
  });
  test('the hash chain verifies and detects tampering', () => {
    const L = createLedgers(12);
    openBook(L, 'a', 'A', 'business', 0);
    for (let i = 0; i < 20; i++) post(L, { entity: 'a', day: i, month: 0, ref: `E${i}`, memo: 'x', lines: [{ account: '1020', debit: 10 }, { account: '4040', credit: 10 }] });
    expect(verifyChain(L).ok).toBe(true);
    L.journal.entries[7].lines[0].debit = 11;
    const v = verifyChain(L);
    expect(v.ok).toBe(false);
    expect(v.firstBad).toBe(8);
  });
  test('year-end close moves profit to retained earnings without touching the period activity', () => {
    const L = createLedgers(12);
    openBook(L, 'a', 'A', 'business', 0);
    post(L, { entity: 'a', day: 0, month: 0, ref: 'OPEN', memo: 'capital', lines: [{ account: '1020', debit: 1000 }, { account: '3010', credit: 1000 }] });
    post(L, { entity: 'a', day: 1, month: 1, ref: 'S', memo: 'sale', lines: [{ account: '1020', debit: 500 }, { account: '4040', credit: 500 }] });
    closeYear(L, L.books.a, 40, 1, '2027');
    expect(incomeStatement(L.books.a, 0, 1).netProfit).toBe(500);
    const bs = balanceSheet(L.books.a, 1);
    expect(bs.currentEarnings).toBe(0);
    expect(bs.equity.find((l) => l.code === '3020')?.amount).toBe(500);
    expect(bs.balanced).toBe(true);
  });
});

describe('bank mathematics', () => {
  test('amortisation repays exactly the principal', () => {
    const s = amortisation(10_000, 0.1525, 12);
    expect(s.length).toBe(12);
    expect(s[11].closing).toBe(0);
    const capital = s.reduce((a, r) => a + r.principal, 0);
    expect(capital).toBeCloseTo(10_000, 1);
    expect(pmt(10_000, 0.1525, 12)).toBeCloseTo(904.15, 0);
  });
});

describe('markets and inequality', () => {
  test('a poorer harvest raises the produce price and pulls in imports at parity', () => {
    const S = initMicro();
    const good = clearProduceMarket(S, 0, { isoDate: '2026-01', spend: 20_000, capacity: 20_000, yield: 1, priceLevel: 1 });
    const bad = clearProduceMarket(S, 1, { isoDate: '2026-02', spend: 20_000, capacity: 20_000, yield: 0.5, priceLevel: 1 });
    expect(bad.price).toBeGreaterThan(good.price);
    expect(bad.price).toBeLessThanOrEqual(bad.importParity + 1e-9);
    expect(bad.imports).toBeGreaterThan(0);
    expect(good.imports).toBe(0);
  });
  test('Gini and Lorenz behave', () => {
    expect(gini([1, 1, 1, 1])).toBe(0);
    expect(gini([0, 0, 0, 10])).toBeGreaterThan(0.7);
    const l = lorenz([1, 2, 3, 4]);
    expect(l[0]).toEqual([0, 0]);
    expect(l[l.length - 1][1]).toBeCloseTo(1, 9);
  });
});

describe('the community books over a simulated year', () => {
  const sim = new Simulation({ seed: 'finance-test', households: 10 });
  sim.runDays(400);
  const F = sim.world.finance;
  test('every book balances, articulates and the chain is intact', () => {
    expect(auditBooks(F.ledgers)).toEqual([]);
    expect(verifyChain(F.ledgers).ok).toBe(true);
    for (const id in F.ledgers.books) {
      const b = F.ledgers.books[id];
      expect(trialBalance(b).balanced).toBe(true);
      expect(cashFlowStatement(b, 0, F.month).reconciles).toBe(true);
    }
  });
  test('the bank mirrors its members: deposits equal the members\' bank balances', () => {
    let members = 0;
    for (const id in F.ledgers.books) if (id !== 'bank' && id !== 'gov' && id !== 'row') members += F.ledgers.books[id].balances['1020'] ?? 0;
    expect(Math.abs(members - -(F.ledgers.books.bank.balances['2100'] ?? 0))).toBeLessThan(1);
  });
  test('household savings mirror the ledger and PAYE was remitted to SARS', () => {
    for (const id in sim.world.households) {
      const hh = sim.world.households[id];
      if (hh.dissolvedDay) continue;
      const b = F.ledgers.books[`hh:${id}`];
      expect(Math.abs(hh.savings - (b.balances['1020'] ?? 0))).toBeLessThan(1);
    }
    expect(F.tax.collected.paye).toBeGreaterThan(0);
    expect(F.tax.filings.some((f) => f.kind === 'EMP201' && f.status === 'paid')).toBe(true);
    expect(F.tax.filings.some((f) => f.kind === 'VAT201')).toBe(true);
    expect(F.ledgers.books.gov.closes.length).toBeGreaterThan(0);
  });
  test('national accounts reconcile by the income approach and macro series exist', () => {
    const m = F.macro.months[F.macro.months.length - 1];
    expect(m.gdpIncome).toBeCloseTo(m.gdpProduction, 0);
    expect(Math.abs(m.discrepancy) / m.gdpProduction).toBeLessThan(0.15);
    expect(F.macro.quarters.length).toBeGreaterThan(2);
    expect(m.cpi).toBeGreaterThan(90);
    expect(m.cpi).toBeLessThan(130);
  });
  test('runs are deterministic for a seed', () => {
    const again = new Simulation({ seed: 'finance-test', households: 10 });
    again.runDays(400);
    expect(again.world.finance.ledgers.journal.lastHash).toBe(F.ledgers.journal.lastHash);
    expect(again.world.finance.ledgers.journal.count).toBe(F.ledgers.journal.count);
    // (400 simulated days take a few seconds, more on a busy machine.)
  }, 60_000);
});
