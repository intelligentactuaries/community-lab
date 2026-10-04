import { EChart } from '../../charts/EChart';
import { fanOption, money, ruinCurveOption } from '../../charts/actuarial';
import { Tbl, Viz, lineOption, moneyAxis } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { monthLabel, pct } from '../finance/util';
import { Eq, Go, type Valuation } from './ActuarialWorkspace';
import { useScheme } from './useScheme';

export function RiskSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const S = useScheme(V);
  const ins = st.sim.world.insurance;
  const F = st.sim.world.finance;
  const now = F ? F.month : 0;
  const rt = S.rt;
  const sim = S.sim;
  const solvency = sim.scr > 0 ? S.reserve / sim.scr : null;
  const x = Array.from({ length: sim.months + 1 }, (_, m) => (m % 12 === 0 ? monthLabel(now + m) : ''));
  const path = ins.surplusPath;
  const histOpt = lineOption(th, path.map((p) => monthLabel(p.month)), [{ name: 'reserve', data: path.map((p) => p.reserve) }], moneyAxis) as Record<string, unknown>;
  (histOpt.series as Array<Record<string, unknown>>)[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: th.status.serious, type: 'dashed' }, data: [{ yAxis: 0 }] };
  (histOpt.series as Array<Record<string, unknown>>)[0].areaStyle = { color: th.categorical[0], opacity: 0.08 };
  const lb = rt.lundberg(S.reserve);
  const ap = rt.approx(S.reserve);
  const injection = Math.max(0, sim.scr - S.reserve);
  const injection150 = Math.max(0, 1.5 * sim.scr - S.reserve);
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Reserve u', value: money(S.reserve), sub: S.reserveMonths === null ? 'no expected claims' : `${S.reserveMonths.toFixed(1)} months of expected claims`, tone: ins.ruined ? 'err' : undefined },
          { label: 'Premiums c · claims λE[X] a month', value: `${money(rt.c)} · ${money(rt.expectedClaims)}`, sub: `net of ${pct(S.basis.adminShare, 0)} admin · λ = ${(rt.lambda * 12).toFixed(2)} a year` },
          { label: 'Safety loading θ', value: pct(rt.theta, 0), sub: 'c / (λ·E[X]) − 1', tone: rt.theta !== null && rt.theta <= 0 ? 'err' : rt.theta !== null && rt.theta < 0.1 ? 'warn' : 'ok' },
          { label: 'Adjustment coefficient R', value: rt.R === null ? 'none' : `${(rt.R * 1e5).toFixed(3)} / R100k`, sub: rt.R === null ? 'ruin is certain in the long run without a positive loading' : `Lundberg ψ(u) ≤ ${pct(lb, 1)} · Cramér–Lundberg ≈ ${ap === null ? '—' : pct(ap, 1)}`, tone: rt.R === null ? 'err' : undefined },
          { label: 'ψ(u) simulated', value: `${pct(sim.ruin1, 1)} · ${pct(sim.ruin5, 1)} · ${pct(sim.ruin10, 1)}`, sub: `within 1 · 5 · 10 years, ${sim.paths} paths`, tone: sim.ruin10 > 0.1 ? 'warn' : undefined },
          { label: 'SCR (99.5%, one year)', value: money(sim.scr), sub: `MCR corridor ${money(sim.mcr[0])}–${money(sim.mcr[1])}` },
          { label: 'Solvency ratio', value: solvency === null ? '—' : `${Math.round(solvency * 100)}%`, sub: 'eligible own funds ÷ SCR, the reserve counting as own funds', tone: solvency !== null && solvency < 1 ? 'err' : solvency !== null && solvency < 1.5 ? 'warn' : 'ok' },
        ]} />
      </div>
      <Viz title="The surplus, ten years on: a fan" note={`from ${money(S.reserve)} · c = ${money(rt.c)} a month · today’s lives and prices`} size="big" info="U(t) = u + c·t − S(t) simulated month by month: claim counts Poisson at λ, sizes from the covered lives' cover, premiums in. The bands are the 5–95% and 25–75% ranges of the paths; the dashed line is ruin. Everything stays in today's money and today's portfolio, so the fan is the risk of the book as it stands, not a forecast of who joins or leaves.">
        <EChart option={fanOption(th, x, sim, { fmt: money, refs: [{ y: sim.scr, label: 'SCR' }] })} />
      </Viz>
      <Viz title="Ruin against capital: ψ(u)" note="one year and ten years, with Lundberg’s bound" size="big" info="The probability that the surplus ever falls below zero within the horizon, read off the same simulated paths for every starting reserve; Lundberg's bound e^(−Ru) is the classical upper limit for an infinite horizon. The SCR is the reserve at which the one-year curve crosses 0.5%.">
        <EChart option={ruinCurveOption(th, sim.curve, S.reserve, sim.scr, rt.R === null ? null : rt.lundberg)} />
      </Viz>
      <Viz title="The surplus so far" note={ins.ruined ? `RUINED in month ${ins.ruinMonth}` : 'solvent'} empty={path.length < 2 && 'The surplus path starts after the first month.'}>
        <EChart option={histOpt} />
      </Viz>
      <Viz title="Capital and premium: the fix" wide>
        <Tbl>
          <table>
            <thead><tr><th>Lever</th><th className="n">Today</th><th className="n">Needed</th><th>Reads</th></tr></thead>
            <tbody>
              <tr><td>Capital to meet the SCR (solvency ratio 100%)</td><td className="n">{money(S.reserve)}</td><td className="n">{money(sim.scr)}</td><td>{injection > 0 ? `an injection of ${money(injection)}` : 'met'}</td></tr>
              <tr><td>Capital for a 150% solvency ratio</td><td className="n">{money(S.reserve)}</td><td className="n">{money(1.5 * sim.scr)}</td><td>{injection150 > 0 ? `an injection of ${money(injection150)}` : 'met'}</td></tr>
              <tr><td>Premium for Lundberg ψ(u) ≤ 1% at today’s reserve</td><td className="n">{money(rt.c)} a month</td><td className="n">{S.fix ? `${money(S.fix.c)} a month` : '—'}</td><td>{S.fix ? (S.fix.multiplier > 1.001 ? `premiums × ${S.fix.multiplier.toFixed(2)} (R* = ${(S.fix.R * 1e5).toFixed(2)} per R100k)` : 'today’s premium already suffices') : 'no reserve to bound from'}</td></tr>
              <tr><td>Safety loading θ</td><td className="n">{pct(rt.theta, 0)}</td><td className="n">≥ 10–30%</td><td>{rt.theta === null ? '—' : rt.theta <= 0 ? 'the premium does not cover expected claims: a rate review is due' : rt.theta < 0.1 ? 'thin: one bad year erodes the reserve' : 'adequate; the reserve carries the rest'}</td></tr>
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">Reinsurance would cap the largest claim (the R{Math.round(S.basis.lifeCoverSum * S.basis.cpiF).toLocaleString()} life benefit dominates E[X²]) and lower R’s denominator; it is not modelled here. The Monte Carlo tab replicates whole provinces — its ruin probability includes the people who join, lapse, age and die, where this fan holds today’s book still.</div>
      </Viz>
      <Viz title="The standard formula, in the society’s terms" note="SAM / Solvency II life underwriting stresses on a year’s claims" size="beside">
        <Tbl>
          <table>
            <thead><tr><th>Stress</th><th className="n">Capital</th></tr></thead>
            <tbody>
              <tr><td>Mortality: every qₓ up 15%, permanently — on a year’s expected claims</td><td className="n">{money(S.standard.mortality)}</td></tr>
              <tr><td>Catastrophe: an extra 1.5‰ of deaths in the coming year on sums at risk of {money(S.standard.sumsAtRisk)}</td><td className="n">{money(S.standard.catastrophe)}</td></tr>
              <tr className="total"><td>Combined at a correlation of 0.25</td><td className="n">{money(S.standard.combined)}</td></tr>
              <tr><td>Simulated SCR (internal-model view)</td><td className="n">{money(sim.scr)}</td></tr>
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">Lapse, expense and longevity stresses do not bite on monthly renewable cover; the standard formula would add operational risk and take diversification with the bank’s market risks. See <Go to="standards">standards</Go>.</div>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>Risk theory</h4></div>
        <div className="eq-grid">
          <Eq note="the surplus process (Cramér–Lundberg)">U(t) = u + c·t − S(t),  S(t) = Σₖ₌₁^N(t) Xₖ,  N(t) ~ Poisson(λt)</Eq>
          <Eq note="the safety loading">c = (1 + θ)·λ·E[X]</Eq>
          <Eq note="the adjustment coefficient">λ(Mₓ(R) − 1) = c·R,  Mₓ(r) = E[e^(rX)] = Σ wᵢ·e^(r·xᵢ)</Eq>
          <Eq note="Lundberg’s inequality and the Cramér–Lundberg approximation">ψ(u) ≤ e^(−R·u),  ψ(u) ≈ θE[X] / (M′ₓ(R) − (1+θ)E[X]) · e^(−R·u)</Eq>
          <Eq note="finite-horizon ruin, by simulation">ψ(u, T) = P(U(t) &lt; 0 for some t ≤ T)</Eq>
          <Eq note="the solvency capital requirement">SCR = VaR₉₉.₅%, 1 year of the fall in own funds;  25% ≤ MCR/SCR ≤ 45%</Eq>
        </div>
      </div>
    </>
  );
}
