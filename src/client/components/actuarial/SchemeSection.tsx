import { naturalVsLevel } from '../../../sim/actuarial/life';
import { EChart } from '../../charts/EChart';
import { claimMixOption, money, naturalLevelOption } from '../../charts/actuarial';
import { Tbl, Viz, barOption, lineOption } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { pct } from '../finance/util';
import { Eq, Go, type Valuation } from './ActuarialWorkspace';
import { useScheme } from './useScheme';

export function SchemeSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const S = useScheme(V);
  const P = st.sim.params;
  const pr = S.pricing;
  const ins = st.sim.world.insurance;
  const fPrem = Math.round(P.funeralPremium * S.basis.cpiF);
  const lPrem = Math.round(P.lifeCoverPremium * S.basis.cpiF);
  const sum = Math.round(P.lifeCoverSum * S.basis.cpiF);
  const nvl = naturalVsLevel(V.cm.M, 25, 40);
  const natOpt = lineOption(th, pr.naturalByAge.map((r) => String(r.age)), [{ name: `men, R${sum.toLocaleString()}`, data: pr.naturalByAge.map((r) => Math.round(r.M)), color: th.male }, { name: 'women', data: pr.naturalByAge.map((r) => Math.round(r.F)), color: th.female }], money) as Record<string, unknown>;
  (natOpt.series as Array<Record<string, unknown>>)[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: th.fg2, type: 'dashed' }, label: { color: th.muted, fontSize: 9.5, formatter: `flat premium ${money(lPrem)}` }, data: [{ yAxis: lPrem }] };
  const lr = S.lossRows;
  const lrOpt = barOption(th, lr.map((r) => `year ${r.year + 1}`), [{ name: 'premiums', data: lr.map((r) => Math.round(r.premiums)) }, { name: 'claims', data: lr.map((r) => Math.round(r.claims)), color: th.categorical[4] }]) as Record<string, unknown>;
  (lrOpt.yAxis as Record<string, unknown>) = { ...(lrOpt.yAxis as object), axisLabel: { color: th.muted, fontSize: 10, formatter: money } };
  const cumulative = ins.premiumsIn > 0 ? ins.claimsOut / ins.premiumsIn : null;
  const targetLoad = 0.3;
  const recommend = (net: number) => net * (1 + S.basis.adminShare + targetLoad);
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Lives covered', value: String(pr.lives), sub: `${pr.households} households · funeral ${pr.funeralHouseholds} hh · life ${pr.adultsCovered} adults` },
          { label: 'Charged a month', value: money(pr.chargedMonthly), sub: `funeral ${money(fPrem)}/hh · life ${money(lPrem)}/adult (CPI-indexed)` },
          { label: 'Pure risk premium a month', value: money(pr.netMonthly), sub: `Σ q⁽¹²⁾ₓ × benefit · funeral ${money(pr.funeral.net)} · life ${money(pr.life.net)}` },
          { label: 'Implicit loading', value: pr.loading === null ? '—' : pct(pr.loading, 0), sub: 'charged ÷ pure − 1, expenses and safety together', tone: pr.loading !== null && pr.loading < 0 ? 'err' : pr.loading !== null && pr.loading < 0.1 ? 'warn' : 'ok' },
          { label: 'Expected claims', value: `${(12 * pr.lambda).toFixed(2)} a year`, sub: `mean claim ${money(pr.meanClaim)} · ${money(12 * pr.netMonthly)} a year` },
          { label: 'Loss ratio', value: cumulative === null ? '—' : pct(cumulative, 0), sub: `since the start: claims ${money(ins.claimsOut)} on premiums ${money(ins.premiumsIn)} · ${ins.claimCount} claims`, tone: cumulative !== null && cumulative > 1 ? 'err' : undefined },
        ]} />
      </div>
      <Viz title="Natural premium against level premium" note={`life cover of R${sum.toLocaleString()}, a man from 25 to 65 · i = ${pct(V.i, 2)}`} size="big" info="The natural premium v·qₓ·S is what a year's cover costs at each age; a level premium P·S is the same cover's cost spread evenly. Early on the level premium exceeds the natural and the excess, accumulated with interest and survivorship, is the reserve; later the natural premium overtakes it and the reserve is drawn down. A society charging one flat premium at every age is running exactly this: the young subsidise the old unless the reserve is built.">
        <EChart option={naturalLevelOption(th, nvl.natural, nvl.level, sum, 25, 40)} />
        <div className="muted small">Level premium P¹₂₅:₄₀| × S = {money(nvl.level * sum)} a year ({money((nvl.level * sum) / 12)} a month); the natural premium is {money(nvl.natural[0][1] * sum)} at 25 and {money(nvl.natural[nvl.natural.length - 1][1] * sum)} at 64. The society charges {money(lPrem * 12)} a year for the same cover at every age. Reserves: <Go to="life">the ₜV chart</Go>.</div>
      </Viz>
      <Viz title="The pure monthly premium by age, against the flat premium" note={`R${sum.toLocaleString()} life cover · q⁽¹²⁾ₓ × S`} info="What a month of life cover costs on the table for each age and sex, against the one premium the society charges every adult. Below the line an adult pays more than their risk; above it, less.">
        <EChart option={natOpt} />
      </Viz>
      <Viz title="Who subsidises whom" note="charged ÷ pure premium by household" wide>
        <Tbl>
          <table>
            <thead><tr><th>Household</th><th className="n">Lives</th><th className="n">Oldest</th><th className="n">Charged / month</th><th className="n">Pure premium</th><th className="n">Charged ÷ pure</th><th className="n">Risk-rated premium</th></tr></thead>
            <tbody>
              {pr.byHousehold.map((h) => (
                <tr key={h.id}><td>{h.name}</td><td className="n">{h.members}</td><td className="n">{h.oldest}</td><td className="n">{money(h.charged)}</td><td className="n">{money(h.net)}</td><td className="n" style={{ color: h.ratio !== null && h.ratio < 1 ? th.status.serious : undefined }}>{h.ratio === null ? '—' : `${h.ratio.toFixed(2)}×`}</td><td className="n">{money(recommend(h.net))}</td></tr>
              ))}
              <tr className="total"><td>all</td><td className="n">{pr.lives}</td><td className="n"></td><td className="n">{money(pr.chargedMonthly)}</td><td className="n">{money(pr.netMonthly)}</td><td className="n">{pr.loading === null ? '—' : `${(1 + pr.loading).toFixed(2)}×`}</td><td className="n">{money(recommend(pr.netMonthly))}</td></tr>
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">The risk-rated premium is the pure premium loaded for the society’s administration ({pct(S.basis.adminShare, 0)} of premiums) and a {pct(targetLoad, 0)} safety margin — the gross premium by the equivalence principle with loadings. A household below 1× is carried by the pool; a flat community premium is a deliberate cross-subsidy, and the price of it is the reserve the society needs (<Go to="risk">risk & solvency</Go>).</div>
      </Viz>
      <Viz title="Premiums and claims by year" note="the loss ratio is claims ÷ premiums; the combined ratio adds the admin share" empty={lr.length < 1 && 'After the first month.'}>
        <EChart option={lrOpt} />
        <div className="muted small">{lr.slice(-4).map((r) => `year ${r.year + 1}: ${pct(r.lossRatio, 0)} (combined ${pct(r.combined, 0)})`).join(' · ')}</div>
      </Viz>
      <Viz title="What a claim looks like" note="the claim-size distribution of the covered lives" empty={!pr.claimMix.length && 'Nobody is covered.'} info="Each covered life's death pays its cover: the funeral benefit, the life cover for an adult of working age, or both. The mixture weights each amount by the probability of that life dying this month, so it is the distribution of X in the surplus process.">
        <EChart option={claimMixOption(th, pr.claimMix)} />
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>Pricing and reserving</h4></div>
        <div className="eq-grid">
          <Eq note="monthly renewable cover: the pure premium for a life">π⁽¹²⁾ₓ = q⁽¹²⁾ₓ · S,  q⁽¹²⁾ₓ = 1 − (1 − qₓ)^(1/12)</Eq>
          <Eq note="the gross premium with loadings for expenses e and safety θ">π = π_net · (1 + e + θ)</Eq>
          <Eq note="the loss, expense and combined ratios">LR = claims / premiums,  ER = expenses / premiums,  CR = LR + ER</Eq>
          <Eq note="IFRS 17, premium allocation approach">LRC = premiums received for cover not yet given,  LIC = claims incurred, unpaid</Eq>
        </div>
        <div className="muted small">
          <b>IFRS 17.</b> The society’s contracts renew month by month, so they qualify for the premium allocation approach: the liability for remaining coverage is the unearned part of the month’s premium (nil at month end, when it has been earned) and the liability for incurred claims is nil too, since a claim is paid on the day of death. Under the general model a longer contract would carry fulfilment cash flows (the present value of claims and expenses less premiums, on the basis above), a risk adjustment for non-financial risk (the safety loading’s cousin) and a contractual service margin released as cover is given. <b>The fix</b> the numbers point to: price by age and household, or keep the flat premium and hold the reserve the fan on the next section requires; either way the loading should clear the admin share and a margin, and a loss ratio above 100% is a premium review, not bad luck.
        </div>
      </div>
    </>
  );
}
