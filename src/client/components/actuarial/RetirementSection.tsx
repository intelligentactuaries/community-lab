import { useMemo, useState } from 'react';
import { grantLiability, retirementProjection } from '../../../sim/actuarial/projection';
import { alivePeople } from '../../../sim/ctx';
import { JOBS } from '../../../sim/population';
import { EChart } from '../../charts/EChart';
import { money } from '../../charts/actuarial';
import { Tbl, Viz, barOption, lineOption } from '../../charts/helpers';
import { miniXY } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { pct } from '../finance/util';
import { Eq, type Valuation } from './ActuarialWorkspace';

type ReturnKey = 'cash' | 'bonds' | 'balanced' | 'valuation';

export function RetirementSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const sim = st.sim;
  const w = sim.world;
  const P = sim.params;
  const F = w.finance;
  const M = F?.macro;
  const [pickId, setPickId] = useState<string>('');
  const [rate, setRate] = useState(15);
  const [ret, setRet] = useState<ReturnKey>('balanced');
  const workers = useMemo(() => alivePeople(w).filter((p) => p.age >= 18 && p.age < P.retirementAge && p.income > 0).sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName)), [w, w.day]);
  const scope = st.analyticsScope;
  const scoped = scope.kind === 'person' ? workers.find((p) => p.id === scope.id) : null;
  const median = useMemo(() => [...workers].sort((a, b) => a.income - b.income)[Math.floor(workers.length / 2)], [workers]);
  const worker = workers.find((p) => p.id === pickId) ?? scoped ?? median;
  const returns: Record<ReturnKey, { label: string; i: number }> = {
    cash: { label: 'cash (deposit rate)', i: V.rates.deposit },
    bonds: { label: 'bonds (T-bill + 1%)', i: V.rates.tbill + 0.01 },
    balanced: { label: 'balanced (CPI + 5%)', i: V.inflation + 0.05 },
    valuation: { label: `the valuation rate`, i: V.i },
  };
  const salaryGrowth = V.inflation + P.realWageGrowth;
  const grant = M ? M.grants.oldAge : P.oldAgeGrant;
  const proj = useMemo(() => (worker ? retirementProjection({ age: Math.floor(worker.age), salary: worker.income, contribution: rate / 100, salaryGrowth, returnRate: returns[ret].i, inflation: V.inflation, retirementAge: P.retirementAge, i: V.i, qx: V.qx[worker.sex], savingsShare: 1 / 3 }) : null), [worker, rate, ret, salaryGrowth, V, P.retirementAge]);
  const sweep = useMemo(() => {
    if (!worker) return [] as Array<[number, number]>;
    const pts: Array<[number, number]> = [];
    for (let c = 5; c <= 30; c += 1) pts.push([c, retirementProjection({ age: Math.floor(worker.age), salary: worker.income, contribution: c / 100, salaryGrowth, returnRate: returns[ret].i, inflation: V.inflation, retirementAge: P.retirementAge, i: V.i, qx: V.qx[worker.sex], savingsShare: 1 / 3 }).replacementReal]);
    return pts;
  }, [worker, ret, salaryGrowth, V, P.retirementAge]);
  const gl = useMemo(() => grantLiability(alivePeople(w).map((p) => ({ age: p.age, sex: p.sex })), sim.ctx.qx, V.improvement, V.yearsElapsed, V.i, V.inflation, grant), [w, w.day, sim.ctx.qx, V, grant]);
  const gdpYear = M && M.months.length ? M.months[M.months.length - 1].gdpNominal * 12 : 0;
  return (
    <>
      <div className="viz wide">
        <div className="row wrap small" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted">the worker</span>
          <select value={worker?.id ?? ''} onChange={(e) => setPickId(e.target.value)}>
            {workers.map((p) => (<option key={p.id} value={p.id}>{p.firstName} {p.surname} · {Math.floor(p.age)} · {JOBS[p.job]?.label ?? p.job} · R{Math.round(p.income).toLocaleString()}/mo</option>))}
          </select>
          <label className="row" style={{ gap: 4 }}><span className="muted">contribution</span><input type="number" min={1} max={40} step={1} value={rate} onChange={(e) => setRate(Math.max(1, Math.min(40, Number(e.target.value) || 0)))} style={{ width: 56 }} /><span className="muted">% of pay</span></label>
          <span className="muted">return</span>
          {(Object.keys(returns) as ReturnKey[]).map((k) => (<button key={k} className={`chip ${ret === k ? 'on' : ''}`} onClick={() => setRet(k)}>{returns[k].label} {pct(returns[k].i, 1)}</button>))}
        </div>
        {proj && worker && (
          <Kpis items={[
            { label: 'Years to retirement', value: String(proj.years), sub: `${worker.firstName} ${worker.surname}, ${Math.floor(worker.age)}, retiring at ${P.retirementAge} · pay ${money(worker.income)}/mo growing ${pct(salaryGrowth, 1)} a year` },
            { label: 'Fund at retirement', value: money(proj.fundAtRetirement), sub: `${money(proj.fundReal)} in today’s rand · contributions ${money(proj.contributionsPaid)}` },
            { label: 'ä⁽¹²⁾ at retirement', value: `${proj.annuityFactor.toFixed(2)} · ${proj.annuityFactorReal.toFixed(2)}`, sub: `level at ${pct(V.i, 1)} · inflation-linked at ${pct(V.real, 1)} real` },
            { label: 'Pension a month', value: `${money(proj.pensionLevel)} · ${money(proj.pensionReal)}`, sub: 'level · rising with prices, from the retirement component' },
            { label: 'Replacement ratio', value: `${pct(proj.replacementLevel, 0)} · ${pct(proj.replacementReal, 0)}`, sub: `of final pay ${money(proj.finalSalary)}/mo · whole fund annuitised ${pct(proj.replacementLevelAll, 0)}`, tone: proj.replacementReal < 0.4 ? 'warn' : proj.replacementReal >= 0.6 ? 'ok' : undefined },
            { label: 'Old-age grant floor', value: money(grant), sub: `a month from 60 · ${pct(worker.income > 0 ? grant / proj.finalSalary : 0, 0)} of final pay` },
          ]} />
        )}
      </div>
      <Viz title="The fund, year by year" note={proj ? `${pct(rate / 100, 0)} of pay at ${returns[ret].label}` : undefined} size="big" empty={!proj && 'Nobody of working age earns yet.'} info="Each year's contributions, a share of a salary growing with wages, accumulate at the return: Fₖ = Fₖ₋₁(1+i) + cₖ. The real line deflates by inflation, so it is the fund's buying power.">
        {proj && <EChart option={lineOption(th, proj.path.map((r) => String(r.age)), [{ name: 'fund', data: proj.path.map((r) => Math.round(r.fund)) }, { name: 'fund, today’s rand', data: proj.path.map((r) => Math.round(r.real)) }, { name: 'a year’s contributions', data: proj.path.map((r) => Math.round(r.contribution)) }], money)} />}
      </Viz>
      <Viz title="Replacement ratio against the contribution rate" note="inflation-linked pension from the retirement component, as a share of final pay" empty={!sweep.length && 'Nobody of working age earns yet.'} info="Sweeping the contribution rate from 5% to 30% with everything else held: the ratio is close to linear in the rate, so the cost of a target replacement ratio reads straight off the line.">
        <EChart option={miniXY(th, [{ name: 'replacement ratio', data: sweep, color: th.categorical[2] }], { xFmt: (v) => `${Math.round(v)}%`, yFmt: (v) => `${Math.round(v * 100)}%`, xMin: 5, xMax: 30, yMin: 0, points: [{ x: rate, y: proj?.replacementReal ?? 0, label: `${rate}%` }], refs: [{ y: 0.6, label: '60%' }] })} />
      </Viz>
      <Viz title="The two pots" note="contributions since 1 September 2024" size="beside" empty={!proj && 'Nobody of working age earns yet.'}>
        {proj && (
          <Tbl>
            <table>
              <thead><tr><th>Component</th><th className="n">At retirement</th><th>Rule</th></tr></thead>
              <tbody>
                <tr><td>Savings component (⅓)</td><td className="n">{money(proj.savingsComponent)}</td><td>one withdrawal a tax year allowed; taken in cash at retirement, taxed as income</td></tr>
                <tr><td>Retirement component (⅔)</td><td className="n">{money(proj.retirementComponent)}</td><td>must buy a pension: {money(proj.pensionLevel)} level or {money(proj.pensionReal)} rising a month</td></tr>
                <tr className="total"><td>Fund</td><td className="n">{money(proj.fundAtRetirement)}</td><td>whole fund annuitised: {money(proj.pensionLevelAll)} a month, {pct(proj.replacementLevelAll, 0)} of final pay</td></tr>
              </tbody>
            </table>
          </Tbl>
        )}
      </Viz>
      <Viz title="The state’s old-age grant: the province’s implicit pension liability" note={`R${grant.toLocaleString()} a month from 60, indexed to prices · valued at the real rate ${pct(gl.realRate, 2)}`} size="big" info="The actuarial present value of the grant to everyone alive today: an immediate annuity 12G·ä⁽¹²⁾ₓ for those past sixty and a deferred one 12G·ₙEₓ·ä⁽¹²⁾₆₀ for the rest, on the improved table at the real rate (the grant rises with the CPI). A social-security valuation in miniature: what the state has promised the people here.">
        <EChart option={barOption(th, gl.byBand.map((b) => b.band), [{ name: 'present value of the grant', data: gl.byBand.map((b) => Math.round(b.pv)), color: th.categorical[3] }])} />
        <div className="muted small">Total <b>{money(gl.pv)}</b>: {money(gl.pvCurrent)} for the {gl.recipients} people drawing it and {money(gl.pvDeferred)} deferred for the rest; the bill this year is {money(gl.annual)}{gdpYear > 0 ? ` (${pct(gl.annual / gdpYear, 1)} of the province’s GDP; the liability is ${(gl.pv / gdpYear).toFixed(1)} years of GDP)` : ''}.</div>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>Retirement and social security</h4></div>
        <div className="eq-grid">
          <Eq note="accumulation of a defined contribution">F_R = Σₖ cₖ · (1+i)^(R−k),  cₖ = c · Sₖ</Eq>
          <Eq note="the pension an annuity buys, and the replacement ratio">pension = F_R / (12·ä⁽¹²⁾_R),  RR = pension / S_R</Eq>
          <Eq note="an inflation-linked pension is priced at the real rate">ä⁽¹²⁾_R at r,  (1+i) = (1+r)(1+π)</Eq>
          <Eq note="the grant’s actuarial present value">APV = 12G · ä⁽¹²⁾ₓ (x ≥ 60),  12G · ₆₀₋ₓEₓ · ä⁽¹²⁾₆₀ (x &lt; 60)</Eq>
        </div>
        <div className="muted small">Wealth is created here by saving a share of pay through a working life and by pooling longevity: an annuity pays for as long as the pensioner lives, funded by those who die sooner. A defined-benefit fund would value its promise the same way, as the projected unit credit obligation IAS 19 (APN 207) requires, and SAP 201 sets what a retirement fund’s valuation report must show.</div>
      </div>
    </>
  );
}
