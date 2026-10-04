import { Simulation } from '../src/sim/engine';
import { natural, incomeStatement } from '../src/sim/finance/accounts';
const sim = new Simulation({ seed: 'longrun-1', journalRetentionMonths: 0 });
const t0 = performance.now();
for (let decade = 1; decade <= 8; decade++) {
  sim.runDays(Math.round(10 * 365.25));
  const F = sim.world.finance; const b = F.ledgers.books.bank; const m = F.macro.months[F.macro.months.length - 1];
  const is = incomeStatement(b, F.month - 11, F.month);
  const loans = Object.values(F.bank.loans);
  if (decade % 4 === 0) console.log('  exp lines', JSON.stringify(Object.fromEntries(is.expenses.map((l) => [l.name.slice(0, 26), Math.round(l.amount)]))), 'depRate', F.bank.rates.deposit);
  const T = F.transport; const tm = T.months[T.months.length - 1]; const Mk = F.markets.months[F.markets.months.length - 1];
  const cash = (id: string) => Math.round(natural(F.ledgers.books[id], '1020'));
  console.log(`  transport y${decade * 10}`, JSON.stringify({ petrol: Mk.petrol, brent: Mk.brent, zar: Mk.zar, reliefs: F.markets.reliefEpisodes.length, drivers: tm.ride.drivers, waiting: tm.ride.waiting, phi: tm.ride.phi, surge: tm.ride.surge, netHourly: tm.ride.netHourly, resHourly: tm.ride.reservationHourly, rent: tm.ride.rentWeekly, fleetCars: T.fleet.cars.length, fleetLoans: loans.filter((l) => l.borrower === 'fleet' && l.status === 'active').length, fleetWO: loans.filter((l) => l.borrower === 'fleet' && l.status === 'written-off').length, cash: { transit: cash('transit'), hamba: cash('hamba'), fleet: cash('fleet'), airport: cash('airportco') }, recovery12: tm.transit.recovery12, subsidy: Math.round(tm.transit.subsidy), taxi3km: tm.taxiFare, ride3km: tm.rideFare, rescues: sim.world.events.filter((e) => /business rescue/.test(e.text) && /Hamba|Fleet|Transit|Airport/.test(e.text)).length, mpc: F.macro.mpc.length }));
  console.log(`y${decade * 10}`, JSON.stringify({ cpi: Math.round(m.cpi), wage: m.wageIndex.toFixed(1), repo: m.repo, infl: (m.inflYoY * 100).toFixed(1), deposits: Math.round(m.deposits), settle: Math.round(natural(b, '1030')), tbills: Math.round(natural(b, '1600')), loansBal: Math.round(natural(b, '1150')), equity: Math.round(natural(b, '3010') + natural(b, '3020') + natural(b, '3030') + natural(b, '3050')), rev12: Math.round(is.totalRevenue), exp12: Math.round(is.totalExpenses), net12: Math.round(is.netProfit), writtenOff: F.bank.stats.writtenOff, woAmt: Math.round(F.bank.stats.writtenOffAmount), originated: F.bank.stats.originated, pop: Object.values(sim.world.people).filter((p) => p.alive && !p.emigrated).length, gdp: Math.round(m.gdpNominal), unemployment: (m.unemploymentRate * 100).toFixed(0), gini: m.giniIncome }));
}
console.log('secs', ((performance.now() - t0) / 1000).toFixed(1));
