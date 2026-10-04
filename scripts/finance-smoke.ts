// Runs the finance engine for a few years and prints the audit checks.
// Usage: bun scripts/finance-smoke.ts [years] [seed]
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { auditBooks, balanceSheet, cashFlowStatement, incomeStatement, natural, trialBalance, verifyChain } from '../src/sim/finance/accounts';
import { prudentialReturn } from '../src/sim/finance/bank';

const years = Number(process.argv[2] ?? 3);
const seed = process.argv[3] ?? 'finance-1';
const t0 = performance.now();
const sim = new Simulation({ seed });
sim.runDays(Math.round(years * 365.25));
const w = sim.world;
const F = w.finance;
const L = F.ledgers;
console.log(`ran ${years}y in ${((performance.now() - t0) / 1000).toFixed(1)}s · pop ${alivePeople(w).length} · journal ${L.journal.count} entries (${L.journal.entries.length} retained, ${L.journal.pruned} pruned)`);
console.log('chain', verifyChain(L));
console.log('audit exceptions', auditBooks(L));
const m = F.macro.months[F.macro.months.length - 1];
console.log('macro', JSON.stringify({ cpi: m.cpi, infl: (m.inflYoY * 100).toFixed(2) + '%', repo: (m.repo * 100).toFixed(2) + '%', gdpNominal: Math.round(m.gdpNominal), gdpReal: Math.round(m.gdpReal), gap: (m.gap * 100).toFixed(1) + '%', discrepancy: Math.round(m.discrepancy), C: Math.round(m.consumption), G: Math.round(m.government), X: Math.round(m.exports), M: Math.round(m.imports), u: (m.unemploymentRate * 100).toFixed(1) + '%', tax: Math.round(m.taxRevenue), spend: Math.round(m.govSpending), transfer: Math.round(m.fiscalTransfer), gini: m.giniIncome, wageIndex: m.wageIndex.toFixed(3) }));
const bank = L.books.bank;
const bs = balanceSheet(bank, F.month);
console.log('bank BS', bs.assets.map((a) => `${a.name}: ${Math.round(a.amount)}`).join(' | '), '|| L', bs.liabilities.map((a) => `${a.name}: ${Math.round(a.amount)}`).join(' | '), '|| E', bs.equity.map((a) => `${a.name}: ${Math.round(a.amount)}`).join(' | '), 'balanced', bs.balanced);
const ret = prudentialReturn(F, F.month, 'now');
console.log('prudential', JSON.stringify({ car: (ret.car * 100).toFixed(1) + '%', liq: (ret.liquidityRatio * 100).toFixed(1) + '%', loans: Math.round(ret.loansGross), npl: (ret.nplRatio * 100).toFixed(1) + '%', coverage: ret.coverage.toFixed(2), nim: (ret.nim * 100).toFixed(2) + '%', roe: (ret.roe * 100).toFixed(1) + '%', breaches: ret.breaches }));
console.log('loans', JSON.stringify(F.bank.stats), 'active', Object.values(F.bank.loans).filter((l) => l.status === 'active').length);
console.log('tax collected', JSON.stringify(Object.fromEntries(Object.entries(F.tax.collected).map(([k, v]) => [k, Math.round(v)]))));
console.log('compliance', Object.entries(F.tax.compliance).filter(([, c]) => c.status !== 'compliant').map(([e, c]) => `${e}: outstanding ${Math.round(c.outstanding)} penalties ${Math.round(c.penalties)}`));
console.log('filings', F.tax.filings.length, 'by kind', F.tax.filings.reduce((a: Record<string, number>, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {}), 'outstanding', F.tax.filings.filter((f) => f.status === 'outstanding').length);
const assessed = Object.values(F.tax.personYears).filter((r) => r.assessed);
console.log('ITR12 assessed', assessed.length, 'sample', assessed.slice(0, 2).map((r) => ({ name: r.name, rem: Math.round(r.remuneration), paye: Math.round(r.paye), tax: r.assessed!.taxPayable, bal: r.assessed!.balance })));
for (const id of ['market', 'farm', 'workshop', 'office', 'church', 'scheme', 'gov']) {
  const b = L.books[id];
  const is = incomeStatement(b, F.month - 11, F.month);
  const s = balanceSheet(b, F.month);
  const cf = cashFlowStatement(b, F.month - 11, F.month);
  console.log(id.padEnd(9), 'rev', Math.round(is.totalRevenue), 'exp', Math.round(is.totalExpenses), 'tax', Math.round(is.incomeTax), 'net', Math.round(is.netProfit), '| A', Math.round(s.totalAssets), 'L', Math.round(s.totalLiabilities), 'E', Math.round(s.totalEquity), s.balanced ? 'ok' : 'UNBALANCED', '| CF', Math.round(cf.operating), Math.round(cf.investing), Math.round(cf.financing), cf.reconciles ? 'rec' : 'NOREC', 'closes', b.closes.length);
}
for (const id of ['market', 'farm', 'workshop', 'office', 'church', 'scheme']) {
  const b = L.books[id];
  const cash = b.monthly.map((m) => m.cash);
  console.log(id.padEnd(9), 'cash min', Math.round(Math.min(...cash)), 'last', Math.round(cash[cash.length - 1]), 'payable 2200/2230/2240/2260', [natural(b, '2200'), natural(b, '2230'), natural(b, '2240'), natural(b, '2260')].map((v) => Math.round(v)).join('/'));
}
const depos = Object.keys(L.books).filter((id) => id !== 'bank' && id !== 'gov' && id !== 'row').map((id) => [id, Math.round(L.books[id].balances['1020'] ?? 0)] as const).sort((a, b) => b[1] - a[1]);
console.log('deposits by entity', depos.slice(0, 8).map((d) => d.join(':')).join(' '), 'total', depos.reduce((s, d) => s + d[1], 0));
console.log('vehicles', Object.values(w.vehicles).filter((v) => v.householdId).length, 'households', Object.values(w.households).filter((h) => !h.dissolvedDay).length);
const hh = Object.values(w.households).filter((h) => !h.dissolvedDay)[0];
const hb = L.books[`hh:${hh.id}`];
const his = incomeStatement(hb, F.month, F.month);
console.log('household', hh.name, 'savings', hh.savings, 'debt', hh.debt, 'income', hh.monthlyIncome, 'exp', hh.monthlyExpenses, 'poor', hh.poor, '| month P&L', his.revenue.map((r) => `${r.name}: ${Math.round(r.amount)}`).join(', '), '||', his.expenses.map((r) => `${r.name}: ${Math.round(r.amount)}`).join(', '));
const tb = trialBalance(hb);
console.log('household TB balanced', tb.balanced, tb.totalDebit, tb.totalCredit);
const mm = F.micro.months[F.micro.months.length - 1];
console.log('produce market', JSON.stringify(mm));
console.log('labour', JSON.stringify({ eq: F.micro.labour?.equilibriumWage, nmw: F.micro.labour?.nmwMonthly, employed: F.micro.labour?.employed, unemployed: F.micro.labour?.unemployed, mean: F.micro.labour?.meanWage }));
console.log('quarters', JSON.stringify(F.macro.quarters.slice(-2)));
if (process.env.DEBUG_BOOK) { const b = L.books[process.env.DEBUG_BOOK]; for (const mv of b.movements.slice(0, 14)) console.log('mv', mv.month, JSON.stringify(Object.fromEntries(Object.entries(mv.m).map(([k, v]) => [k, Math.round(v)])))); }
console.log('written off', Object.values(F.bank.loans).filter((l) => l.status === 'written-off').map((l) => `${l.borrower} ${l.purpose} R${Math.round(l.principal)} m${l.startMonth}-${l.endMonth}`).join(' | '));
console.log('cpi path', F.macro.months.filter((m) => m.month % 6 === 0).map((m) => `${m.isoDate.slice(0, 7)}:${m.cpi.toFixed(1)}/${(m.inflYoY * 100).toFixed(1)}%/r${(m.repo * 100).toFixed(2)}/food${m.foodCpi.toFixed(0)}`).join(' '));
console.log('events', w.events.filter((e) => e.kind === 'economy').slice(-8).map((e) => e.text));
{
  const tm = F.transport.months[F.transport.months.length - 1];
  const mk = F.markets.months[F.markets.months.length - 1];
  console.log('markets', JSON.stringify({ brent: mk.brent, zar: mk.zar, petrol: mk.petrol, diesel: mk.diesel, levy: mk.levyPetrol, relief: mk.reliefPetrol, electricity: mk.electricity, reliefs: F.markets.reliefEpisodes.length }));
  console.log('mpc', F.macro.mpc.slice(-6).map((d) => `${d.isoDate.slice(0, 7)} ${(d.repo * 100).toFixed(2)}% ${d.change}bp ${d.votes.hike}/${d.votes.hold}/${d.votes.cut}`).join(' | '));
  console.log('e-hailing', JSON.stringify({ drivers: tm.ride.drivers, waiting: tm.ride.waiting, surge: tm.ride.surge, phi: tm.ride.phi, perKm: tm.fares.ride.perKm, netHourly: tm.ride.netHourly, reservation: tm.ride.reservationHourly, rent: tm.ride.rentWeekly, tripsRes: tm.ride.tripsRes, tripsRow: tm.ride.tripsRow, utilisation: tm.ride.utilisation }));
  console.log('transit', JSON.stringify({ costs: tm.transit.costs, fares: tm.transit.fareboxRes + tm.transit.fareboxRow, grant: tm.transit.subsidy, recovery12: tm.transit.recovery12, market: tm.transit.market }), 'air', JSON.stringify({ pax: tm.air.rowPax, residents: tm.air.residentTrips, lf: tm.air.loadFactor, airportRevenue: tm.air.airportRevenue }));
}
console.log('poor households', Object.values(w.households).filter((h) => !h.dissolvedDay && h.poor).length, '/', Object.values(w.households).filter((h) => !h.dissolvedDay).length);
