import { describe, expect, test } from 'bun:test';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import { auditBooks, balanceSheet, movement, natural, verifyChain } from '../src/sim/finance/accounts';
import { initMacro, macroMonthStart } from '../src/sim/finance/macro';
import { initMarkets, levyPerLitre, marketsMonthStart, marketsRecord } from '../src/sim/finance/markets';
import { GOV } from '../src/sim/finance/posting';
import { cardFor, fleetRentWeekly, fleetSync, logitShares, rideFare, type ModeOffer } from '../src/sim/finance/transport';
import { setJob } from '../src/sim/population';
import { RngStreams } from '../src/sim/rng';

const quiet = { month: 1, isoDate: '2026-02-01', calMonth: 2, year: 2026, inflYoY: 0.04, cpiFactor: 1.004, repo: 0.0675 };

describe('fuel prices, the levy and electricity', () => {
  test('the January 2026 build-up reproduces R20.75 for 95 unleaded inland, and every month adds up', () => {
    const S = initMarkets();
    expect(Math.abs(S.petrol - 20.75)).toBeLessThan(0.06);
    expect(S.diesel).toBeGreaterThan(16);
    expect(S.diesel).toBeLessThan(20);
    const rng = new RngStreams('markets-test').stream('markets');
    for (let m = 0; m < 60; m++) {
      marketsMonthStart(S, rng, { ...quiet, month: m, calMonth: (m % 12) + 1, year: 2026 + Math.floor(m / 12), cpiFactor: Math.pow(1.04, m / 12) });
      const row = marketsRecord(S, m, '');
      const built = row.bfpPetrol + Math.max(0, row.levyPetrol - S.raf - S.carbonPetrol) + S.raf + S.carbonPetrol + row.slate + row.marginsPetrol;
      expect(Math.abs(built - row.petrol)).toBeLessThan(0.02);
      expect(row.petrol).toBeGreaterThan(row.bfpPetrol);
      expect(row.levyPetrol).toBeGreaterThan(0);
    }
  });

  test('a price spike brings two months of R3/l relief, a month at half, then the full levy again', () => {
    const S = initMarkets();
    const rng = new RngStreams('relief').stream('markets');
    for (let m = 0; m < 3; m++) marketsRecord(S, m, '');
    const fullLevy = levyPerLitre(S, 'petrol');
    // Crude jumps: last month's import parity is R6 a litre dearer.
    S.bfpPetrol += 6;
    marketsMonthStart(S, rng, { ...quiet, month: 3 });
    expect(S.relief?.petrol).toBe(3);
    expect(levyPerLitre(S, 'petrol')).toBeCloseTo(fullLevy - 3, 2);
    marketsRecord(S, 3, '');
    marketsMonthStart(S, rng, { ...quiet, month: 4 });
    expect(S.relief?.phase).toBe('full');
    marketsMonthStart(S, rng, { ...quiet, month: 5 });
    expect(S.relief?.phase).toBe('taper');
    expect(S.relief?.petrol).toBe(1.5);
    marketsMonthStart(S, rng, { ...quiet, month: 6 });
    expect(S.relief).toBeNull();
    expect(S.reliefEpisodes.length).toBe(1);
    // …and not again within the year.
    S.bfpPetrol += 8;
    marketsMonthStart(S, rng, { ...quiet, month: 7 });
    expect(S.relief).toBeNull();
  });

  test('the Budget indexes the fuel levy in April unless petrol has jumped; NERSA applies 8.76% in April 2026', () => {
    const S = initMarkets();
    const rng = new RngStreams('budget').stream('markets');
    for (let m = 0; m < 12; m++) marketsRecord(S, m, '');
    const gfl = S.gflPetrol;
    const el = S.electricity;
    const news = marketsMonthStart(S, rng, { ...quiet, month: 12, calMonth: 4, year: 2026, inflYoY: 0.03 });
    expect(Math.abs(S.gflPetrol - gfl * 1.03)).toBeLessThan(0.006);
    expect(news.budget).toContain('raised');
    expect(S.electricity).toBeCloseTo(el * 1.0876, 3);
    // A year later with petrol 20% dearer than a year ago: the levy is left alone.
    const S2 = initMarkets();
    for (let m = 0; m < 12; m++) marketsRecord(S2, m, '');
    S2.petrol *= 1.2;
    const g2 = S2.gflPetrol;
    marketsMonthStart(S2, rng, { ...quiet, month: 12, calMonth: 4, year: 2027, inflYoY: 0.05 });
    expect(S2.gflPetrol).toBe(g2);
  });
});

describe('the Monetary Policy Committee', () => {
  const macro = (infl: number, gap: number) => {
    const M = initMacro({ repo: 0.07, target: 0.03, saInflation: infl, nmwHourly: 30, povertyLine: 1_000, adultCost: 2_000, childCost: 1_000, childGrant: 560, oldAgeGrant: 2_315 });
    M.inflYoY = infl;
    M.months.push({ gap, inflYoY: infl } as never);
    return M;
  };
  const start = { calMonth: 3, month: 2, isoDate: '2026-03-01', fuelYoY: 0.03, zarYoY: 0, brent: 70, zar: 17 };

  test('hikes when inflation is well above target, in steps of at most 50 bp, with a vote and a statement', () => {
    const M = macro(0.07, 0.02);
    const d = macroMonthStart(M, new RngStreams('mpc').stream('finance'), start)!;
    expect(d).not.toBeNull();
    expect(d.change).toBeGreaterThan(0);
    expect(d.change).toBeLessThanOrEqual(50);
    expect(d.votes.hike + d.votes.hold + d.votes.cut).toBe(6);
    expect(d.votes.hike).toBeGreaterThanOrEqual(d.votes.cut);
    expect(d.statement).toContain('raise the repo rate');
    expect(M.prime).toBeCloseTo(M.repo + 0.035, 10);
  });

  test('cuts when inflation is under target and the economy is slack; meets only in odd months', () => {
    const M = macro(0.015, -0.05);
    M.saCore = 0.015;
    const d = macroMonthStart(M, new RngStreams('mpc').stream('finance'), start)!;
    expect(d.change).toBeLessThan(0);
    expect(macroMonthStart(M, new RngStreams('mpc').stream('finance'), { ...start, calMonth: 4 })).toBeNull();
  });

  test('moves 25 bp at a time when the rule is within two points of the repo rate', () => {
    const M = macro(0.045, 0);
    const d = macroMonthStart(M, new RngStreams('mpc').stream('finance'), start)!;
    expect(Math.abs(d.change)).toBeLessThanOrEqual(25);
  });
});

describe('fares and the e-hailing market', () => {
  const offers: ModeOffer[] = [
    { mode: 'taxi', fare: 16, minutes: 17 },
    { mode: 'bus', fare: 14, minutes: 34 },
    { mode: 'hyper', fare: 21, minutes: 18 },
    { mode: 'ride', fare: 60, minutes: 12 },
  ];

  test('logit shares sum to one, and a higher value of time buys speed', () => {
    const poor = logitShares(offers, 0.25, 0.1);
    const rich = logitShares(offers, 2, 0.9);
    for (const s of [poor, rich]) expect(s.taxi + s.bus + s.hyper + s.ride).toBeCloseTo(1, 9);
    expect(rich.ride).toBeGreaterThan(poor.ride);
    expect(rich.taxi).toBeLessThan(poor.taxi);
    expect(poor.taxi).toBeGreaterThan(poor.ride);
  });

  test('a ride costs more the further it goes; the minimum applies to short trips; the surge leaves the booking fee alone', () => {
    const card = cardFor(1, 1);
    expect(rideFare(card, 1, 1)).toBeCloseTo(card.minimum + card.booking, 6);
    expect(rideFare(card, 8, 1)).toBeGreaterThan(rideFare(card, 4, 1));
    const net = rideFare(card, 6, 1) - card.booking;
    expect(rideFare(card, 6, 1.5) - card.booking).toBeCloseTo(net * 1.5, 6);
  });

  test('the fleet passes a higher prime rate and a dearer car on to the weekly rent', () => {
    const S = initMarkets();
    const low = fleetRentWeekly(S, 0.1, 1);
    const high = fleetRentWeekly(S, 0.13, 1);
    expect(high).toBeGreaterThan(low);
    S.carPrice *= 1.2;
    expect(fleetRentWeekly(S, 0.1, 1)).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(1_500);
    expect(low).toBeLessThan(3_000);
  });
});

describe('transport in the books (two simulated years)', () => {
  const sim = new Simulation({ seed: 'transport-books' });
  sim.runDays(730);
  const w = sim.world;
  const F = w.finance;
  const T = F.transport;

  test('every book balances, the chain holds, and the operators have books of their own', () => {
    expect(verifyChain(F.ledgers).ok).toBe(true);
    expect(auditBooks(F.ledgers)).toEqual([]);
    for (const id of ['transit', 'hamba', 'fleet', 'airportco']) {
      expect(F.ledgers.books[id]).toBeDefined();
      expect(balanceSheet(F.ledgers.books[id], F.month).balanced).toBe(true);
    }
  });

  test('the app holds no fares back from its drivers, and the grant is paid and received in the same amounts', () => {
    expect(Math.abs(natural(F.ledgers.books.hamba, '2010'))).toBeLessThan(5);
    for (let m = 0; m <= F.month; m++) {
      const paid = movement(F.ledgers.books[GOV], '5335', m, m);
      const got = movement(F.ledgers.books.transit, '4160', m, m);
      expect(Math.abs(paid - got)).toBeLessThan(0.01);
    }
    expect(T.months.some((m) => m.transit.subsidy > 0)).toBe(true);
  });

  test('the market clears: no surge below capacity, service never above demand, and a car on the map for every driver with one', () => {
    for (const m of T.months) {
      const r = m.ride;
      expect(r.surge).toBeGreaterThanOrEqual(1);
      expect(r.surge).toBeLessThanOrEqual(3);
      expect(r.served).toBeLessThanOrEqual(1);
      // No surge while the demand at the card fits the fleet; a surge short of the cap clears the market; at the cap, rationing.
      if (r.capacityHours <= 0) expect(r.served).toBe(0);
      else if (r.surge === 1) expect(r.demandHours).toBeLessThanOrEqual(r.capacityHours * 1.0001);
      else if (r.surge < 3) expect(Math.abs(r.demandHours - r.capacityHours) / r.capacityHours).toBeLessThan(0.05);
      else expect(r.demandHours).toBeGreaterThanOrEqual(r.capacityHours * 0.95);
      expect(r.phi).toBeGreaterThan(0.6);
    }
    const drivers = alivePeople(w).filter((p) => p.job === 'ehailer');
    const withCar = T.fleet.cars.filter((c) => c.driverId);
    const rides = Object.values(w.vehicles).filter((v) => v.kind === 'ride');
    expect(rides.length).toBe(withCar.length);
    for (const c of withCar) expect(drivers.some((p) => p.id === c.driverId)).toBe(true);
    for (const v of rides) expect(withCar.some((c) => c.vehicleId === v.id)).toBe(true);
  });

  test('the fuel levy is collected, fares and fuel feed the CPI, and the national accounts still reconcile', () => {
    expect(F.tax.collected.fuel).toBeGreaterThan(0);
    const M = F.macro;
    for (const m of M.months) {
      expect(Math.abs(m.discrepancy) / m.gdpProduction).toBeLessThan(0.07);
      expect(Math.abs(m.gdpIncome - m.gdpProduction)).toBeLessThan(1);
      expect(m.petrol).toBeGreaterThan(10);
    }
    expect(M.mpc.length).toBeGreaterThanOrEqual(12);
    expect(M.months[M.months.length - 1].fuelCpi).toBeCloseTo((100 * F.markets.petrol) / F.markets.base.petrol, 1);
  });

  test('transport runs are deterministic for a seed', () => {
    const again = new Simulation({ seed: 'transport-books' });
    again.runDays(730);
    expect(JSON.stringify(again.world.finance.transport.months)).toBe(JSON.stringify(T.months));
    expect(JSON.stringify(again.world.finance.markets.months)).toBe(JSON.stringify(F.markets.months));
    expect(JSON.stringify(again.world.finance.macro.mpc)).toBe(JSON.stringify(F.macro.mpc));
  }, 120_000);
});

describe('e-hailing in the animated day', () => {
  test('a driver-partner goes online, riders order cars on the app, and the shift ends at home', () => {
    const sim = new Simulation({ seed: 'rides' });
    const w = sim.world;
    sim.runDays(35);
    // Make sure there are a few driver-partners with cars.
    const F = w.finance;
    const pool = alivePeople(w).filter((p) => p.job === 'unemployed' && p.age >= 25 && p.age < 55 && !p.away);
    for (const p of pool.slice(0, Math.max(0, 3 - alivePeople(w).filter((q) => q.job === 'ehailer').length))) setJob(sim.ctx, p, 'ehailer');
    fleetSync(sim.ctx, F, F.month);
    // Everyone who can afford it hails a ride today.
    for (const id in F.transport.hhRide) F.transport.hhRide[id] = Math.max(F.transport.hhRide[id], 0.5);
    while (sim.ctx.cal.weekday !== 3) sim.runDays(1);
    for (const id in F.transport.hhRide) F.transport.hhRide[id] = Math.max(F.transport.hhRide[id], 0.5);
    sim.setMicro(true);
    let online = 0;
    let carrying = 0;
    for (let m = 0; m < 16 * 60; m++) {
      sim.advance(1);
      for (const v of Object.values(w.vehicles)) {
        if (v.kind !== 'ride') continue;
        if (v.online) online++;
        if (v.stage === 'ride' && v.occupantIds.length > 1) carrying++;
      }
    }
    expect(online).toBeGreaterThan(0);
    expect(w.stats.rideTrips).toBeGreaterThan(0);
    expect(carrying).toBeGreaterThan(0);
    for (const p of alivePeople(w)) if (p.inVehicleId) expect(w.vehicles[p.inVehicleId]).toBeDefined();
    // Late at night every driver is home and offline.
    sim.advance(24 * 60 - w.minuteOfDay + 60);
    for (const v of Object.values(w.vehicles)) if (v.kind === 'ride') expect(v.online && v.stage === 'ride').toBe(false);
  }, 180_000);
});
