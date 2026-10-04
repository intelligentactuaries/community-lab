import { useMemo, useState } from 'react';
import { alivePeople } from '../../../sim/ctx';
import { lafferPoint, marginalRate } from '../../../sim/finance/tax';
import { engelFit, foodShare } from '../../../sim/finance/micro';
import { JOBS } from '../../../sim/population';
import { EChart } from '../../charts/EChart';
import { adasOption, budgetCurves, budgetLineOption, circularFlowOption, fittedScatterOption, labourCurves, labourOption, lafferOption, lorenzOption, supplyDemandOption } from '../../charts/econ';
import { lorenz } from '../../../sim/finance/macro';
import { Mini, Tbl, Viz, barOption, legendTop, lineOption, moneyAxis } from '../../charts/helpers';
import { miniBars, miniColumns, miniRows, miniTrend, miniXY } from '../../charts/mini';
import { baseOption, chartTheme } from '../../charts/theme';
import { store, useStore } from '../../lib/simStore';
import { Kpis } from './FinanceWorkspace';
import { R, monthLabel, pct, sectorFlows } from './util';

export function OverviewSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const w = st.sim.world;
  const M = F.macro;
  const months = M.months;
  const m = months[months.length - 1];
  const yearAgo = months.length > 12 ? months[months.length - 13] : null;
  const growth = yearAgo ? m.gdpReal / yearAgo.gdpReal - 1 : null;
  const x = months.map((r) => r.isoDate.slice(0, 7));
  const links = useMemo(() => sectorFlows(F, 12), [F, m.month]);
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  const jobs: Record<string, number> = {};
  for (const p of alivePeople(w)) if (p.age >= 15) jobs[JOBS[p.job].label] = (jobs[JOBS[p.job].label] ?? 0) + 1;
  const jobRows = Object.entries(jobs).sort((a, b) => b[1] - a[1]);
  const gdp = lineOption(th, x, [{ name: 'GDP nominal (R / month)', data: months.map((r) => Math.round(r.gdpNominal)) }, { name: 'GDP real (base prices)', data: months.map((r) => Math.round(r.gdpReal)) }, { name: 'potential output', data: months.map((r) => Math.round(r.potential)) }], moneyAxis) as Record<string, unknown>;
  ((gdp.series as Array<Record<string, unknown>>)[2]).lineStyle = { width: 1.4, type: 'dashed' };
  const prices = lineOption(th, x, [{ name: 'inflation (y/y)', data: months.map((r) => +(r.inflYoY * 100).toFixed(2)) }, { name: 'national baseline', data: months.map((r) => +(r.saInflation * 100).toFixed(2)) }, { name: 'repo rate', data: months.map((r) => +(r.repo * 100).toFixed(2)) }, { name: 'prime', data: months.map((r) => +(r.prime * 100).toFixed(2)) }], (v: number) => `${v}%`) as Record<string, unknown>;
  ((prices.series as Array<Record<string, unknown>>)[0]).markLine = { silent: true, symbol: 'none', lineStyle: { color: th.muted, type: 'dashed' }, label: { formatter: 'target 3%', color: th.muted, fontSize: 9.5 }, data: [{ yAxis: M.target * 100 }] };
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'GDP (nominal, monthly)', value: R(m.gdpNominal, true), sub: `real growth y/y ${growth === null ? '—' : pct(growth)}` },
          { label: 'Inflation (y/y)', value: pct(m.inflYoY), sub: `national ${pct(m.saInflation)} · target ${pct(M.target, 0)}`, tone: m.inflYoY > M.target + 0.01 ? 'warn' : undefined },
          { label: 'Repo · prime', value: `${pct(m.repo, 2)} · ${pct(m.prime, 2)}`, sub: `output gap ${pct(m.gap)}` },
          { label: 'Unemployment', value: pct(m.unemploymentRate), sub: `${m.employed} employed · ${m.unemployed} seeking · participation ${pct(m.participation, 0)}` },
          { label: 'Deposits · loans', value: `${R(m.deposits, true)} · ${R(m.loans, true)}`, sub: `credit growth ${m.creditGrowthYoY === null ? '—' : pct(m.creditGrowthYoY)}` },
          { label: 'Tax revenue (month)', value: R(m.taxRevenue, true), sub: `spending ${R(m.govSpending, true)} · fiscus transfer ${R(m.fiscalTransfer, true)}` },
          { label: 'Gini (income · wealth)', value: `${m.giniIncome.toFixed(2)} · ${m.giniWealth.toFixed(2)}`, sub: `saving rate ${pct(m.savingRate, 0)}` },
        ]} />
      </div>
      <Viz
        title="Output"
        note="production approach, monthly"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, x, [
              { name: 'potential output', data: months.map((r) => r.potential), color: th.categorical[2], dashed: true },
              { name: 'real GDP', data: months.map((r) => r.gdpReal), color: th.categorical[1], label: true },
            ], { fmt: (v) => R(v, true), last: 60 })}
            keys={[
              { label: 'real GDP', color: th.categorical[1] },
              { label: 'potential', value: R(m.potential, true), color: th.categorical[2], mark: 'dash' },
              { label: 'gap', value: pct(m.gap), tone: m.gap < -0.03 ? 'warn' : undefined },
            ]}
          />
        }
      >
        <EChart option={gdp} />
      </Viz>
      <Viz
        title="Prices and the policy rate"
        note="CPI y/y against the 3% target; MPC every second month"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, x, [
              { name: 'inflation (y/y)', data: months.map((r) => +(r.inflYoY * 100).toFixed(2)), color: th.categorical[0], label: true },
              { name: 'repo rate', data: months.map((r) => +(r.repo * 100).toFixed(2)), color: th.categorical[2], label: true },
            ], { fmt: (v) => `${v.toFixed(1)}%`, last: 60, refs: [{ y: M.target * 100, label: `${pct(M.target, 0)} target` }] })}
            keys={[
              { label: 'inflation y/y', color: th.categorical[0] },
              { label: 'repo', color: th.categorical[2] },
              { label: 'national', value: pct(m.saInflation) },
            ]}
          />
        }
      >
        <EChart option={prices} />
      </Viz>
      <Viz title="Circular flow of income (last 12 months)" note="each arrow points from payer to payee; width follows the rand value" wide>
        <EChart option={circularFlowOption(th, links)} />
        <div className="muted small">
          Largest flows: {[...links].sort((a, b) => b.value - a.value).slice(0, 5).map((l) => `${l.from} → ${l.to} ${R(l.value, true)}`).join(' · ')}. Hover an arrow for its amount, a sector for its total turnover.
        </div>
      </Viz>
      <Viz
        title="Household income distribution"
        note="ZAR / month, incl. grants and trading income"
        summaryLabel="full chart"
        summary={(() => {
          const inc = hhs.map((h) => h.monthlyIncome).sort((a, b) => a - b);
          const mid = inc[Math.floor(inc.length / 2)] ?? 0;
          const mean = inc.length ? inc.reduce((a, b) => a + b, 0) / inc.length : 0;
          // Doubling bands around the median, so the shape reads the same in any decade's rand.
          const edges = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8].map((k) => k * Math.max(1, mid));
          const counts = new Array(edges.length + 1).fill(0);
          for (const v of inc) counts[edges.filter((e) => v >= e).length]++;
          const band = (i: number) => (i === 0 ? `under ${moneyAxis(edges[0])}` : i === edges.length ? `${moneyAxis(edges[i - 1])}+` : `${moneyAxis(edges[i - 1])}–${moneyAxis(edges[i])}`);
          return (
            <Mini
              option={miniColumns(th, counts.map((_, i) => band(i)), [{ name: 'households', data: counts, color: th.categorical[0] }])}
              keys={[
                { label: 'median', value: `${R(mid, true)}/mo` },
                { label: 'mean', value: `${R(mean, true)}/mo` },
                { label: 'households', value: hhs.length },
              ]}
            />
          );
        })()}
      >
        <EChart option={barOption(th, hhs.map((h) => h.name), [{ name: 'income', data: hhs.map((h) => Math.round(h.monthlyIncome)) }], true)} />
      </Viz>
      <Viz
        title="Occupations (15+)"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniBars(th, jobRows.map(([label, value]) => ({ label, value })), { color: th.sequential[3], top: 5 })}
            keys={[
              { label: 'people 15+', value: jobRows.reduce((a, j) => a + j[1], 0) },
              { label: 'occupations', value: jobRows.length },
              { label: 'unemployed', value: jobs.Unemployed ?? 0, tone: (jobs.Unemployed ?? 0) > 8 ? 'warn' : undefined },
            ]}
          />
        }
      >
        <EChart option={barOption(th, jobRows.map((j) => j[0]), [{ name: 'people', data: jobRows.map((j) => j[1]), color: th.sequential[3] }], true)} />
      </Viz>
      <Viz
        title="Employment and poverty (monthly)"
        summaryLabel="full chart"
        summary={(() => {
          const poor = w.stats.series.slice(-months.length).map((s) => s.poorHouseholds);
          const poorNow = w.stats.series[w.stats.series.length - 1]?.poorHouseholds ?? 0;
          return (
            <Mini
              option={miniTrend(th, x, [
                { name: 'seeking work', data: months.map((r) => r.unemployed), color: th.categorical[1] },
                { name: 'poor households', data: [...new Array(Math.max(0, months.length - poor.length)).fill(null), ...poor], color: th.categorical[2] },
              ], { fmt: (v) => Math.round(v).toLocaleString(), last: 60, zero: true })}
              keys={[
                { label: 'seeking', value: m.unemployed, color: th.categorical[1] },
                { label: 'poor households', value: poorNow, color: th.categorical[2], tone: poorNow > hhs.length * 0.25 ? 'warn' : undefined },
                { label: 'employed', value: m.employed },
              ]}
            />
          );
        })()}
      >
        <EChart option={lineOption(th, x, [{ name: 'employed', data: months.map((r) => r.employed) }, { name: 'unemployed', data: months.map((r) => r.unemployed) }, { name: 'poor households', data: w.stats.series.slice(-months.length).map((s) => s.poorHouseholds) }])} />
      </Viz>
      <div className="viz wide note">
        <div className="muted small">
          Every figure here is read from the double-entry books (see <a onClick={() => store.setFinance({ section: 'books' })}>Books</a>): GDP by the production approach is value added of the shop, farm, workshop and co-operative, the bank's intermediation (FISIM, excluding its treasury-bill income, which is primary income from outside) and public and church services at cost, plus VAT, fuel levies and rates. The expenditure approach (C + I + G + X − M) is built independently from the same journal; the gap between them is reported as the statistical discrepancy under Macro.
        </div>
      </div>
    </>
  );
}

export function MicroSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const w = st.sim.world;
  const months = F.micro.months;
  const now = months[months.length - 1];
  const [compare, setCompare] = useState<number | 'none' | 'drought' | 'yearAgo'>('yearAgo');
  const [hhPick, setHhPick] = useState<string>('');
  if (!now) return <div className="viz wide"><div className="empty">The produce market clears at the first month end.</div></div>;
  let then: typeof now | null = null;
  if (compare === 'yearAgo') then = months.length > 12 ? months[months.length - 13] : months.length > 1 ? months[0] : null;
  else if (compare === 'drought') then = [...months].sort((a, b) => a.yield - b.yield)[0] ?? null;
  else if (typeof compare === 'number') then = months.find((m) => m.month === compare) ?? null;
  if (then === now) then = null;
  const L = F.micro.labour;
  const engel = F.micro.engel;
  const fit = engelFit(engel);
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  const picked = hhs.find((h) => h.id === hhPick) ?? hhs.sort((a, b) => b.monthlyIncome - a.monthlyIncome)[Math.floor(hhs.length / 2)];
  const pc = picked ? picked.monthlyIncome / Math.max(1, picked.memberIds.length) : 0;
  const alpha = foodShare(pc);
  const engelCurve = (() => {
    const xs = engel.map((e) => e.perCapita).filter((v) => v > 0);
    const lo = Math.max(300, Math.min(...xs));
    const hi = Math.max(...xs) * 1.05;
    const curve: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) {
      const v = lo * Math.pow(hi / lo, i / 40);
      curve.push([Math.round(v), +(fit ? fit.a + fit.b * Math.log(v) : foodShare(v)).toFixed(3)]);
    }
    return curve;
  })();
  const engelOpt = (() => {
    const b = baseOption(th);
    const curve = engelCurve;
    return {
      ...b,
      grid: { left: 10, right: 20, top: legendTop(['households', fit ? `Engel fit: share = ${fit.a.toFixed(2)} − ${Math.abs(fit.b).toFixed(3)}·ln(income)` : 'Engel curve (assumed)']), bottom: 30, containLabel: true },
      legend: { ...(b.legend as object), show: true, left: 0, right: 'auto' },
      tooltip: { ...(b.tooltip as object), trigger: 'item', formatter: (p: { name: string; value: [number, number] }) => `${p.name}<br/>R${Math.round(p.value[0]).toLocaleString()} per person · food share ${(p.value[1] * 100).toFixed(0)}%` },
      xAxis: { ...(b.xAxis as object), type: 'log', name: 'Income per person (R / month, log scale)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: moneyAxis } },
      yAxis: { ...(b.yAxis as object), type: 'value', name: 'Food share', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: th.fg2, fontSize: 10.5 }, axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` }, max: 0.6 },
      series: [
        { type: 'scatter', name: 'households', data: engel.filter((e) => e.perCapita > 0).map((e) => ({ name: e.name, value: [e.perCapita, e.foodShare] })), symbolSize: 9, itemStyle: { color: th.categorical[1], borderColor: th.surface, borderWidth: 1 } },
        { type: 'line', name: fit ? `Engel fit: share = ${fit.a.toFixed(2)} ${fit.b < 0 ? '−' : '+'} ${Math.abs(fit.b).toFixed(3)}·ln(income)` : 'Engel curve (assumed)', data: curve, showSymbol: false, color: th.categorical[4], lineStyle: { width: 2, type: 'dashed', color: th.categorical[4] }, silent: true },
      ],
    };
  })();
  const droughts = months.filter((m) => m.yield < 0.8).slice(-6);
  return (
    <>
      <Viz title="Supply and demand for local produce" note={then ? `${monthLabel(then.month)} (E) → ${monthLabel(now.month)} (E₁)` : monthLabel(now.month)} wide>
        <div className="row wrap small" style={{ gap: 6 }}>
          <span className="muted">compare with</span>
          <button className={`chip ${compare === 'yearAgo' ? 'on' : ''}`} onClick={() => setCompare('yearAgo')}>a year ago</button>
          <button className={`chip ${compare === 'drought' ? 'on' : ''}`} onClick={() => setCompare('drought')}>the worst harvest</button>
          <button className={`chip ${compare === 'none' ? 'on' : ''}`} onClick={() => setCompare('none')}>none (surpluses)</button>
          {droughts.map((d) => (
            <button key={d.month} className={`chip ${compare === d.month ? 'on' : ''}`} onClick={() => setCompare(d.month)}>{monthLabel(d.month)} (yield {Math.round(d.yield * 100)}%)</button>
          ))}
        </div>
        <EChart option={supplyDemandOption(th, now, then)} />
        <div className="muted small">
          Demand Q = A·P<sup>−{now.eps}</sup> (A = {Math.round(now.A).toLocaleString()}{then ? `, was ${Math.round(then.A).toLocaleString()}` : ''}), the farm's supply Q = S₀·yield·P<sup>{now.sigma}</sup> (S₀ = {Math.round(now.S0).toLocaleString()}, yield {Math.round(now.yield * 100)}%{then ? ` from ${Math.round(then.yield * 100)}%` : ''}, from the last three months' rain) and imports at parity {now.importParity.toFixed(2)}. {then ? `Demand shifts as households' spending on produce changes with their incomes and prices; supply shifts with the harvest. E: P = ${then.price.toFixed(2)}, Q = ${Math.round(then.quantity).toLocaleString()}; E₁: P = ${now.price.toFixed(2)}, Q = ${Math.round(now.quantity).toLocaleString()}` : `Cleared at P = ${now.price.toFixed(2)}, Q = ${Math.round(now.quantity).toLocaleString()}`} ({Math.round(now.localSupply).toLocaleString()} local, {Math.round(now.imports).toLocaleString()} brought in). Consumer surplus {R(now.consumerSurplus)}, producer surplus {R(now.producerSurplus)} (demand truncated at 3× the price). Realised price elasticity of demand {F.micro.elasticity.price === null ? 'needs more price moves' : F.micro.elasticity.price.toFixed(2)}.
        </div>
      </Viz>
      <Viz
        title="Produce price, yield and imports"
        note="monthly"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, months.map((m) => m.isoDate.slice(0, 7)), [
              { name: 'import parity', data: months.map((m) => m.importParity), color: th.categorical[2], dashed: true },
              { name: 'price (× base)', data: months.map((m) => m.price), color: th.categorical[0], label: true },
            ], { fmt: (v) => v.toFixed(2), last: 60 })}
            keys={[
              { label: 'price', color: th.categorical[0] },
              { label: 'import parity', value: now.importParity.toFixed(2), color: th.categorical[2], mark: 'dash' },
              { label: 'yield', value: `${Math.round(now.yield * 100)}%`, tone: now.yield < 0.8 ? 'warn' : undefined },
            ]}
          />
        }
      >
        <EChart option={lineOption(th, months.map((m) => m.isoDate.slice(0, 7)), [{ name: 'price (× base)', data: months.map((m) => m.price) }, { name: 'yield', data: months.map((m) => m.yield) }, { name: 'import parity', data: months.map((m) => m.importParity) }], (v: number) => v.toFixed(2))} />
      </Viz>
      <Viz title="Labour market" note={L ? `min. wage R${Math.round(L.nmwMonthly).toLocaleString()} · w* R${Math.round(L.equilibriumWage).toLocaleString()}` : ''} info={L ? `Demand: positions in the community worth at least the wage; supply: working-age people whose reservation wage (grant floor, education, age) is at or below it. The floor is the national minimum wage (R${F.macro.nmwHourly.toFixed(2)}/h × 40 h/week). Mean wage ${R(L.meanWage)}, median ${R(L.medianWage)}; ${L.employed} employed, ${L.unemployed} seeking.` : undefined} empty={!L && 'After the first month.'}
        summaryLabel="full chart"
        summary={L ? (() => {
          const c = labourCurves(L, 40);
          return (
            <Mini
              option={miniXY(th, [
                { name: 'demand', data: c.demand, color: th.categorical[4] },
                { name: 'supply', data: c.supply, color: th.categorical[0] },
              ], { xFmt: (v) => `${Math.round(v)}`, yFmt: moneyAxis, xMin: 0, xMax: c.nMax, yMin: c.lo, yMax: Math.min(c.hi, Math.max(3 * L.equilibriumWage, 2.5 * L.nmwMonthly)), refs: [{ y: L.nmwMonthly, label: 'min. wage' }], points: [{ x: c.atEquilibrium, y: L.equilibriumWage, label: 'w*', position: 'top' }] })}
              keys={[
                { label: 'demand', color: th.categorical[4] },
                { label: 'supply', color: th.categorical[0] },
                { label: 'w*', value: R(L.equilibriumWage, true) },
                { label: 'min. wage', value: R(L.nmwMonthly, true), color: th.muted, mark: 'dash' },
              ]}
            />
          );
        })() : undefined}
      >
        {L && <EChart option={labourOption(th, L)} />}
      </Viz>
      <Viz
        title="Engel's law across households"
        note="food share falls as income per person rises"
        summaryLabel="full chart"
        summary={(() => {
          const sh = engel.map((e) => e.foodShare).sort((a, b) => a - b);
          return (
            <Mini
              option={miniXY(th, [
                { name: 'households', data: engel.map((e) => [e.perCapita, e.foodShare] as [number, number]), color: th.categorical[1], kind: 'scatter' },
                { name: fit ? 'Engel fit' : 'Engel curve (assumed)', data: engelCurve, color: th.categorical[4], dashed: true },
              ], { xLog: true, xFmt: moneyAxis, yFmt: (v) => `${Math.round(v * 100)}%`, yMin: 0, yMax: 0.6 })}
              keys={[
                { label: 'households', color: th.categorical[1], mark: 'dot' },
                { label: fit ? 'fit' : 'assumed curve', color: th.categorical[4], mark: 'dash' },
                { label: 'median share', value: sh.length ? `${Math.round(sh[Math.floor(sh.length / 2)] * 100)}%` : '—' },
              ]}
            />
          );
        })()}
      >
        <EChart option={engelOpt} />
      </Viz>
      <Viz title="Consumer choice" note={picked ? `${picked.name} · R${Math.round(picked.monthlyIncome).toLocaleString()}/mo` : ''} info={`Budget line and indifference curve. Cobb–Douglas preferences with the food share α = ${alpha.toFixed(2)} implied by the Engel curve at this household's income per person; the optimum is where the budget line is tangent to the indifference curve (F* = αI / P_food).`}
        summaryLabel="full chart"
        summary={picked ? (() => {
          const budget = Math.max(1000, picked.monthlyIncome * 0.85);
          const c = budgetCurves(budget, now.price * 100, alpha);
          return (
            <Mini
              option={miniXY(th, [
                { name: 'budget line', data: c.budget, color: th.categorical[0] },
                { name: 'indifference curve', data: c.ic, color: th.categorical[4] },
              ], { xFmt: (v) => `${Math.round(v)}`, yFmt: moneyAxis, xMin: 0, xMax: c.fMax * 1.15, yMin: 0, yMax: budget * 1.15, points: [{ x: c.opt.food, y: c.opt.other, label: 'F*', position: 'right' }] })}
              keys={[
                { label: 'budget', color: th.categorical[0] },
                { label: 'U(F,O)', color: th.categorical[4] },
                { label: 'α', value: alpha.toFixed(2) },
                { label: 'F*', value: `${Math.round(c.opt.food).toLocaleString()} units` },
              ]}
            />
          );
        })() : undefined}
      >
        <div className="row wrap small" style={{ gap: 6 }}>
          <span className="muted">household</span>
          <select value={picked?.id ?? ''} onChange={(e) => setHhPick(e.target.value)}>
            {hhs.map((h) => (<option key={h.id} value={h.id}>{h.name}</option>))}
          </select>
        </div>
        {picked && <EChart option={budgetLineOption(th, Math.max(1000, picked.monthlyIncome * 0.85), now.price * 100, alpha)} />}
      </Viz>
      <Viz title="Elasticities and parameters">
        <Tbl>
          <table>
            <thead><tr><th>Quantity</th><th className="n">Value</th><th>Basis</th></tr></thead>
            <tbody>
              <tr><td>Own-price elasticity of demand, food (assumed)</td><td className="n">−{now.eps}</td><td>SA household-survey estimates cluster around −0.5 to −0.6</td></tr>
              <tr><td>Own-price elasticity of demand (realised, arc)</td><td className="n">{F.micro.elasticity.price === null ? '—' : F.micro.elasticity.price.toFixed(2)}</td><td>consecutive months with a price move over 1%</td></tr>
              <tr><td>Supply elasticity of the farm (assumed)</td><td className="n">{now.sigma}</td><td>short-run response of a small mixed farm</td></tr>
              <tr><td>Income elasticity of food (from the Engel fit)</td><td className="n">{fit ? (1 + fit.b / Math.max(0.05, fit.a + fit.b * Math.log(Math.max(1, pc)))).toFixed(2) : '—'}</td><td>1 + b / share at the median household</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
    </>
  );
}

export function MacroSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const M = F.macro;
  const months = M.months;
  const m = months[months.length - 1];
  const q = M.quarters;
  const q1 = q[q.length - 1];
  const [qPick, setQPick] = useState<number | null>(null);
  const q0 = q.length > 1 ? (qPick !== null ? q.find((x) => x.month === qPick) ?? q[Math.max(0, q.length - 5)] : q[Math.max(0, q.length - 5)]) : null;
  const x = months.map((r) => r.isoDate.slice(0, 7));
  const fiscal = barOption(th, x.slice(-36), [
    { name: 'PAYE & assessments', data: [], stack: 'rev' },
  ]);
  void fiscal;
  const gov = F.ledgers.books.gov;
  const heads: Array<[string, string]> = [['4131', 'PAYE'], ['4132', 'VAT'], ['4133', 'company & turnover tax'], ['4134', 'UIF'], ['4135', 'SDL'], ['4136', 'fuel levies'], ['4137', 'fines & penalties'], ['4138', 'dividends tax'], ['4150', 'rates']];
  const last36 = months.slice(-36);
  const mvOf = (code: string, month: number) => {
    const mv = gov.movements.find((v) => v.month === month);
    return mv ? -(mv.m[code] ?? 0) : 0;
  };
  const fiscalOpt = barOption(th, last36.map((r) => r.isoDate.slice(0, 7)), [
    ...heads.map(([code, name], i) => ({ name, data: last36.map((r) => Math.round(mvOf(code, r.month))), stack: 'revenue', color: [...th.categorical, ...th.sequential][i % 10] })),
  ]) as Record<string, unknown>;
  (fiscalOpt.series as Array<Record<string, unknown>>).push({ name: 'public spending', type: 'line', data: last36.map((r) => Math.round(r.govSpending)), showSymbol: false, lineStyle: { width: 2, color: th.fg }, color: th.fg });
  const money = lineOption(th, x, [{ name: 'member deposits', data: months.map((r) => Math.round(r.deposits)) }, { name: 'loans and advances', data: months.map((r) => Math.round(r.loans)) }], moneyAxis);
  const cpi = lineOption(th, x, [{ name: 'CPI (headline)', data: months.map((r) => r.cpi) }, { name: 'local produce prices', data: months.map((r) => r.foodCpi) }, { name: 'wage index × 100', data: months.map((r) => +(r.wageIndex * 100).toFixed(1)) }], (v: number) => v.toFixed(0));
  const incomes = F.micro.engel.map((e) => e.perCapita);
  const wealth = Object.keys(F.ledgers.books).filter((id) => id.startsWith('hh:') && F.ledgers.books[id].closedMonth === null).map((id) => {
    const b = F.ledgers.books[id];
    return (b.balances['1020'] ?? 0) + (b.balances['1510'] ?? 0) + (b.balances['1700'] ?? 0) + (b.balances['2050'] ?? 0);
  });
  const T = F.tax.tables;
  const taxpayers = Object.values(F.tax.personYears).filter((r) => r.year === String(Number(T.yearLabel))).map((r) => ({ taxable: r.remuneration, age: r.age }));
  const lafferPts: Array<[number, number]> = [];
  for (let k = 0; k <= 20; k++) lafferPts.push([k / 10, lafferPoint(taxpayers, k / 10, T)]);
  const phillips = q.map((r) => ({ x: r.unemploymentRate * 100, y: r.inflation * 100, label: r.label }));
  const okun = q.slice(1).map((r, i) => ({ x: (r.growth ?? 0) * 100, y: (r.unemploymentRate - q[i].unemploymentRate) * 100, label: r.label }));
  // Least squares, matching the fit drawn on the scatter cards.
  const ols = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
    if (sxx === 0) return null;
    const b = sxy / sxx;
    const syy = pts.reduce((a, p) => a + (p.y - my) ** 2, 0);
    const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
    return { a: my - b * mx, b, r2 };
  };
  // A scatter card: the quarters faint, the fitted line, the latest quarter solid and named.
  const fitCard = (pts: Array<{ x: number; y: number; label: string }>, f: ReturnType<typeof ols>, color: string, fmt: (v: number) => string) => {
    const xs = pts.map((p) => p.x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const last = pts[pts.length - 1];
    return miniXY(th, [
      { name: 'quarters', data: pts.map((p) => [p.x, p.y] as [number, number]), color, kind: 'scatter', faint: true },
      ...(f ? [{ name: 'fit', data: [[lo, f.a + f.b * lo], [hi, f.a + f.b * hi]] as Array<[number, number]>, color: th.fg2, dashed: true }] : []),
    ], { xFmt: fmt, yFmt: fmt, points: last ? [{ x: last.x, y: last.y, label: last.label, color }] : [] });
  };
  const phFit = ols(phillips);
  const okFit = ols(okun);
  return (
    <>
      <Viz title="Aggregate demand and aggregate supply" note={q1 ? (q0 ? `${q0.label} (E) → ${q1.label} (E₁)` : q1.label) : ''} wide empty={!q1 && 'Quarterly curves appear after the first full quarter.'}>
        {q1 && (
          <>
            <div className="row wrap small" style={{ gap: 6 }}>
              <span className="muted">shift from</span>
              {q.slice(0, -1).slice(-8).map((r) => (<button key={r.month} className={`chip ${q0?.month === r.month ? 'on' : ''}`} onClick={() => setQPick(r.month)}>{r.label}</button>))}
            </div>
            <EChart option={adasOption(th, q1, q0)} />
            <div className="muted small">
              AD through the quarter's (Y, P) with unit price elasticity; SRAS rises from the expected price level P<sup>e</sup> = {q1.Pe.toFixed(1)} with slope κ = {q1.kappa} around potential; LRAS at potential output Y* = {R(q1.Ystar, true)}. Output gap {pct((q1.Y - q1.Ystar) / q1.Ystar)}, quarterly inflation (annual) {pct(q1.inflation)}.
            </div>
          </>
        )}
      </Viz>
      <Viz title="GDP by the three approaches" note={monthLabel(m.month)} size="beside">
        <Tbl>
          <table>
            <thead><tr><th>Approach</th><th className="n">R / month</th></tr></thead>
            <tbody>
              <tr><td>Production: value added + taxes on products</td><td className="n">{R(m.gdpProduction)}</td></tr>
              <tr><td>Expenditure: C {R(m.consumption, true)} + I {R(m.investment, true)} + G {R(m.government, true)} + X {R(m.exports, true)} − M {R(m.imports, true)}</td><td className="n">{R(m.gdpExpenditure)}</td></tr>
              <tr><td>Income: compensation {R(m.compensation, true)} + operating surplus {R(m.operatingSurplus, true)} + taxes on products {R(m.taxesOnProducts, true)}</td><td className="n">{R(m.gdpIncome)}</td></tr>
              <tr className="total"><td>Statistical discrepancy (production − expenditure)</td><td className="n">{R(m.discrepancy)} ({pct(m.discrepancy / Math.max(1, m.gdpProduction))})</td></tr>
              <tr><td>Real GDP (base prices) · potential · gap</td><td className="n">{R(m.gdpReal)} · {R(m.potential)} · {pct(m.gap)}</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title="Phillips curve"
        note="quarterly unemployment vs inflation"
        empty={phillips.length < 3 && 'Needs three quarters.'}
        summaryLabel="full chart"
        summary={
          <Mini
            option={fitCard(phillips, phFit, th.categorical[4], (v) => `${v.toFixed(1)}%`)}
            keys={[
              { label: 'quarters', color: th.categorical[4], mark: 'dot' },
              { label: 'fit', color: th.fg2, mark: 'dash' },
              { label: 'slope', value: phFit ? phFit.b.toFixed(2) : '—' },
              { label: 'R²', value: phFit ? phFit.r2.toFixed(2) : '—' },
            ]}
          />
        }
      >
        <EChart option={fittedScatterOption(th, phillips, 'unemployment (%)', 'inflation (%)', (v) => `${v.toFixed(1)}%`, 4)} />
      </Viz>
      <Viz
        title="Okun's law"
        note="quarterly growth vs the change in unemployment"
        empty={okun.length < 3 && 'Needs three quarters.'}
        summaryLabel="full chart"
        summary={
          <Mini
            option={fitCard(okun, okFit, th.categorical[0], (v) => v.toFixed(1))}
            keys={[
              { label: 'quarters', color: th.categorical[0], mark: 'dot' },
              { label: 'fit', color: th.fg2, mark: 'dash' },
              { label: 'slope', value: okFit ? okFit.b.toFixed(2) : '—' },
              { label: 'R²', value: okFit ? okFit.r2.toFixed(2) : '—' },
            ]}
          />
        }
      >
        <EChart option={fittedScatterOption(th, okun, 'real growth q/q (%)', 'Δ unemployment (pp)', (v) => `${v.toFixed(1)}`, 0)} />
      </Viz>
      <Viz
        title="Money and credit"
        note="Mutual Bank balances"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniRows(th, x, [
              { name: 'member deposits', data: months.map((r) => r.deposits), color: th.categorical[0], fmt: (v) => R(v, true) },
              { name: 'loans and advances', data: months.map((r) => r.loans), color: th.categorical[1], fmt: (v) => R(v, true) },
            ], { last: 60 })}
            keys={[{ label: 'credit growth y/y', value: m.creditGrowthYoY === null ? '—' : pct(m.creditGrowthYoY) }]}
          />
        }
      >
        <EChart option={money} />
      </Viz>
      <Viz
        title="Prices and wages"
        note="indices, start = 100"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniTrend(th, x, [
              { name: 'wage index × 100', data: months.map((r) => +(r.wageIndex * 100).toFixed(1)), color: th.categorical[2], label: true },
              { name: 'CPI (headline)', data: months.map((r) => r.cpi), color: th.categorical[0], label: true },
            ], { fmt: (v) => v.toFixed(0) })}
            keys={[
              { label: 'CPI', color: th.categorical[0] },
              { label: 'wages × 100', color: th.categorical[2] },
              { label: 'local produce', value: m.foodCpi.toFixed(1) },
            ]}
          />
        }
      >
        <EChart option={cpi} />
      </Viz>
      <Viz
        title="Lorenz curves"
        note="income per person and household net worth"
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniXY(th, [
              { name: 'equality', data: [[0, 0], [1, 1]], color: th.muted, dashed: true },
              { name: 'income', data: lorenz(incomes), color: th.categorical[0], area: true },
              { name: 'net worth', data: lorenz(wealth), color: th.categorical[1] },
            ], { xFmt: (v) => `${Math.round(v * 100)}%`, yFmt: (v) => `${Math.round(v * 100)}%`, xMin: 0, xMax: 1, yMax: 1 })}
            keys={[
              { label: 'income Gini', value: m.giniIncome.toFixed(2), color: th.categorical[0] },
              { label: 'net worth Gini', value: m.giniWealth.toFixed(2), color: th.categorical[1] },
            ]}
          />
        }
      >
        <EChart option={lorenzOption(th, [{ name: 'Income', values: incomes, gini: m.giniIncome }, { name: 'Net worth', values: wealth, gini: m.giniWealth }])} />
      </Viz>
      <Viz
        title="Laffer curve"
        note={`elasticity of taxable income 0.25 · ${taxpayers.length} taxpayers this year`}
        summaryLabel="full chart"
        summary={(() => {
          const today = lafferPoint(taxpayers, 1, T);
          const pk = lafferPts.reduce((a, b) => (b[1] > a[1] ? b : a), lafferPts[0]);
          return (
            <Mini
              option={miniXY(th, [{ name: 'revenue', data: lafferPts, color: th.categorical[3], area: true }], {
                xFmt: (v) => `${v.toFixed(1)}×`,
                yFmt: moneyAxis,
                xMin: 0,
                xMax: lafferPts[lafferPts.length - 1][0],
                yMin: 0,
                points: [
                  { x: 1, y: today, label: 'today', position: pk[0] > 1 ? 'left' : 'right' },
                  ...(Math.abs(pk[0] - 1) > 0.05 ? [{ x: pk[0], y: pk[1], label: 'peak', color: th.categorical[4] }] : []),
                ],
              })}
              keys={[
                { label: 'today', value: `${R(today, true)}/yr` },
                { label: 'peak', value: `${pk[0].toFixed(1)}× · ${R(pk[1], true)}` },
              ]}
            />
          );
        })()}
      >
        <EChart option={lafferOption(th, lafferPts, [1, lafferPoint(taxpayers, 1, T)])} />
      </Viz>
      <Viz title="Fiscal position" note="tax revenue by head (stacked) against public spending; the fiscus funds the gap" size="wide">
        <EChart option={fiscalOpt} />
      </Viz>
      <Viz
        title="Quarterly national accounts"
        empty={!q.length && 'After the first full quarter.'}
        summary={(() => {
          const r = q[q.length - 1];
          if (!r) return null;
          return (
            <Mini
              option={miniTrend(th, q.map((x) => x.label), [
                { name: 'potential Y*', data: q.map((x) => x.Ystar), color: th.categorical[2], dashed: true },
                { name: 'real output Y', data: q.map((x) => x.Y), color: th.categorical[1], label: true },
              ], { fmt: (v) => R(v, true), last: 24 })}
              keys={[
                { label: `real output (${r.label})`, color: th.categorical[1] },
                { label: 'potential', value: R(r.Ystar, true), color: th.categorical[2], mark: 'dash' },
                { label: 'gap', value: pct((r.Y - r.Ystar) / r.Ystar) },
                { label: 'inflation', value: pct(r.inflation) },
                { label: 'growth q/q', value: r.growth === null ? '—' : pct(r.growth) },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table>
            <thead><tr><th>Quarter</th><th className="n">Real Y</th><th className="n">Y*</th><th className="n">gap</th><th className="n">P</th><th className="n">inflation</th><th className="n">growth q/q</th><th className="n">unemployment</th></tr></thead>
            <tbody>
              {q.slice(-12).reverse().map((r) => (
                <tr key={r.month}><td>{r.label}</td><td className="n">{R(r.Y, true)}</td><td className="n">{R(r.Ystar, true)}</td><td className="n">{pct((r.Y - r.Ystar) / r.Ystar)}</td><td className="n">{r.P.toFixed(1)}</td><td className="n">{pct(r.inflation)}</td><td className="n">{r.growth === null ? '—' : pct(r.growth)}</td><td className="n">{pct(r.unemploymentRate)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <div className="viz wide note">
        <div className="muted small">
          Monetary policy: a six-member committee meets every second month; each member&apos;s rate is a Taylor rule i = r* + π<sup>e</sup> + 1.5(π<sup>e</sup> − π*) + 0.5·gap with r* = {pct(M.neutralReal)} and a leaning of their own (−50 to +50 bp), smoothed 80/20, in 25 bp steps (50 bp when the rule is more than two points away); the step most members favour carries, the Governor breaking a tie. Expectations: a third anchored on the target, the rest national headline inflation (half of fuel&apos;s first-round effect looked through) and the province&apos;s own at 70/30. Votes and statements are under Transport. Marginal rate at the median earner {pct(marginalRate(Math.max(1, m.householdDisposable) * 12 / Math.max(1, Object.keys(F.ledgers.books).filter((k) => k.startsWith('hh:')).length), T.brackets), 0)}.
        </div>
      </div>
    </>
  );
}
