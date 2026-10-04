import { useState } from 'react';
import { epv, expectations, forceOfMortality, netPremiums, reservePath, tpx, type PolicyKind } from '../../../sim/actuarial/life';
import { MAX_AGE } from '../../../sim/mortality';
import type { Sex } from '../../../sim/types';
import { EChart } from '../../charts/EChart';
import { dualAxisOption, money } from '../../charts/actuarial';
import { Tbl, Viz, lineOption } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { pct } from '../finance/util';
import { Eq, type Valuation } from './ActuarialWorkspace';

const SUM = 100_000;

export function LifeSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const w = st.sim.world;
  const scope = st.analyticsScope;
  const scoped = scope.kind === 'person' ? w.people[scope.id] : null;
  const [pick, setPick] = useState<{ age: number; sex: Sex } | null>(null);
  const [term, setTerm] = useState<number | 'to65'>(20);
  const [kind, setKind] = useState<PolicyKind>('term');
  const life = pick ?? (scoped ? { age: Math.max(0, Math.min(MAX_AGE - 1, Math.floor(scoped.age))), sex: scoped.sex } : { age: 40, sex: 'M' as Sex });
  const x = life.age;
  const n = term === 'to65' ? Math.max(1, 65 - x) : term;
  const qx = V.qx[life.sex];
  const cm = V.cm[life.sex];
  const e = epv(cm, x, n);
  const P = netPremiums(cm, x, n);
  const mu = forceOfMortality(qx);
  const ex = expectations(qx);
  const ages = qx.map((_, i) => String(i));
  const res = reservePath(cm, x, n, kind);
  const V10 = res.find((r) => r.t === Math.min(10, res.length - 1))?.V ?? 0;
  const ltOpt = dualAxisOption(th, ages, [{ name: 'lₓ (survivors of 100,000)', data: cm.l.map((v) => Math.round(v)) }], [{ name: 'dₓ (deaths at age x)', data: cm.d.map((v) => Math.round(v)), color: th.categorical[4] }], (v) => `${Math.round(v / 1000)}k`, (v) => String(Math.round(v)), 9);
  const muOpt = lineOption(th, ages, [{ name: 'μₓ men', data: forceOfMortality(V.qx.M).map((v) => +v.toFixed(6)), color: th.male }, { name: 'μₓ women', data: forceOfMortality(V.qx.F).map((v) => +v.toFixed(6)), color: th.female }, { name: 'qₓ men', data: V.qx.M.map((v) => +v.toFixed(6)), color: th.male }, { name: 'qₓ women', data: V.qx.F.map((v) => +v.toFixed(6)), color: th.female }], (v: number) => (v >= 0.01 ? v.toFixed(2) : v.toExponential(0))) as Record<string, unknown>;
  (muOpt.yAxis as Record<string, unknown>).type = 'log';
  (muOpt.xAxis as Record<string, unknown>).axisLabel = { color: th.muted, fontSize: 10, interval: 9 };
  (muOpt.series as Array<Record<string, unknown>>).forEach((s, i) => { if (i >= 2) s.lineStyle = { width: 1.2, type: 'dashed' }; });
  const exOpt = lineOption(th, ages, [{ name: 'e̊ₓ men', data: expectations(V.qx.M).map((r) => +r.complete.toFixed(2)), color: th.male }, { name: 'e̊ₓ women', data: expectations(V.qx.F).map((r) => +r.complete.toFixed(2)), color: th.female }], (v: number) => `${v} y`) as Record<string, unknown>;
  (exOpt.xAxis as Record<string, unknown>).axisLabel = { color: th.muted, fontSize: 10, interval: 9 };
  const AaOpt = dualAxisOption(th, ages.slice(0, 100), [{ name: `Aₓ at ${pct(V.i, 1)}`, data: ages.slice(0, 100).map((_, i) => +epv(cm, i, 1).Ax.toFixed(4)) }], [{ name: 'äₓ (years’ purchase)', data: ages.slice(0, 100).map((_, i) => +epv(cm, i, 1).axDue.toFixed(3)), color: th.categorical[2] }], (v) => v.toFixed(2), (v) => v.toFixed(0), 9);
  const resOpt = lineOption(th, res.map((r) => String(r.age)), [{ name: `ₜV per R${SUM.toLocaleString()} (${kind === 'wholeLife' ? 'whole life' : kind === 'term' ? `${n}-year term` : `${n}-year endowment`})`, data: res.map((r) => Math.round(r.V * SUM)) }], money) as Record<string, unknown>;
  (resOpt.xAxis as Record<string, unknown>).axisLabel = { color: th.muted, fontSize: 10, interval: kind === 'wholeLife' ? 9 : 4 };
  const sexLabel = life.sex === 'M' ? 'man' : 'woman';
  const slice = [0, 5, 10, 15, 20, 25, 30, 40].map((k) => x + k).filter((y) => y < MAX_AGE);
  return (
    <>
      <div className="viz wide">
        <div className="row wrap small" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted">the life</span>
          <label className="row" style={{ gap: 4 }}><span className="muted">age x</span><input type="number" min={0} max={MAX_AGE - 1} value={x} onChange={(e) => setPick({ age: Math.max(0, Math.min(MAX_AGE - 1, Math.round(Number(e.target.value) || 0))), sex: life.sex })} style={{ width: 64 }} /></label>
          <button className={`chip ${life.sex === 'M' ? 'on' : ''}`} onClick={() => setPick({ age: x, sex: 'M' })}>man</button>
          <button className={`chip ${life.sex === 'F' ? 'on' : ''}`} onClick={() => setPick({ age: x, sex: 'F' })}>woman</button>
          {scoped && <span className="muted">· {scoped.firstName} {scoped.surname}, {Math.floor(scoped.age)}{pick ? '' : ' (from the scope)'}</span>}
          {pick && scoped && <button className="ghost" onClick={() => setPick(null)}>use the scope</button>}
          <span className="muted" style={{ marginLeft: 12 }}>term n</span>
          {[10, 20, 30].map((k) => (<button key={k} className={`chip ${term === k ? 'on' : ''}`} onClick={() => setTerm(k)}>{k}</button>))}
          <button className={`chip ${term === 'to65' ? 'on' : ''}`} onClick={() => setTerm('to65')}>to 65</button>
          <span className="muted" style={{ marginLeft: 12 }}>reserve for</span>
          {(['term', 'wholeLife', 'endowment'] as PolicyKind[]).map((k) => (<button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'wholeLife' ? 'whole life' : k}</button>))}
        </div>
        <Kpis items={[
          { label: `qₓ · μₓ (${sexLabel}, ${x})`, value: `${(qx[x] * 1000).toFixed(2)}‰ · ${(mu[x] * 1000).toFixed(2)}‰`, sub: `₁₀pₓ ${tpx(qx, x, 10).toFixed(4)} · ₂₀pₓ ${tpx(qx, x, 20).toFixed(4)}` },
          { label: 'e̊ₓ · eₓ', value: `${ex[x].complete.toFixed(1)} · ${ex[x].curtate.toFixed(1)} y`, sub: 'complete · curtate expectation of life' },
          { label: 'Aₓ · A⁽¹²⁾ₓ · Āₓ', value: `${e.Ax.toFixed(4)} · ${e.A12x.toFixed(4)} · ${e.Abarx.toFixed(4)}`, sub: `whole-life assurance at ${pct(V.i, 2)}` },
          { label: 'äₓ · aₓ · ä⁽¹²⁾ₓ', value: `${e.axDue.toFixed(3)} · ${e.ax.toFixed(3)} · ${e.ax12Due.toFixed(3)}`, sub: 'annuities of 1 a year for life' },
          { label: `A¹ₓ:${n}| · ${n}Eₓ · Aₓ:${n}|`, value: `${e.A1xn.toFixed(4)} · ${e.nEx.toFixed(4)} · ${e.Axn.toFixed(4)}`, sub: `term · pure endowment · endowment; äₓ:${n}| ${e.axnDue.toFixed(3)}` },
          { label: `Net premiums per R${SUM.toLocaleString()}`, value: `${money(P.term * SUM)} · ${money(P.wholeLife * SUM)}`, sub: `term (${money(P.termMonthly * SUM)}/mo) · whole life (${money(P.wholeLifeMonthly * SUM)}/mo) · endowment ${money(P.endowment * SUM)} a year` },
          { label: `₁₀V per R${SUM.toLocaleString()}`, value: money(V10 * SUM), sub: `${kind === 'wholeLife' ? 'whole life' : kind === 'term' ? `${n}-year term` : `${n}-year endowment`} taken out at ${x}` },
        ]} />
      </div>
      <Viz title={`The life table: ${life.sex === 'M' ? 'men' : 'women'}`} note={`lₓ and dₓ · ${st.sim.ctx.qx.presetId}, improved ${V.yearsElapsed.toFixed(1)} years`} info="lₓ is the number alive at exact age x out of a radix of 100,000 births; dₓ = lₓ − lₓ₊₁ the deaths between x and x + 1. The bump in dₓ in the thirties and forties is the young-adult hump of the Heligman–Pollard fit (accidents, violence, HIV); the peak in the late seventies is senescent mortality.">
        <EChart option={ltOpt} />
      </Viz>
      <Viz title="Force of mortality μₓ and the rate qₓ" note="log scale, men and women" info="μₓ = −ln(1 − qₓ) under a constant force within each year of age; the two coincide at small rates and part at the oldest ages. The infant fall, the young-adult hump and the Gompertz straight line are the three terms of the law.">
        <EChart option={muOpt} />
      </Viz>
      <Viz title="Expectation of life e̊ₓ by age" note={`e̊₀ ${ex[0].complete.toFixed(1)} for ${life.sex === 'M' ? 'men' : 'women'} on this table`} info="The complete expectation of life at each age, Tₓ / lₓ. It falls by less than a year for each year of age, so a sixty-year-old expects more than e̊₀ − 60.">
        <EChart option={exOpt} />
      </Viz>
      <Viz title={`Aₓ and äₓ at ${pct(V.i, 2)}: ${life.sex === 'M' ? 'men' : 'women'}`} note="assurance rising, annuity falling, Aₓ = 1 − d·äₓ" info="The single premium for R1 payable on death rises with age as death comes nearer; the value of R1 a year for life falls. The two are tied by Aₓ = 1 − d·äₓ, so the chart is one curve read two ways.">
        <EChart option={AaOpt} />
      </Viz>
      <Viz title="The net premium reserve ₜV" note={`${sexLabel} aged ${x}, per R${SUM.toLocaleString()}`} info="Prospectively, ₜV = (EPV of future benefits) − (EPV of future net premiums) at age x + t. A term assurance's reserve rises then falls back to nothing at expiry; an endowment's climbs to the sum assured at maturity; a whole-life policy's tends to the sum assured as the life ages.">
        <EChart option={resOpt} />
      </Viz>
      <Viz title="Commutation functions at i" note={`${sexLabel}, from age ${x} · radix 100,000 · i = ${pct(V.i, 2)}`} size="beside">
        <Tbl>
          <table>
            <thead><tr><th className="n">x</th><th className="n">lₓ</th><th className="n">qₓ ‰</th><th className="n">Dₓ</th><th className="n">Nₓ</th><th className="n">Cₓ</th><th className="n">Mₓ</th><th className="n">Aₓ</th><th className="n">äₓ</th></tr></thead>
            <tbody>
              {slice.map((y) => {
                const ey = epv(cm, y, 1);
                return (
                  <tr key={y}><td className="n">{y}</td><td className="n">{Math.round(cm.l[y]).toLocaleString()}</td><td className="n">{(cm.q[y] * 1000).toFixed(2)}</td><td className="n">{cm.D[y].toFixed(0)}</td><td className="n">{cm.N[y].toFixed(0)}</td><td className="n">{cm.C[y].toFixed(1)}</td><td className="n">{cm.M[y].toFixed(0)}</td><td className="n">{ey.Ax.toFixed(4)}</td><td className="n">{ey.axDue.toFixed(3)}</td></tr>
                );
              })}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>Life contingencies</h4></div>
        <div className="eq-grid">
          <Eq note="survival and the force of mortality">ₜpₓ = lₓ₊ₜ / lₓ,  qₓ = 1 − pₓ,  μₓ = −ln pₓ</Eq>
          <Eq note="commutation functions">Dₓ = vˣ·lₓ,  Nₓ = Σ Dᵧ (y ≥ x),  Cₓ = vˣ⁺¹·dₓ,  Mₓ = Σ Cᵧ</Eq>
          <Eq note="assurances: whole life, term, pure endowment, endowment">Aₓ = Mₓ/Dₓ,  A¹ₓ:n̄| = (Mₓ − Mₓ₊ₙ)/Dₓ,  ₙEₓ = Dₓ₊ₙ/Dₓ,  Aₓ:n̄| = A¹ₓ:n̄| + ₙEₓ</Eq>
          <Eq note="annuities-due: whole life, temporary, deferred; Woolhouse for monthly">äₓ = Nₓ/Dₓ,  äₓ:n̄| = (Nₓ − Nₓ₊ₙ)/Dₓ,  ₙ|äₓ = Nₓ₊ₙ/Dₓ,  ä⁽¹²⁾ₓ ≈ äₓ − 11/24</Eq>
          <Eq note="net premiums by the equivalence principle">Pₓ = Aₓ/äₓ,  P¹ₓ:n̄| = A¹ₓ:n̄|/äₓ:n̄|,  Pₓ:n̄| = Aₓ:n̄|/äₓ:n̄|</Eq>
          <Eq note="the prospective reserve; and the identity that ties the two functions">ₜVₓ = Aₓ₊ₜ − Pₓ·äₓ₊ₜ,  Aₓ = 1 − d·äₓ</Eq>
        </div>
        <div className="muted small">Benefits are payable at the end of the year of death and premiums at the start of each year; A⁽¹²⁾ and Ā use i/i⁽¹²⁾ and i/δ under a uniform distribution of deaths. The table is the scenario’s Heligman–Pollard fit with its improvement drift applied to today; the Mortality A/E tab measures how the province’s own deaths have run against it.</div>
      </div>
    </>
  );
}
