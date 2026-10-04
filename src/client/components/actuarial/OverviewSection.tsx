import { epv, netPremiums } from '../../../sim/actuarial/life';
import { lifeExpectancy } from '../../../sim/mortality';
import { aeTable, experienceE0 } from '../../../sim/stats';
import { money } from '../../charts/actuarial';
import { Tbl, Viz } from '../../charts/helpers';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { pct } from '../finance/util';
import { Eq, Go, type Valuation } from './ActuarialWorkspace';
import { useScheme } from './useScheme';

export function OverviewSection({ V }: { V: Valuation }) {
  const st = useStore();
  const sim = st.sim;
  const S = useScheme(V);
  const ae = aeTable(sim.world.stats.exposures);
  const tot = ae.find((r) => r.sex === 'all' && r.band === 'all')!;
  const e0 = { M: lifeExpectancy(V.qx.M), F: lifeExpectancy(V.qx.F) };
  const xM = experienceE0(sim.ctx, 'M');
  const xF = experienceE0(sim.ctx, 'F');
  const e40 = epv(V.cm.M, 40, 25);
  const P40 = netPremiums(V.cm.M, 40, 25);
  const solvency = S.sim.scr > 0 ? S.reserve / S.sim.scr : null;
  const lb = S.rt.lundberg(S.reserve);
  const yrs = V.yearsElapsed;
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Valuation rate i', value: pct(V.i, 2), sub: `${V.label} · v ${V.r.v.toFixed(4)} · d ${pct(V.r.d, 2)} · δ ${pct(V.r.delta, 2)}` },
          { label: 'e̊₀ basis · experience', value: `${e0.M.toFixed(1)} · ${e0.F.toFixed(1)}`, sub: `experience ${xM?.toFixed(1) ?? '—'} · ${xF?.toFixed(1) ?? '—'} (men · women)` },
          { label: 'Mortality A/E', value: tot.ratio === null ? '—' : tot.ratio.toFixed(2), sub: tot.lo === null ? `${tot.actual} deaths, ${tot.expected.toFixed(1)} expected` : `95% [${tot.lo.toFixed(2)}, ${tot.hi?.toFixed(2)}] · ${tot.actual} vs ${tot.expected.toFixed(1)}`, tone: tot.ratio !== null && (tot.ratio > 1.5 || tot.ratio < 0.6) ? 'warn' : undefined },
          { label: 'Society: premium ÷ risk', value: S.pricing.loading === null ? '—' : `${(1 + S.pricing.loading).toFixed(2)}×`, sub: `charged ${money(S.pricing.chargedMonthly)} · pure ${money(S.pricing.netMonthly)} a month`, tone: S.pricing.loading !== null && S.pricing.loading < 0 ? 'err' : undefined },
          { label: 'Safety loading θ · R', value: `${pct(S.rt.theta, 0)} · ${S.rt.R === null ? '—' : (S.rt.R * 1e5).toFixed(2)}`, sub: S.rt.R === null ? 'no adjustment coefficient: the loading is not positive' : 'R per R100,000 of reserve', tone: S.rt.R === null ? 'err' : undefined },
          { label: 'Reserve ÷ SCR', value: solvency === null ? '—' : `${Math.round(solvency * 100)}%`, sub: `reserve ${money(S.reserve)} · SCR ${money(S.sim.scr)} (99.5%, one year)`, tone: solvency !== null && solvency < 1 ? 'err' : solvency !== null && solvency < 1.5 ? 'warn' : 'ok' },
          { label: 'ψ(u): ruin within ten years', value: pct(S.sim.ruin10, 1), sub: `within a year ${pct(S.sim.ruin1, 1)} · Lundberg bound ${lb === null ? '—' : pct(lb, 1)}`, tone: S.sim.ruin10 > 0.1 ? 'warn' : undefined },
        ]} />
      </div>
      <div className="viz wide">
        <div className="viz-title"><h4>The actuarial control cycle</h4><span className="note">specify · develop · monitor, on the province as it runs</span></div>
        <div className="cycle">
          <div className="stage">
            <div className="k">1 · Specify the problem</div>
            <div className="t">The basis</div>
            <div className="d">Every assumption is an explicit, hashed input: the Heligman–Pollard table with {pct(V.improvement, 1)} a year of improvement, the ASFR schedule, the society’s benefits and premiums, the province’s own interest rates.</div>
            <div className="f">basis <b>#{sim.world.basisHash.slice(0, 8)}</b> · table <b>{sim.ctx.qx.presetId}</b> · {yrs.toFixed(1)} years run · i <b>{pct(V.i, 2)}</b></div>
            <span><Go to="life">the life table →</Go> · <Go to="interest">the rates →</Go></span>
          </div>
          <div className="stage">
            <div className="k">2 · Develop the solution</div>
            <div className="t">Pricing, reserving, capital</div>
            <div className="d">The equivalence principle prices each life; the society’s flat premium is measured against it; the surplus process gives the adjustment coefficient, the ruin probability and the capital a 1-in-200 year needs.</div>
            <div className="f">P₄₀ (25-year term, per R100k) <b>{money(P40.term * 100_000)}</b> a year · A₄₀ <b>{e40.Ax.toFixed(4)}</b> · ä₄₀ <b>{e40.axDue.toFixed(2)}</b> · θ <b>{pct(S.rt.theta, 0)}</b> · SCR <b>{money(S.sim.scr)}</b></div>
            <span><Go to="scheme">pricing →</Go> · <Go to="risk">risk & solvency →</Go> · <Go to="retirement">retirement →</Go></span>
          </div>
          <div className="stage">
            <div className="k">3 · Monitor the experience</div>
            <div className="t">Actual against expected</div>
            <div className="d">Deaths against the table by age band and sex with Poisson intervals, births against the schedule, claims against premiums, the surplus against its fan — and the basis is revised where the experience says so.</div>
            <div className="f">A/E <b>{tot.ratio === null ? '—' : tot.ratio.toFixed(2)}</b> · loss ratio (latest year) <b>{S.lossRows.length ? pct(S.lossRows[S.lossRows.length - 1].lossRatio, 0) : '—'}</b> · e̊₀ experience <b>{xM?.toFixed(1) ?? '—'} · {xF?.toFixed(1) ?? '—'}</b></div>
            <span><Go to="projection">projections →</Go> · <Go to="standards">the standards →</Go></span>
          </div>
        </div>
      </div>
      <Viz title="The notation at a glance" note="International Actuarial Notation, with today’s values" wide>
        <Tbl>
          <table className="std">
            <thead><tr><th>Symbol</th><th>Meaning</th><th className="n">Now</th><th>Where</th></tr></thead>
            <tbody>
              <tr><td>i, v, d, δ</td><td>the effective rate; v = 1/(1+i); d = iv; δ = ln(1+i)</td><td className="n">{pct(V.i, 2)}, {V.r.v.toFixed(4)}, {pct(V.r.d, 2)}, {pct(V.r.delta, 2)}</td><td><Go to="interest">Interest</Go></td></tr>
              <tr><td>aₙ|, äₙ|, sₙ|</td><td>annuities-certain in arrear and in advance, and their accumulation</td><td className="n">n = 10: see the table</td><td><Go to="interest">Interest</Go></td></tr>
              <tr><td>qₓ, pₓ, μₓ</td><td>the rate of mortality at age x, survival, and the force of mortality</td><td className="n">q₄₀ men {(V.qx.M[40] * 1000).toFixed(2)}‰ · women {(V.qx.F[40] * 1000).toFixed(2)}‰</td><td><Go to="life">Life contingencies</Go></td></tr>
              <tr><td>lₓ, dₓ, e̊ₓ</td><td>the life table: survivors of 100,000 births, deaths, the complete expectation of life</td><td className="n">e̊₀ {e0.M.toFixed(1)} · {e0.F.toFixed(1)}</td><td><Go to="life">Life contingencies</Go></td></tr>
              <tr><td>Dₓ, Nₓ, Cₓ, Mₓ</td><td>commutation functions at i</td><td className="n">D₄₀ {V.cm.M.D[40].toFixed(0)} · N₄₀ {V.cm.M.N[40].toFixed(0)}</td><td><Go to="life">Life contingencies</Go></td></tr>
              <tr><td>Aₓ, äₓ, Pₓ, ₜVₓ</td><td>an assurance, an annuity-due, the net premium, the reserve</td><td className="n">A₄₀ {e40.Ax.toFixed(4)} · ä₄₀ {e40.axDue.toFixed(2)} · P₄₀ {(P40.wholeLife * 1000).toFixed(2)} per 1,000</td><td><Go to="life">Life contingencies</Go></td></tr>
              <tr><td>λ, E[X], θ</td><td>claims a month, the mean claim, the safety loading</td><td className="n">{(S.rt.lambda * 12).toFixed(2)} a year · {money(S.rt.EX)} · {pct(S.rt.theta, 0)}</td><td><Go to="risk">Risk & solvency</Go></td></tr>
              <tr><td>R, ψ(u)</td><td>the adjustment coefficient and the probability of ruin from a reserve u</td><td className="n">{S.rt.R === null ? 'none' : `${(S.rt.R * 1e5).toFixed(2)} per R100k`} · ψ ≤ {lb === null ? '—' : pct(lb, 1)}</td><td><Go to="risk">Risk & solvency</Go></td></tr>
              <tr><td>SCR, MCR</td><td>the one-year 99.5% capital requirement and its 25–45% corridor</td><td className="n">{money(S.sim.scr)} · {money(S.sim.mcr[0])}–{money(S.sim.mcr[1])}</td><td><Go to="risk">Risk & solvency</Go></td></tr>
              <tr><td>A/E</td><td>actual against expected deaths, with a Poisson interval</td><td className="n">{tot.ratio === null ? '—' : tot.ratio.toFixed(2)}</td><td>Mortality A/E tab</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>The equivalence principle, in one line</h4></div>
        <div className="eq-grid">
          <Eq note="the net premium: the expected present value of premiums equals that of benefits">P · äₓ = Aₓ  ⇒  Pₓ = Aₓ / äₓ = Mₓ / Nₓ</Eq>
          <Eq note="the reserve after t years, prospectively">ₜVₓ = Aₓ₊ₜ − Pₓ · äₓ₊ₜ</Eq>
          <Eq note="the surplus of the society, classical risk theory">U(t) = u + c·t − S(t),  S(t) = Σ Xₖ,  N(t) ~ Poisson(λt)</Eq>
          <Eq note="Lundberg’s inequality">ψ(u) ≤ e^(−R·u),  λ(Mₓ(R) − 1) = c·R</Eq>
        </div>
        <div className="muted small">Everything on this workbench is computed live from the scenario’s basis and the province’s books at the valuation rate chosen above; change the rate and every present value moves with it. The Mortality A/E, Fertility and Monte Carlo tabs carry the experience analysis and the replications this cycle closes with.</div>
      </div>
    </>
  );
}
