import { useMemo, useState } from 'react';
import { bands, countsFromPeople, projectPopulation } from '../../../sim/actuarial/projection';
import { alivePeople } from '../../../sim/ctx';
import { EChart } from '../../charts/EChart';
import { dualAxisOption, pyramidPairOption } from '../../charts/actuarial';
import { Tbl, Viz, barOption, lineOption } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { pct } from '../finance/util';
import { Eq, type Valuation } from './ActuarialWorkspace';

export function ProjectionSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const sim = st.sim;
  const w = sim.world;
  const P = sim.params;
  const [years, setYears] = useState(30);
  const day = w.day;
  const proj = useMemo(() => {
    const start = countsFromPeople(alivePeople(w));
    return { start, ...projectPopulation(start, sim.ctx.qx, { yearsElapsed: V.yearsElapsed, improvement: V.improvement, asfr: sim.ctx.asfr, maleShareAtBirth: P.maleShareAtBirth, youthEmigrationHazard: P.youthEmigrationHazard, workingAge: [15, P.retirementAge], years }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, day, years, V.yearsElapsed, V.improvement]);
  const Y = proj.years;
  const y0 = Y[0];
  const yN = Y[Y.length - 1];
  const x = Y.map((y) => String(y.t));
  const pyNow = bands(proj.start);
  const pyEnd = bands(proj.end);
  const startYear = Number(st.cal().isoDate.slice(0, 4));
  const growth = y0.total > 0 ? Math.pow(yN.total / y0.total, 1 / years) - 1 : 0;
  return (
    <>
      <div className="viz wide">
        <div className="row wrap small" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted">horizon</span>
          {[10, 20, 30, 50].map((k) => (<button key={k} className={`chip ${years === k ? 'on' : ''}`} onClick={() => setYears(k)}>{k} years</button>))}
          <span className="muted">· cohort-component on the basis: the improved table, the ASFR schedule at TFR {P.tfr.toFixed(2)}, youth emigration {pct(P.youthEmigrationHazard, 0)} a year, nobody arriving</span>
        </div>
        <Kpis items={[
          { label: `Population, now → ${startYear + years}`, value: `${Math.round(y0.total)} → ${Math.round(yN.total)}`, sub: `${pct(growth, 2)} a year on average` },
          { label: 'Children · working · 65+', value: `${Math.round(yN.children)} · ${Math.round(yN.working)} · ${Math.round(yN.elderly)}`, sub: `now ${y0.children} · ${y0.working} · ${y0.elderly}` },
          { label: 'Dependency ratio', value: `${y0.dependency.toFixed(2)} → ${yN.dependency.toFixed(2)}`, sub: '(children + 65+) ÷ working-age', tone: yN.dependency > 0.8 ? 'warn' : undefined },
          { label: 'Births · deaths a year', value: `${Y[1] ? Y[1].births.toFixed(1) : '—'} → ${yN.births.toFixed(1)} · ${Y[1] ? Y[1].deaths.toFixed(1) : '—'} → ${yN.deaths.toFixed(1)}`, sub: 'expected, first year → last' },
          { label: 'e̊₀ with improvement', value: `${y0.e0M.toFixed(1)} → ${yN.e0M.toFixed(1)} · ${y0.e0F.toFixed(1)} → ${yN.e0F.toFixed(1)}`, sub: `men · women, ${pct(V.improvement, 1)} a year off every qₓ` },
        ]} />
      </div>
      <Viz title="The province projected" note={`${years} years · children under 15, working age 15–${P.retirementAge - 1}, ${P.retirementAge}+`} size="big" info="Each year the living age a year with the improved table's survival, women bear children at the schedule's rates, the newborn survive the infant year, and the young leave at the emigration hazard. Nobody arrives, so the projection is the province's own people and their descendants.">
        <EChart option={lineOption(th, x, [
          { name: 'total', data: Y.map((y) => Math.round(y.total)) },
          { name: 'children', data: Y.map((y) => Math.round(y.children)) },
          { name: 'working age', data: Y.map((y) => Math.round(y.working)) },
          { name: `${P.retirementAge}+`, data: Y.map((y) => Math.round(y.elderly)) },
        ])} />
      </Viz>
      <Viz title={`The pyramid now and in ${startYear + years}`} note="filled: now · outlined: projected" size="big">
        <EChart option={pyramidPairOption(th, pyNow.bands, pyNow, pyEnd, String(startYear + years))} />
      </Viz>
      <Viz title="Expected births and deaths a year" note="on the basis, year by year">
        <EChart option={barOption(th, x.slice(1), [{ name: 'births', data: Y.slice(1).map((y) => +y.births.toFixed(1)) }, { name: 'deaths', data: Y.slice(1).map((y) => +y.deaths.toFixed(1)), color: th.categorical[4] }, { name: 'emigrants', data: Y.slice(1).map((y) => +y.emigrants.toFixed(1)), color: th.categorical[3] }])} />
      </Viz>
      <Viz title="Life expectancy and dependency" note="e̊₀ rising with improvement; the dependency ratio as the pyramid ages" info="A Lee–Carter-style drift: every qₓ falls by the improvement rate each year, so e̊₀ climbs. The dependency ratio counts children and the retired against the working-age population.">
        <EChart option={dualAxisOption(th, x, [{ name: 'e̊₀ men', data: Y.map((y) => +y.e0M.toFixed(2)), color: th.male }, { name: 'e̊₀ women', data: Y.map((y) => +y.e0F.toFixed(2)), color: th.female }], [{ name: 'dependency ratio', data: Y.map((y) => +y.dependency.toFixed(3)), color: th.categorical[2], dashed: true }], (v) => `${v} y`, (v) => v.toFixed(2))} />
      </Viz>
      <Viz title="The projection, every five years" wide>
        <Tbl>
          <table>
            <thead><tr><th>Year</th><th className="n">Total</th><th className="n">Children</th><th className="n">Working</th><th className="n">{P.retirementAge}+</th><th className="n">Births</th><th className="n">Deaths</th><th className="n">Emigrants</th><th className="n">Dependency</th><th className="n">e̊₀ M · F</th></tr></thead>
            <tbody>
              {Y.filter((y) => y.t % 5 === 0 || y.t === years).map((y) => (
                <tr key={y.t}><td>{startYear + y.t}</td><td className="n">{Math.round(y.total)}</td><td className="n">{Math.round(y.children)}</td><td className="n">{Math.round(y.working)}</td><td className="n">{Math.round(y.elderly)}</td><td className="n">{y.t ? y.births.toFixed(1) : '—'}</td><td className="n">{y.t ? y.deaths.toFixed(1) : '—'}</td><td className="n">{y.t ? y.emigrants.toFixed(1) : '—'}</td><td className="n">{y.dependency.toFixed(2)}</td><td className="n">{y.e0M.toFixed(1)} · {y.e0F.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>The cohort-component method</h4></div>
        <div className="eq-grid">
          <Eq note="ageing with survival, and leaving">nₓ₊₁(t+1) = nₓ(t) · (1 − qₓ(t)) · (1 − eₓ)</Eq>
          <Eq note="births from the women of childbearing age, split at the sex ratio at birth">B(t) = Σₓ n^F_x(t) · fₓ,  n₀(t+1) = B(t)·(1 − q₀(t))</Eq>
          <Eq note="mortality improvement (a Lee–Carter-style drift)">qₓ(t) = qₓ(0) · (1 − r)ᵗ</Eq>
          <Eq note="the dependency ratio">D = (n₀₋₁₄ + n₆₅₊) / n₁₅₋₆₄</Eq>
        </div>
        <div className="muted small">Deterministic: the expected numbers, not one of the random futures the simulation itself plays out. The Monte Carlo tab gives the spread across whole replicated provinces; this projection is what the basis says on average for the people here today.</div>
      </div>
    </>
  );
}
