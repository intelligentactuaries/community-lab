import { useMemo, useState } from 'react';
import { accumulate, annuityCertain, loanSchedule, presentValue, yieldRate, type CashFlow } from '../../../sim/actuarial/interest';
import { EChart } from '../../charts/EChart';
import { money, timelineOption } from '../../charts/actuarial';
import { Tbl, Viz, barOption, lineOption } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { useStore } from '../../lib/simStore';
import { Kpis } from '../finance/FinanceWorkspace';
import { entityName, pct } from '../finance/util';
import { Eq, type Valuation } from './ActuarialWorkspace';

export function InterestSection({ V }: { V: Valuation }) {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const [n, setN] = useState(10);
  const [due, setDue] = useState(false);
  const [pay, setPay] = useState(1000);
  const a = annuityCertain(V.i, n);
  const flows: CashFlow[] = [];
  for (let k = 0; k < n; k++) flows.push({ t: due ? k : k + 1, amount: pay });
  const pvA = pay * (due ? a.aDue : a.a);
  const avA = pay * (due ? a.sDue : a.s);
  // Accumulation of R1,000 over thirty years at the province's rates, and what inflation leaves of it.
  const years = Array.from({ length: 31 }, (_, t) => t);
  const acc = (rate: number) => years.map((t) => Math.round(accumulate(1000, rate, t)));
  const real = years.map((t) => Math.round(accumulate(1000, V.rates.tbill, t) / Math.pow(1 + V.inflation, t)));
  const mattress = years.map((t) => Math.round(1000 / Math.pow(1 + V.inflation, t)));
  // The largest loan on the Mutual Bank's book, as a timeline from the borrower's side.
  const loan = useMemo(() => {
    if (!F) return null;
    const active = Object.values(F.bank.loans).filter((l) => l.status === 'active');
    if (!active.length) return null;
    return active.reduce((b, l) => (l.principal > b.principal ? l : b), active[0]);
  }, [F, F?.month]);
  const loanView = useMemo(() => {
    if (!loan) return null;
    const sched = loanSchedule(loan.principal, loan.rate / 12, loan.termMonths);
    const fl: CashFlow[] = [{ t: 0, amount: loan.principal, label: 'advance' }, ...sched.rows.map((r) => ({ t: r.k, amount: -r.instalment }))];
    const j = yieldRate(fl);
    return { sched, flows: fl, j, pvAtI: presentValue(sched.rows.map((r) => ({ t: r.k / 12, amount: r.instalment })), V.i) };
  }, [loan, V.i]);
  const table = [1, 5, 10, 15, 20, 25, 30, 40].map((k) => annuityCertain(V.i, k));
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'i (effective, a year)', value: pct(V.i, 2), sub: V.label },
          { label: 'v = 1/(1+i)', value: V.r.v.toFixed(5), sub: 'the discount factor' },
          { label: 'd = iv', value: pct(V.r.d, 3), sub: 'interest paid in advance' },
          { label: 'δ = ln(1+i)', value: pct(V.r.delta, 3), sub: 'the force of interest' },
          { label: 'i⁽¹²⁾ · d⁽¹²⁾', value: `${pct(V.r.i12, 3)} · ${pct(V.r.d12, 3)}`, sub: `monthly ${pct(V.r.monthly, 3)}` },
          { label: 'Real rate (Fisher)', value: pct(V.real, 2), sub: `(1+i) = (1+r)(1+π), π = ${pct(V.inflation, 1)}`, tone: V.real < 0 ? 'warn' : undefined },
        ]} />
      </div>
      <Viz title="A timeline: an annuity-certain" note={`${n} payments of ${money(pay)} ${due ? 'in advance' : 'in arrear'} at ${pct(V.i, 2)}`} size="big" info="The financial-mathematics timeline: payments on a line of time, their present value at time 0 (the bar's worth today) and their accumulated value at the end of the term. In advance the first payment is at 0 and the values are ä and s̈; in arrear the first is at 1 and they are a and s.">
        <div className="row wrap small" style={{ gap: 6 }}>
          <span className="muted">n</span>
          {[5, 10, 20, 30].map((k) => (<button key={k} className={`chip ${n === k ? 'on' : ''}`} onClick={() => setN(k)}>{k}</button>))}
          <span className="muted">timing</span>
          <button className={`chip ${!due ? 'on' : ''}`} onClick={() => setDue(false)}>in arrear (aₙ|)</button>
          <button className={`chip ${due ? 'on' : ''}`} onClick={() => setDue(true)}>in advance (äₙ|)</button>
          <label className="row" style={{ gap: 4 }}><span className="muted">payment R</span><input type="number" step={100} min={1} value={pay} onChange={(e) => setPay(Math.max(1, Number(e.target.value) || 0))} style={{ width: 80 }} /></label>
        </div>
        <EChart option={timelineOption(th, flows, { unit: 'year', pv: pvA, av: avA, end: n })} />
        <div className="muted small">PV = {money(pay)} × {due ? 'äₙ|' : 'aₙ|'} = {money(pay)} × {(due ? a.aDue : a.a).toFixed(4)} = <b>{money(pvA)}</b>; AV at year {n} = {money(pay)} × {due ? 's̈ₙ|' : 'sₙ|'} = {money(pay)} × {(due ? a.sDue : a.s).toFixed(4)} = <b>{money(avA)}</b>; and AV = PV·(1+i)ⁿ: {money(pvA * Math.pow(1 + V.i, n))}.</div>
      </Viz>
      <Viz title="Annuity-certain values at i" note={pct(V.i, 2)} size="beside">
        <Tbl>
          <table>
            <thead><tr><th className="n">n</th><th className="n">aₙ|</th><th className="n">äₙ|</th><th className="n">sₙ|</th><th className="n">s̈ₙ|</th><th className="n">(Ia)ₙ|</th><th className="n">a⁽¹²⁾ₙ|</th><th className="n">āₙ|</th></tr></thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.n}><td className="n">{r.n}</td><td className="n">{r.a.toFixed(4)}</td><td className="n">{r.aDue.toFixed(4)}</td><td className="n">{r.s.toFixed(3)}</td><td className="n">{r.sDue.toFixed(3)}</td><td className="n">{r.Ia.toFixed(3)}</td><td className="n">{r.a12.toFixed(4)}</td><td className="n">{r.aBar.toFixed(4)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz title="R1,000 accumulated over thirty years" note="the province’s own rates; the real line deflates by its CPI" info="A(t) = 1,000·(1+i)^t at the treasury-bill, deposit and prime rates. The real line is the treasury-bill accumulation deflated by inflation; the mattress is R1,000 kept as cash, worth 1,000/(1+π)^t.">
        <EChart option={lineOption(th, years.map(String), [
          { name: `prime ${pct(V.rates.prime, 1)}`, data: acc(V.rates.prime) },
          { name: `T-bill ${pct(V.rates.tbill, 1)}`, data: acc(V.rates.tbill) },
          { name: `deposit ${pct(V.rates.deposit, 1)}`, data: acc(V.rates.deposit) },
          { name: 'T-bill, real', data: real },
          { name: 'under the mattress', data: mattress },
        ], money)} />
      </Viz>
      <Viz title={loan ? `A loan as a timeline: ${entityName(F!, loan.borrower)}` : 'A loan as a timeline'} note={loan ? `${money(loan.principal)} · ${loan.termMonths} months at ${pct(loan.rate, 2)} nominal` : undefined} size="big" empty={!loanView && 'The Mutual Bank has no active loan yet.'} info="The borrower receives the advance at 0 and pays a level instalment L / aₙ| at the end of each month, n months at the monthly rate j = i⁽¹²⁾/12. The yield that solves the equation of value Σ CFₜ·vᵗ = 0 is the loan's own rate.">
        {loanView && loan && (
          <>
            <EChart option={timelineOption(th, loanView.flows, { unit: 'month', pv: presentValue(loanView.flows, loan.rate / 12), end: loan.termMonths })} />
            <div className="muted small">Instalment {money(loanView.sched.instalment)} = {money(loan.principal)} / a<sub>{loan.termMonths}|</sub> at j = {pct(loan.rate / 12, 3)} a month; total interest {money(loanView.sched.totalInterest)}. Yield solved from the flows: {loanView.j === null ? '—' : pct(loanView.j * 12, 2)} nominal a year ({loanView.j === null ? '—' : pct(Math.pow(1 + loanView.j, 12) - 1, 2)} effective). Valued at i = {pct(V.i, 2)} the instalments are worth {money(loanView.pvAtI)} against the {money(loan.principal)} advanced.</div>
          </>
        )}
      </Viz>
      <Viz title={loan ? 'Interest and capital in each instalment' : 'Interest and capital'} empty={!loanView && 'After the first loan.'} info="Early instalments are mostly interest on the outstanding balance; capital repayment grows as the balance falls.">
        {loanView && <EChart option={barOption(th, loanView.sched.rows.map((r) => String(r.k)), [{ name: 'interest', data: loanView.sched.rows.map((r) => Math.round(r.interest)), stack: 'inst' }, { name: 'capital', data: loanView.sched.rows.map((r) => Math.round(r.capital)), stack: 'inst' }])} />}
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>The theory of interest</h4></div>
        <div className="eq-grid">
          <Eq note="the discount factor and the rate of discount">v = 1/(1+i),  d = 1 − v = i·v,  δ = ln(1+i)</Eq>
          <Eq note="nominal rates convertible m times a year">(1 + i⁽ᵐ⁾/m)ᵐ = 1 + i,  (1 − d⁽ᵐ⁾/m)⁻ᵐ = 1 + i</Eq>
          <Eq note="an annuity-certain in arrear, in advance, accumulated">aₙ| = (1 − vⁿ)/i,  äₙ| = (1 − vⁿ)/d = (1+i)·aₙ|,  sₙ| = (1+i)ⁿ·aₙ|</Eq>
          <Eq note="increasing, monthly and continuous">(Ia)ₙ| = (äₙ| − n·vⁿ)/i,  a⁽¹²⁾ₙ| = (1 − vⁿ)/i⁽¹²⁾,  āₙ| = (1 − vⁿ)/δ</Eq>
          <Eq note="the equation of value, and the yield that balances it">Σ CFₜ · vᵗ = 0</Eq>
          <Eq note="a level-instalment loan">instalment = L / aₙ|,  interest in period k = j × balance</Eq>
          <Eq note="Fisher: nominal, real and inflation">(1 + i) = (1 + r)(1 + π)</Eq>
          <Eq note="duration: the sensitivity of a value to the rate">D = Σ t·CFₜ·vᵗ / Σ CFₜ·vᵗ,  D_mod = D/(1+i)</Eq>
        </div>
        <div className="muted small">The rates are the province’s own: the Reserve Bank’s repo rate as its committee votes it, prime at repo + 3.5, the Mutual Bank’s deposit rate and the treasury-bill rate its surplus earns; inflation is the CPI the books produce. Pick another rate at the top and every value here follows.</div>
      </div>
    </>
  );
}
