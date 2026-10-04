// Transport economics in the finance workspace: the pump price and what is in
// it, oil and the rand, the Monetary Policy Committee's votes, the fares against
// the CPI, the e-hailing market (the surge that clears it, what a driver-partner
// takes home, how the app sets its rate card), how each settlement gets about,
// Unity Transit's fare box and grant, the airport, the fuel levy and its relief,
// and the rental fleet. Every figure is read from the month's records, which are
// posted to the books by finance/transport.ts and finance/markets.ts.

import { EChart } from '../../charts/EChart';
import { textbookOption } from '../../charts/econ';
import { Mini, Tbl, Viz, barOption, lineOption, moneyAxis } from '../../charts/helpers';
import { miniColumns, miniStack, miniTrend } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { COMMUNITY } from '../../../sim/world';
import { MPC_MEMBERS } from '../../../sim/finance/macro';
import { RIDE_PARAMS, U_MAX, cardFor, hyperFare, rideFare, taxiFare } from '../../../sim/finance/transport';
import { Kpis } from './FinanceWorkspace';
import { R, pct } from './util';

const idx = (v: number, base: number) => (base > 0 ? Math.round((v / base) * 1000) / 10 : 100);

export function TransportSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const S = F.markets;
  const T = F.transport;
  const M = F.macro;
  const tm = T.months[T.months.length - 1];
  const mk = S.months[S.months.length - 1];
  if (!tm || !mk) return <div className="viz wide note"><div className="empty">The transport accounts open after the first month closes.</div></div>;
  const prevMk = S.months.length > 1 ? S.months[S.months.length - 2] : null;
  const ride = tm.ride;
  const pr = ride.pricing;
  const lastMpc = M.mpc[M.mpc.length - 1];
  const cat = th.categorical;
  const muted = th.muted;

  // ── The pump price built up (95 unleaded, inland) ──
  const mkRows = S.months.slice(-60);
  const mx = mkRows.map((m) => m.isoDate.slice(0, 7));
  const build = barOption(th, mx, [
    { name: 'basic fuel price', data: mkRows.map((m) => Math.round(m.bfpPetrol * 100) / 100), stack: 'p', color: cat[0] },
    { name: 'general fuel levy', data: mkRows.map((m) => Math.max(0, Math.round((m.levyPetrol - S.raf - S.carbonPetrol) * 100) / 100)), stack: 'p', color: cat[1] },
    { name: 'RAF levy', data: mkRows.map(() => S.raf), stack: 'p', color: cat[2] },
    { name: 'carbon and slate', data: mkRows.map((m) => Math.round((S.carbonPetrol + m.slate) * 100) / 100), stack: 'p', color: cat[3] },
    { name: 'margins and logistics', data: mkRows.map((m) => m.marginsPetrol), stack: 'p', color: cat[4] },
  ]) as Record<string, unknown>;
  (build.yAxis as Record<string, unknown>).axisLabel = { color: muted, fontSize: 10, formatter: (v: number) => `R${v}` };
  (build.series as Array<Record<string, unknown>>).forEach((s) => ((s.itemStyle as Record<string, unknown>).borderRadius = 0));

  // ── Oil and the rand, indexed to the start ──
  const b0 = S.base.brent;
  const z0 = S.base.zar;
  const oil = lineOption(th, S.months.map((m) => m.isoDate.slice(0, 7)), [
    { name: 'Brent (US$)', data: S.months.map((m) => idx(m.brent, b0)), color: cat[0] },
    { name: 'rand per US$', data: S.months.map((m) => idx(m.zar, z0)), color: cat[1] },
    { name: 'Brent in rand', data: S.months.map((m) => idx(m.brent * m.zar, b0 * z0)), color: cat[2] },
  ], (v) => `${v}`);

  // ── Transport prices against the CPI, indexed to the start ──
  const baseCard = cardFor(1, 1);
  const bTaxi = taxiFare(T.base, 3);
  const bHyper = hyperFare(T.base, 3);
  const bRide = rideFare(baseCard, 3, 1);
  const cpiBy = new Map(M.months.map((m) => [m.month, m.cpi]));
  const px = T.months.map((m) => m.isoDate.slice(0, 7));
  const prices = lineOption(th, px, [
    { name: 'petrol', data: T.months.map((m) => Math.round(m.fuelIndex * 1000) / 10), color: cat[0] },
    { name: 'minibus taxi', data: T.months.map((m) => idx(m.taxiFare, bTaxi)), color: cat[1] },
    { name: 'Hyperline', data: T.months.map((m) => idx(m.hyperFare, bHyper)), color: cat[2] },
    { name: 'Hamba (with surge)', data: T.months.map((m) => idx(m.rideFare, bRide)), color: cat[3] },
    { name: 'CPI', data: T.months.map((m) => Math.round((cpiBy.get(m.month) ?? 100) * 10) / 10), color: muted },
  ], (v) => `${v}`) as Record<string, unknown>;
  const ps = prices.series as Array<Record<string, unknown>>;
  ps[4].lineStyle = { width: 1.4, type: 'dashed', color: muted };
  // An index reads from where the data are, not from zero.
  (prices.yAxis as Record<string, unknown>).scale = true;
  (oil as Record<string, unknown>).yAxis = { ...((oil as Record<string, unknown>).yAxis as object), scale: true };

  // ── The e-hailing market: driver-hours demanded at each surge against the fleet's capacity ──
  const capacity = ride.capacityHours;
  const demandPts = ride.curve.map(([s, h]) => [h, s] as [number, number]);
  const xMax = Math.max(capacity * 1.35, ...demandPts.map((p) => p[0]), 10);
  const served = Math.min(capacity, demandPts.find((p) => p[1] >= ride.surge)?.[0] ?? ride.demandHours);
  const market = textbookOption(th, {
    xLabel: 'Driver-hours a month',
    yLabel: 'Surge (× rate card)',
    curves: [
      { name: 'Demand', points: demandPts, color: cat[4] },
      { name: 'Capacity', points: [[capacity, 1], [capacity, 3]], color: cat[0] },
    ],
    markers: [{ name: 'E', x: served, y: ride.surge, color: th.fg, guides: true, position: 'right' }],
    xMin: 0,
    xMax,
    yMin: 1,
    yMax: 3,
    xFmt: (v) => `${Math.round(v)}`,
    yFmt: (v) => `×${v.toFixed(1)}`,
  });

  // ── What a driver-partner takes home (per driver, monthly) ──
  const drvRows = T.months.slice(-36);
  const per = (m: typeof tm, v: number) => (m.ride.drivers > 0 ? Math.round(v / m.ride.drivers) : 0);
  const driver = barOption(th, drvRows.map((m) => m.isoDate.slice(0, 7)), [
    { name: 'take-home', data: drvRows.map((m) => per(m, m.ride.driverNet)), stack: 'd', color: cat[2] },
    { name: 'fuel', data: drvRows.map((m) => per(m, m.ride.driverFuel)), stack: 'd', color: cat[1] },
    { name: 'car rent', data: drvRows.map((m) => per(m, m.ride.driverRent)), stack: 'd', color: cat[0] },
    { name: 'phone', data: drvRows.map((m) => per(m, m.ride.driverPhone)), stack: 'd', color: cat[3] },
    { name: 'service fee', data: drvRows.map((m) => per(m, m.ride.gross * RIDE_PARAMS.COMMISSION)), stack: 'd', color: cat[4] },
  ]) as Record<string, unknown>;
  (driver.yAxis as Record<string, unknown>).axisLabel = { color: muted, fontSize: 10, formatter: moneyAxis };
  (driver.series as Array<Record<string, unknown>>).forEach((s) => ((s.itemStyle as Record<string, unknown>).borderRadius = 0));
  const hourly = lineOption(th, px, [
    { name: 'take-home per online hour', data: T.months.map((m) => Math.round(m.ride.netHourly)), color: cat[2] },
    { name: 'reservation wage per hour', data: T.months.map((m) => Math.round(m.ride.reservationHourly)), color: cat[1] },
  ], (v) => `R${v}`);

  // ── How each settlement's carless households get about ──
  const coms = Object.keys(tm.shares).sort((a, b) => (tm.shares[b].ride ?? 0) - (tm.shares[a].ride ?? 0));
  const modes = barOption(th, coms.map((c) => COMMUNITY[c as keyof typeof COMMUNITY]?.name ?? c), [
    { name: 'minibus taxi', data: coms.map((c) => Math.round(tm.shares[c].taxi * 100)), stack: 'm', color: cat[1] },
    { name: 'bus', data: coms.map((c) => Math.round(tm.shares[c].bus * 100)), stack: 'm', color: cat[0] },
    { name: 'Hyperline', data: coms.map((c) => Math.round(tm.shares[c].hyper * 100)), stack: 'm', color: cat[2] },
    { name: 'e-hailing', data: coms.map((c) => Math.round(tm.shares[c].ride * 100)), stack: 'm', color: cat[3] },
  ], true) as Record<string, unknown>;
  (modes.xAxis as Record<string, unknown>).max = 100;
  (modes.xAxis as Record<string, unknown>).axisLabel = { color: muted, fontSize: 10, formatter: (v: number) => `${v}%` };
  (modes.series as Array<Record<string, unknown>>).forEach((s) => ((s.itemStyle as Record<string, unknown>).borderRadius = 0));

  // ── What households spend on getting about ──
  const spRows = T.months.slice(-36);
  const spend = barOption(th, spRows.map((m) => m.isoDate.slice(0, 7)), [
    { name: 'own car (petrol and running)', data: spRows.map((m) => Math.round(m.spend.fuel + m.spend.carOther)), stack: 's', color: cat[0] },
    { name: 'minibus taxi', data: spRows.map((m) => Math.round(m.spend.taxi)), stack: 's', color: cat[1] },
    { name: 'Unity Transit', data: spRows.map((m) => Math.round(m.spend.bus + m.spend.hyper)), stack: 's', color: cat[2] },
    { name: 'e-hailing', data: spRows.map((m) => Math.round(m.spend.ride)), stack: 's', color: cat[3] },
    { name: 'flights and long-distance', data: spRows.map((m) => Math.round(m.spend.air + m.spend.out)), stack: 's', color: cat[4] },
  ]) as Record<string, unknown>;
  (spend.yAxis as Record<string, unknown>).axisLabel = { color: muted, fontSize: 10, formatter: moneyAxis };
  (spend.series as Array<Record<string, unknown>>).forEach((s) => ((s.itemStyle as Record<string, unknown>).borderRadius = 0));

  // ── Unity Transit ──
  const transit = lineOption(th, px, [
    { name: 'running costs', data: T.months.map((m) => Math.round(m.transit.costs)), color: cat[4] },
    { name: 'fares', data: T.months.map((m) => Math.round(m.transit.fareboxRes + m.transit.fareboxRow)), color: cat[2] },
    { name: 'operations grant', data: T.months.map((m) => Math.round(m.transit.subsidy)), color: cat[0] },
  ], moneyAxis);
  const recovery = lineOption(th, px, [{ name: 'fares ÷ running costs, 12 months', data: T.months.map((m) => Math.round(m.transit.recovery12 * 1000) / 10), color: cat[2] }], (v) => `${v}%`) as Record<string, unknown>;
  ((recovery.series as Array<Record<string, unknown>>)[0]).markLine = { silent: true, symbol: 'none', lineStyle: { color: muted, type: 'dashed' }, label: { formatter: 'SNA 50% test', color: muted, fontSize: 9.5 }, data: [{ yAxis: 50 }] };

  // ── The airport ──
  const air = barOption(th, spRows.map((m) => m.isoDate.slice(0, 7)), [
    { name: 'visitors departing', data: spRows.map((m) => Math.round(m.air.rowPax)), stack: 'a', color: cat[0] },
    { name: 'residents’ day trips', data: spRows.map((m) => Math.round(m.air.residentTrips)), stack: 'a', color: cat[1] },
  ]) as Record<string, unknown>;
  (air.series as Array<Record<string, unknown>>).forEach((s) => ((s.itemStyle as Record<string, unknown>).borderRadius = 0));

  // ── Fuel levy revenue ──
  const levy = lineOption(th, px, [{ name: 'fuel levies collected', data: T.months.map((m) => Math.round(m.levyRevenue)), color: cat[1] }], moneyAxis);

  // ── The fleet's weekly rent ──
  const rent = lineOption(th, px, [{ name: 'weekly rent of a car', data: T.months.map((m) => m.ride.rentWeekly), color: cat[0] }], (v) => `R${v}`);

  const petrolChange = prevMk ? mk.petrol - prevMk.petrol : 0;
  const fleetLoans = Object.values(F.bank.loans).filter((l) => l.borrower === 'fleet' && l.status === 'active');
  const card = T.fares.ride;
  const fmtBp = (c: number) => (c > 0 ? `+${c} bp` : c < 0 ? `${c} bp` : 'hold');
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis
          items={[
            { label: 'Petrol 95 (inland)', value: `R${mk.petrol.toFixed(2)}/l`, sub: `${petrolChange >= 0 ? '+' : '−'}${Math.abs(Math.round(petrolChange * 100))}c this month · Brent US$${mk.brent.toFixed(0)} · R${mk.zar.toFixed(2)}/$`, tone: mk.petrol > S.base.petrol * 1.25 ? 'warn' : undefined },
            { label: 'Repo rate', value: pct(M.repo, 2), sub: lastMpc ? `MPC ${lastMpc.isoDate.slice(0, 7)}: ${fmtBp(lastMpc.change)} (${lastMpc.votes.hike}–${lastMpc.votes.hold}–${lastMpc.votes.cut})` : 'first meeting in January' },
            { label: 'Fuel levy', value: `R${mk.levyPetrol.toFixed(2)}/l`, sub: mk.reliefPetrol > 0 ? `relief R${mk.reliefPetrol.toFixed(2)}/l in force` : `collected ${R(tm.levyRevenue, true)} this month`, tone: mk.reliefPetrol > 0 ? 'warn' : undefined },
            { label: 'Hamba rate card', value: `R${card.perKm.toFixed(2)}/km`, sub: `base R${card.base.toFixed(2)} · R${card.perMin.toFixed(2)}/min · surge ×${ride.surge.toFixed(2)}` },
            { label: 'Driver-partners', value: `${ride.drivers}${ride.waiting ? ` (+${ride.waiting} waiting)` : ''}`, sub: `R${Math.round(ride.netHourly)}/h take-home vs R${Math.round(ride.reservationHourly)}/h reservation`, tone: ride.drivers > 0 && ride.netHourly < ride.reservationHourly ? 'warn' : undefined },
            { label: 'Unity Transit', value: pct(tm.transit.recovery12, 0), sub: `fares ÷ costs (12 months) · grant ${R(tm.transit.subsidy, true)} · ${tm.transit.market ? 'market' : 'non-market'} producer` },
            { label: 'Airport', value: `${Math.round(tm.air.rowPax + tm.air.residentTrips).toLocaleString()} pax`, sub: `load factor ${pct(tm.air.loadFactor, 0)} · fuel surcharge R${Math.round(tm.air.surcharge)}` },
          ]}
        />
      </div>
      <Viz
        title="The pump price, built up"
        note="95 unleaded inland, R per litre, set on the first Wednesday"
        info="The basic fuel price is the import-parity cost of a litre landed at the coast (Brent plus the refining margin, converted at last month's rand, plus freight and insurance). On top: the general fuel levy (less any relief Treasury grants), the Road Accident Fund levy, the carbon fuel levy and slate levy, and the regulated wholesale and retail margins, storage, distribution and the inland zone differential."
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniStack(th, [
              { name: 'basic fuel price', value: mk.bfpPetrol, color: cat[0] },
              { name: 'general fuel levy', value: Math.max(0, mk.levyPetrol - S.raf - S.carbonPetrol), color: cat[1] },
              { name: 'RAF levy', value: S.raf, color: cat[2] },
              { name: 'carbon and slate', value: S.carbonPetrol + mk.slate, color: cat[3] },
              { name: 'margins', value: mk.marginsPetrol, color: cat[4] },
            ], { fmt: (v) => `R${v.toFixed(2)}` })}
            keys={[
              { label: 'petrol 95', value: `R${mk.petrol.toFixed(2)}/l` },
              { label: 'diesel', value: `R${mk.diesel.toFixed(2)}/l` },
            ]}
          />
        }
      >
        <EChart option={build} />
      </Viz>
      <Viz title="Oil and the rand" note="index, start = 100" info="Brent follows a mean-reverting random walk around a long-run anchor that rises with US inflation, with rare supply shocks and demand collapses. The rand tracks its purchasing-power path (the inflation gap with the United States), strengthens when real rates are high and weakens when oil jumps. Brent in rand is what the country pays.">
        <EChart option={oil} />
      </Viz>
      <Viz title="Fares against the CPI" note="index, start = 100; a 3 km trip" info="Petrol at the pump; the minibus-taxi associations' fare (raised when their costs, 42% diesel, have climbed 7% since the last rise, seldom lowered); the Hyperline's distance fare (Unity Transit reviews it each July, CPI + 1%, CPI only while unemployment is up; the bus moves with it); Hamba's fare for 3 km including the month's surge; and the CPI, dashed.">
        <EChart option={prices} />
      </Viz>
      <Viz
        title="The e-hailing market"
        note={`${tm.isoDate.slice(0, 7)} · surge ×${ride.surge.toFixed(2)}`}
        info={`Demand: the driver-hours residents (by the logit on fares and time), visitors off the planes and regional riders want at each surge multiplier. Capacity: the driver-partners' online hours × ${Math.round(U_MAX * 100)}% (the rest is waiting between fares). E is where they meet: when demand at the card exceeds capacity the app surges until it no longer does (to ×3, then rations); below capacity the cars wait and the driver-partners earn less.`}
        wide
      >
        <EChart option={market} />
      </Viz>
      <Viz
        title="What a driver-partner takes home"
        note="per driver, monthly; the fare box split"
        summaryLabel="full chart"
        summary={(() => {
          const d = Math.max(1, ride.drivers);
          return (
            <Mini
              option={ride.drivers > 0 ? miniStack(th, [
                { name: 'take-home', value: ride.driverNet / d, color: cat[2] },
                { name: 'fuel', value: ride.driverFuel / d, color: cat[1] },
                { name: 'car rent', value: ride.driverRent / d, color: cat[0] },
                { name: 'phone', value: ride.driverPhone / d, color: cat[3] },
                { name: 'service fee', value: (ride.gross * RIDE_PARAMS.COMMISSION) / d, color: cat[4] },
              ], { fmt: (v) => R(v, true) }) : null}
              keys={ride.drivers > 0 ? [
                { label: 'take-home', value: `${R(ride.netPerDriver)}/mo`, tone: ride.netPerDriver < 0 ? 'err' : undefined },
                { label: 'an hour', value: `R${Math.round(ride.netHourly)} vs R${Math.round(ride.reservationHourly)}`, tone: ride.netHourly < ride.reservationHourly ? 'warn' : undefined },
                { label: 'busy', value: pct(ride.utilisation, 0) },
              ] : [{ label: 'no driver-partners this month' }]}
            />
          );
        })()}
      >
        <EChart option={driver} />
      </Viz>
      <Viz title="Earnings against the reservation wage" note="R per online hour" info="A driver-partner stops (three in ten do, each month it lasts) when the hour pays under 75% of the reservation wage, 15% above the minimum wage; someone out of work signs up when it pays 5% above it and the cars are busy. Hours online respond to last month's hourly take-home (elasticity 0.4).">
        <EChart option={hourly} />
      </Viz>
      <Viz title="How Hamba set this month's fares" note={`tariff index ${ride.phi.toFixed(3)}`}>
        <Tbl>
          <table>
            <thead><tr><th>Step</th><th className="n">This month</th><th>What it is</th></tr></thead>
            <tbody>
              <tr><td>Target take-home</td><td className="n">R{pr.target.toFixed(2)}/h</td><td>1.3 × the minimum wage of R{M.nmwHourly.toFixed(2)}/h</td></tr>
              <tr><td>Fuel</td><td className="n">R{pr.fuelPerHour.toFixed(2)}/h</td><td>{pr.tripsPerHour.toFixed(2)} trips an online hour at 60% busy, {(RIDE_PARAMS.RIDE_L_PER_KM * 100).toFixed(1)} l/100 km with {Math.round(RIDE_PARAMS.DEADHEAD * 100)}% empty running, petrol at R{mk.petrol.toFixed(2)}</td></tr>
              <tr><td>Car and phone</td><td className="n">R{pr.fixedPerHour.toFixed(2)}/h</td><td>the fleet&apos;s R{ride.rentWeekly.toLocaleString()} a week (it carries vehicle finance at prime + 1%, prime {pct(M.prime, 2)}) and the phone, over {RIDE_PARAMS.DRIVER_HOURS} online hours</td></tr>
              <tr><td>Cost floor</td><td className="n">×{pr.phiCost.toFixed(3)}</td><td>the card at which those costs and the target are met after the {Math.round(RIDE_PARAMS.COMMISSION * 100)}% service fee (a trip at ×1 averages R{pr.fareUnit.toFixed(2)})</td></tr>
              <tr><td>Demand shade</td><td className="n">×{pr.demand.toFixed(3)}</td><td>exp(0.5 × gap {pct(pr.gap)} + 0.35 × real income growth {pct(pr.incomeGrowth)} − 2.5 × unemployment change {pct(pr.unemploymentDelta)}), within ±15%</td></tr>
              <tr><td>Where it wants to be</td><td className="n">×{pr.want.toFixed(3)}</td><td>cost floor × demand shade</td></tr>
              <tr><td>Where it moved</td><td className="n">×{pr.phi.toFixed(3)}</td><td>a third of the way, at most 6% in a month</td></tr>
              <tr><td>The card</td><td className="n">R{card.perKm.toFixed(2)}/km</td><td>base R{card.base.toFixed(2)}, R{card.perMin.toFixed(2)}/min, minimum R{card.minimum}, booking fee R{card.booking.toFixed(2)}; this month&apos;s surge ×{ride.surge.toFixed(2)}, pickup in about {Math.round(ride.eta)} min</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz title="How the carless get about" note="share of trips by settlement" info={`A multinomial logit on generalised minutes (time plus fare over the household's value of time, half its earners' wage): the estates pay for speed, the townships for price. Alternative constants: bus ${RIDE_PARAMS.ASC.bus}, Hyperline +${RIDE_PARAMS.ASC.hyper}, e-hailing ${RIDE_PARAMS.ASC.ride} rising with the settlement's affluence; the minibus taxi falls with it. Car households drive (and use e-hailing for ${Math.round(RIDE_PARAMS.CAR_RIDE_SHARE * 100)}% of their transport budget).`}>
        <EChart option={modes} />
      </Viz>
      <Viz title="What households spend on getting about" note="monthly" size="wide">
        <EChart option={spend} />
      </Viz>
      <Viz
        title="Unity Transit"
        note="the buses and the Hyperline, monthly"
        info="Running costs: diesel for the buses by the timetable's kilometres, traction power for the Hyperline at NERSA's tariff, maintenance, ticketing and insurance, and the bus drivers' payroll. Fares from the province's households and from riders beyond them. The operations grant tops the operator's cash up to 1.25 months of costs."
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, px, [
              { name: 'operations grant', data: T.months.map((m) => m.transit.subsidy), color: cat[0] },
              { name: 'fares', data: T.months.map((m) => m.transit.fareboxRes + m.transit.fareboxRow), color: cat[2], label: true },
              { name: 'running costs', data: T.months.map((m) => m.transit.costs), color: cat[4], label: true },
            ], { fmt: (v) => R(v, true), last: 36, zero: true })}
            keys={[
              { label: 'costs', color: cat[4] },
              { label: 'fares', color: cat[2] },
              { label: 'grant', value: R(tm.transit.subsidy, true), color: cat[0] },
              { label: 'boardings', value: Math.round(tm.transit.boardingsBusRes + tm.transit.boardingsHyperRes + tm.transit.boardingsBusRow + tm.transit.boardingsHyperRow).toLocaleString() },
            ]}
          />
        }
      >
        <EChart option={transit} />
      </Viz>
      <Viz title="Fare box recovery" note="12 months" info="The System of National Accounts treats a producer whose sales cover at least half its costs over a sustained period as a market producer (value added = fares less intermediate consumption; the grant is a subsidy on products). Below half it is a non-market public producer: its value added is its payroll, and the state's purchase of the rest of its output is government consumption.">
        <EChart option={recovery} />
      </Viz>
      <Viz
        title="The airport"
        note="departing passengers a month"
        info="The airline is a national regional carrier: residents' tickets are imports (the employer pays for business trips, the household for a Saturday out; fare plus a fuel surcharge on Jet A1, the passenger service charge and VAT). The airport company bills the airline landing fees and the passenger service charge, and pays the province a dividend."
        summaryLabel="full chart"
        summary={(() => {
          const rows = spRows.slice(-24);
          return (
            <Mini
              option={miniColumns(th, rows.map((m) => m.isoDate.slice(0, 7)), [
                { name: 'visitors departing', data: rows.map((m) => Math.round(m.air.rowPax)), color: cat[0], stack: 'a' },
                { name: 'residents’ day trips', data: rows.map((m) => Math.round(m.air.residentTrips)), color: cat[1], stack: 'a' },
              ])}
              keys={[
                { label: 'visitors', value: Math.round(tm.air.rowPax).toLocaleString(), color: cat[0], mark: 'bar' },
                { label: 'residents', value: tm.air.residentTrips, color: cat[1], mark: 'bar' },
                { label: 'load factor', value: pct(tm.air.loadFactor, 0) },
              ]}
            />
          );
        })()}
      >
        <EChart option={air} />
      </Viz>
      <Viz title="Fuel levies" note="collected by SARS, monthly">
        <EChart option={levy} />
      </Viz>
      <Viz
        title="Unity Fleet Rentals"
        note="weekly rent, incl. VAT"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, px, [{ name: 'weekly rent of a car', data: T.months.map((m) => m.ride.rentWeekly), color: cat[0], area: true, label: true }], { fmt: (v) => `R${Math.round(v).toLocaleString()}`, step: true })}
            keys={[
              { label: 'cars', value: T.fleet.cars.length },
              { label: 'a new car', value: R(mk.carPrice, true) },
              { label: 'car loans', value: fleetLoans.length ? `${fleetLoans.length} · ${R(fleetLoans.reduce((s, l) => s + l.balance, 0), true)}` : 'none' },
            ]}
          />
        }
      >
        <EChart option={rent} />
      </Viz>
      <Viz title="Monetary Policy Committee" note="six members, every second month" empty={!M.mpc.length && 'The committee first meets in January.'}>
        <Tbl>
          <table>
            <thead><tr><th>Meeting</th><th className="n">Decision</th><th className="n">Repo</th><th className="n">Hike · hold · cut</th><th className="n">Rule</th><th>Statement</th></tr></thead>
            <tbody>
              {M.mpc.slice(-12).reverse().map((d) => (
                <tr key={d.month}>
                  <td>{d.isoDate.slice(0, 7)}</td>
                  <td className="n">{fmtBp(d.change)}</td>
                  <td className="n">{pct(d.repo, 2)}</td>
                  <td className="n">{d.votes.hike} · {d.votes.hold} · {d.votes.cut}</td>
                  <td className="n">{pct(d.rule, 2)}</td>
                  <td className="small">{d.statement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tbl>
        {lastMpc && <div className="muted small">Preferred rates at the last meeting: {MPC_MEMBERS.map((m, i) => `${m.name} ${pct(lastMpc.preferences[i], 2)}`).join(' · ')}.</div>}
      </Viz>
      <Viz title="Fuel-levy relief" note="Treasury's temporary cuts in the general fuel levy" empty={!S.reliefEpisodes.length && 'No relief yet: Treasury steps in when the pump price has risen 20% in three months (or R2.50 in one).'}>
        <Tbl>
          <table>
            <thead><tr><th>From</th><th className="n">Petrol</th><th className="n">Diesel</th><th className="n">Months</th><th className="n">Revenue forgone (province)</th></tr></thead>
            <tbody>
              {S.reliefEpisodes.slice().reverse().map((e) => (
                <tr key={e.month}><td>{e.isoDate.slice(0, 7)}</td><td className="n">R{e.petrol.toFixed(2)}/l</td><td className="n">R{e.diesel.toFixed(2)}/l</td><td className="n">{e.months}</td><td className="n">{R(e.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <div className="viz wide note">
        <div className="muted small">
          Prices move with the economy. The pump price follows oil and the rand; the fuel levy follows the Budget, and Treasury cuts it for a few months when the price spikes. The Reserve Bank&apos;s committee sets the repo rate against the 3% target, and prime (repo + 3.5%) sets the vehicle-finance rate the fleet pays, hence the weekly rent a driver-partner owes. The minimum wage and the output gap, income growth and unemployment set what Hamba charges; the surge clears what is left. Every rand is posted to the books: fares to the taxi associations, Unity Transit and the app (as agent for its drivers), petrol and diesel levies to SARS, the rest of the pump price, electricity and the airline tickets to the rest of the economy.
        </div>
      </div>
    </>
  );
}
