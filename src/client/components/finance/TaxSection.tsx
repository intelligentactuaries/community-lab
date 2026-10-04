import { useMemo, useState } from 'react';
import { auditBooks, balanceSheet, cashFlowStatement, trialBalance, verifyChain } from '../../../sim/finance/accounts';
import { taxThreshold } from '../../../sim/finance/tax';
import { EChart } from '../../charts/EChart';
import { progressivityOption } from '../../charts/econ';
import { Mini, Stat, Tbl, Viz, barOption, moneyAxis } from '../../charts/helpers';
import { miniBars, miniColumns, miniSplit, miniXY } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { store, useStore } from '../../lib/simStore';
import { Kpis } from './FinanceWorkspace';
import { R, dayIso, entityName, monthLabel, pct } from './util';

export function TaxSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const T = F.tax.tables;
  const C = F.tax.collected;
  const gov = F.ledgers.books.gov;
  const months = F.macro.months.slice(-36);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [entFilter, setEntFilter] = useState<string>('all');
  const heads: Array<[string, string]> = [['4131', 'PAYE'], ['4132', 'VAT'], ['4133', 'company & turnover'], ['4134', 'UIF'], ['4135', 'SDL'], ['4136', 'fuel levies'], ['4137', 'fines & penalties'], ['4138', 'dividends tax'], ['4150', 'rates']];
  const mvOf = (code: string, month: number) => {
    const mv = gov.movements.find((v) => v.month === month);
    return mv ? -(mv.m[code] ?? 0) : 0;
  };
  const byHead = barOption(th, months.map((r) => r.isoDate.slice(0, 7)), heads.map(([code, name], i) => ({ name, data: months.map((r) => Math.round(mvOf(code, r.month))), stack: 'tax', color: [...th.categorical, ...th.sequential][i % 10] })));
  const ytdFrom = gov.lastCloseMonth + 1;
  const ytd = heads.map(([code, name]) => ({ name, code, amount: gov.movements.filter((v) => v.month >= ytdFrom).reduce((s, v) => s - (v.m[code] ?? 0), 0) }));
  const total = C.paye + C.vat + C.cit + C.uif + C.sdl + C.fuel + C.fines + C.dividends + C.rates;
  const filings = useMemo(() => [...F.tax.filings].reverse().filter((f) => (kindFilter === 'all' || f.kind === kindFilter) && (entFilter === 'all' || f.entity === entFilter)).slice(0, 150), [F.tax.filings, kindFilter, entFilter, F.tax.nextFiling]);
  const compliance = Object.entries(F.tax.compliance).filter(([id]) => F.ledgers.books[id] && F.ledgers.books[id].closedMonth === null && id !== 'row' && id !== 'gov');
  const nonCompliant = compliance.filter(([, c]) => c.status !== 'compliant');
  const assessed = Object.values(F.tax.personYears).filter((r) => r.assessed).sort((a, b) => b.year.localeCompare(a.year) || b.remuneration - a.remuneration);
  const entityYears = Object.values(F.tax.entityYears).sort((a, b) => b.year.localeCompare(a.year));
  const progress = assessed.filter((r) => r.assessed!.taxableIncome > 0).map((r) => ({ name: `${r.name} (${r.year})`, income: r.assessed!.taxableIncome, rate: r.assessed!.taxPayable / r.assessed!.taxableIncome }));
  const entities = Object.keys(F.ledgers.books).filter((id) => id !== 'row');
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Collected since the start', value: R(total, true), sub: `refunds paid ${R(C.refunds, true)}` },
          { label: 'PAYE · UIF · SDL', value: `${R(C.paye, true)} · ${R(C.uif, true)} · ${R(C.sdl, true)}`, sub: 'employees\' tax and contributions' },
          { label: 'VAT · company tax', value: `${R(C.vat, true)} · ${R(C.cit, true)}`, sub: `turnover tax within company tax ${R(C.turnover, true)}` },
          { label: 'Fuel · rates · fines · DT', value: `${R(C.fuel, true)} · ${R(C.rates, true)} · ${R(C.fines, true)} · ${R(C.dividends, true)}`, sub: `penalties and interest ${R(C.penalties, true)}` },
          { label: 'Compliance', value: `${compliance.length - nonCompliant.length}/${compliance.length}`, sub: nonCompliant.length ? `${nonCompliant.map(([id]) => entityName(F, id)).join(', ')} in arrears` : 'every taxpayer compliant', tone: nonCompliant.length ? 'warn' : 'ok' },
          { label: 'Year of assessment', value: T.yearLabel, sub: `tables indexed ×${F.taxIndexFactor.toFixed(3)} · ${F.tax.filings.length} returns filed` },
        ]} />
      </div>
      <Viz title="Tax revenue by head" note="monthly, cash basis (refunds net)" size="wide">
        <EChart option={byHead} />
      </Viz>
      <Viz title="Year of assessment to date by head">
        <Tbl>
          <table className="stmt">
            <tbody>
              {ytd.map((h) => (<tr key={h.code}><td><span className="code">{h.code}</span> {h.name}</td><td className="n">{R(h.amount)}</td></tr>))}
              <tr className="grand"><td>Total</td><td className="n">{R(ytd.reduce((s, h) => s + h.amount, 0))}</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title={`SARS tables in force — ${T.yearLabel} year of assessment`}
        note="Budget 2026 tables, indexed by the community's CPI in later years"
        summary={(() => {
          const top = T.brackets[T.brackets.length - 1];
          const steps: Array<[number, number]> = [...T.brackets.map((b) => [b.from, b.rate] as [number, number]), [top.from * 1.3, top.rate]];
          return (
            <Mini
              option={miniXY(th, [{ name: 'marginal rate', data: steps, color: th.categorical[3], step: true, area: true }], { xFmt: moneyAxis, yFmt: (v) => `${Math.round(v * 100)}%`, xMin: 0, xMax: top.from * 1.3, yMin: 0, yMax: 0.5 })}
              keys={[
                { label: `marginal rate, ${T.brackets.length} brackets`, color: th.categorical[3] },
                { label: 'top rate above', value: `R${top.from.toLocaleString()}` },
                { label: 'primary rebate', value: `R${T.primaryRebate.toLocaleString()}` },
                { label: 'VAT · CIT · DT', value: `${pct(T.vatRate, 0)} · ${pct(T.citRate, 0)} · ${pct(T.dividendsTaxRate, 0)}` },
                { label: 'indexed', value: `×${F.taxIndexFactor.toFixed(3)}` },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Taxable income</th><th className="n">Rate</th></tr></thead>
            <tbody>
              {T.brackets.map((b, i) => (<tr key={b.from}><td>{i === T.brackets.length - 1 ? `above R${b.from.toLocaleString()}` : `R${(b.from + (i ? 1 : 0)).toLocaleString()} – R${T.brackets[i + 1].from.toLocaleString()}`}</td><td className="n">{b.base ? `R${b.base.toLocaleString()} + ` : ''}{Math.round(b.rate * 100)}%{b.base ? ` above R${b.from.toLocaleString()}` : ''}</td></tr>))}
              <tr className="head"><td colSpan={2}>Rebates and thresholds</td></tr>
              <tr><td>Primary · secondary (65+) · tertiary (75+) rebate</td><td className="n">R{T.primaryRebate.toLocaleString()} · R{T.secondaryRebate.toLocaleString()} · R{T.tertiaryRebate.toLocaleString()}</td></tr>
              <tr><td>Tax threshold under 65 · 65–74 · 75+</td><td className="n">R{taxThreshold(40, T).toLocaleString()} · R{taxThreshold(65, T).toLocaleString()} · R{taxThreshold(75, T).toLocaleString()}</td></tr>
              <tr><td>Medical scheme fees credit (first two · each further, per month)</td><td className="n">R{T.mtcFirstTwo} · R{T.mtcAdditional}</td></tr>
              <tr><td>Interest exemption under 65 · 65+</td><td className="n">R{T.interestExemptionUnder65.toLocaleString()} · R{T.interestExemption65Plus.toLocaleString()}</td></tr>
              <tr className="head"><td colSpan={2}>Payroll and indirect taxes</td></tr>
              <tr><td>UIF (employee + employer) on remuneration to R{T.uifCeilingMonthly.toLocaleString()} a month</td><td className="n">{pct(T.uifRate, 0)} + {pct(T.uifRate, 0)}</td></tr>
              <tr><td>Skills development levy, payroll above R{T.sdlPayrollThreshold.toLocaleString()} a year</td><td className="n">{pct(T.sdlRate, 0)}</td></tr>
              <tr><td>VAT (zero-rated basic foods; registration compulsory above R{(T.vatCompulsoryThreshold / 1e6).toFixed(1)}m, voluntary from R{(T.vatVoluntaryThreshold / 1000).toFixed(0)}k)</td><td className="n">{pct(T.vatRate, 0)}</td></tr>
              <tr><td>Companies · dividends tax</td><td className="n">{pct(T.citRate, 0)} · {pct(T.dividendsTaxRate, 0)}</td></tr>
              <tr><td>Small business corporations (s12E)</td><td className="n">{T.sbc.map((b) => `${Math.round(b.rate * 100)}%${b.from ? ` above R${b.from.toLocaleString()}` : ' to R99,000'}`).join(' · ')}</td></tr>
              <tr><td>Turnover tax for micro businesses (turnover to R{(T.turnoverTaxLimit / 1e6).toFixed(1)}m)</td><td className="n">{T.turnoverTax.map((b) => `${b.rate * 100}%${b.from ? ` above R${b.from.toLocaleString()}` : ''}`).join(' · ')}</td></tr>
              <tr><td>Late payment penalty · interest</td><td className="n">{pct(T.latePaymentPenalty, 0)} · repo + {pct(T.prescribedSpread, 1)} (prescribed rate)</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz title="Progressivity: average tax rate by taxpayer" note="assessed individuals against the statutory schedule" wide empty={progress.length < 2 && 'After the first tax season (July).'}>
        <EChart option={progressivityOption(th, T, progress)} />
      </Viz>
      <Viz
        title="Taxpayer compliance status"
        note="Tax Administration Act: returns and payments"
        summary={(() => {
          const entities = compliance.filter(([id]) => !id.startsWith('hh:'));
          const hh = compliance.length - entities.length;
          const arrears = compliance.filter(([, c]) => c.status !== 'compliant');
          const owed = arrears.reduce((s, [, c]) => s + c.outstanding, 0);
          const pen = compliance.reduce((s, [, c]) => s + c.penalties, 0);
          const last = Math.max(-1, ...compliance.map(([, c]) => c.lastFiledDay));
          return (
            <Mini
              height={40}
              option={miniSplit(th, [''], [
                { name: 'compliant', values: [compliance.length - arrears.length], color: th.status.good },
                { name: 'in arrears', values: [arrears.length], color: th.status.serious },
              ])}
              keys={[
                { label: 'compliant', value: compliance.length - arrears.length, color: th.status.good, mark: 'bar' },
                { label: 'in arrears', value: arrears.length, color: th.status.serious, mark: 'bar', tone: arrears.length ? 'err' : undefined },
                { label: 'taxpayers', value: `${entities.length} + ${hh} households` },
                { label: 'outstanding', value: R(owed), tone: owed > 0 ? 'warn' : undefined },
                { label: 'penalties', value: R(pen) },
                { label: 'last filed', value: last >= 0 ? dayIso(last) : '—' },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Taxpayer</th><th>Regime</th><th>Status</th><th className="n">Outstanding</th><th className="n">Penalties</th><th>Last filed</th></tr></thead>
            <tbody>
              {compliance.filter(([id]) => !id.startsWith('hh:') || F.tax.compliance[id].status !== 'compliant').map(([id, c]) => (
                <tr key={id}><td>{entityName(F, id)}</td><td>{F.entities[id]?.regime ?? 'individual'}{F.entities[id]?.vatRegistered ? ' · VAT' : ''}</td><td><span className={`tag ${c.status === 'compliant' ? 'ok' : 'err'}`}>{c.status}</span></td><td className="n">{R(c.outstanding)}</td><td className="n">{R(c.penalties)}</td><td>{c.lastFiledDay >= 0 ? dayIso(c.lastFiledDay) : '—'}</td></tr>
              ))}
              <tr><td>Households (PAYE via employers; ITR12 in tax season)</td><td>individual</td><td><span className="tag ok">{compliance.filter(([id]) => id.startsWith('hh:')).length} compliant</span></td><td className="n"></td><td className="n"></td><td></td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title="Returns filed with SARS"
        note={`${F.tax.filings.length} on record`}
        wide
        summary={(() => {
          const byKind = new Map<string, number>();
          for (const f of F.tax.filings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
          const out = F.tax.filings.filter((f) => f.status === 'outstanding').length;
          return (
            <Mini
              option={miniBars(th, [...byKind].map(([label, value]) => ({ label, value })), { color: th.categorical[0], top: 5 })}
              keys={[
                { label: 'returns filed', value: F.tax.filings.length.toLocaleString() },
                { label: 'outstanding', value: out, tone: out ? 'warn' : undefined },
                { label: 'latest', value: filings[0] ? `${filings[0].kind} · ${entityName(F, filings[0].entity)} · ${filings[0].period}` : '—' },
              ]}
            />
          );
        })()}
      >
        <div className="row wrap small" style={{ gap: 6 }}>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">all return types</option>
            {['EMP201', 'VAT201', 'IRP6', 'ITR14', 'TT03', 'ITR12', 'DTR01'].map((k) => (<option key={k} value={k}>{k}</option>))}
          </select>
          <select value={entFilter} onChange={(e) => setEntFilter(e.target.value)}>
            <option value="all">all taxpayers</option>
            {entities.map((id) => (<option key={id} value={id}>{entityName(F, id)}</option>))}
          </select>
        </div>
        <Tbl>
          <table className="stmt">
            <thead><tr><th>#</th><th>Return</th><th>Taxpayer</th><th>Period</th><th>Filed</th><th>Due</th><th className="n">Assessed</th><th className="n">Paid</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {filings.map((f) => (<tr key={f.id}><td>{f.id}</td><td>{f.kind}</td><td>{entityName(F, f.entity)}</td><td>{f.period}</td><td>{dayIso(f.filedDay)}</td><td>{dayIso(f.dueDay)}</td><td className="n">{R(f.amount)}</td><td className="n">{R(f.paid)}</td><td><span className={`tag ${f.status === 'outstanding' ? 'err' : f.status === 'refunded' ? 'info' : 'ok'}`}>{f.status}</span></td><td>{f.note}</td></tr>))}
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">EMP201 monthly (PAYE, UIF, SDL, due by the 7th); VAT201 every two months (category A); IRP6 provisional payments in August and February and the ITR14 assessment in tax season; TT03 for the micro business on turnover tax; ITR12 individual assessments in July for the year ended in February; DTR01 dividends tax withheld at source.</div>
      </Viz>
      <Viz
        title="Individual assessments (ITR12)"
        note="year of assessment ended in February"
        wide
        empty={!assessed.length && 'After the first tax season (July).'}
        summary={(() => {
          const latest = assessed.filter((r) => r.year === assessed[0]?.year);
          const refunds = latest.reduce((s, r) => s + Math.max(0, -(r.assessed?.balance ?? 0)), 0);
          const owing = latest.reduce((s, r) => s + Math.max(0, r.assessed?.balance ?? 0), 0);
          const years = [...new Set(assessed.map((r) => r.year))].sort().slice(-20);
          const sumBy = (y: string, sign: 1 | -1) => assessed.filter((r) => r.year === y).reduce((s, r) => s + Math.max(0, sign * (r.assessed?.balance ?? 0)), 0);
          return (
            <Mini
              option={miniColumns(th, years, [
                { name: 'refunds', data: years.map((y) => Math.round(sumBy(y, -1))), color: th.categorical[0] },
                { name: 'owing', data: years.map((y) => Math.round(sumBy(y, 1))), color: th.categorical[1] },
              ], { fmt: (v) => R(v, true) })}
              keys={[
                { label: `refunds ${assessed[0]?.year}`, value: R(refunds, true), color: th.categorical[0], mark: 'bar' },
                { label: 'owing', value: R(owing, true), color: th.categorical[1], mark: 'bar' },
                { label: 'returns that season', value: latest.length },
                { label: 'assessed, all years', value: assessed.length },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Taxpayer</th><th>Year</th><th className="n">Age</th><th className="n">Months</th><th className="n">Remuneration</th><th className="n">Interest</th><th className="n">Taxable income</th><th className="n">Normal tax</th><th className="n">Rebates</th><th className="n">Medical credit</th><th className="n">Tax payable</th><th className="n">PAYE withheld</th><th className="n">Balance</th></tr></thead>
            <tbody>
              {assessed.slice(0, 60).map((r) => (<tr key={`${r.personId}${r.year}`}><td>{r.name}</td><td>{r.year}</td><td className="n">{r.age}</td><td className="n">{r.months}</td><td className="n">{R(r.remuneration)}</td><td className="n">{R(r.interest)}</td><td className="n">{R(r.assessed!.taxableIncome)}</td><td className="n">{R(r.assessed!.normalTax)}</td><td className="n">{R(r.assessed!.rebates)}</td><td className="n">{R(r.assessed!.medicalCredit)}</td><td className="n">{R(r.assessed!.taxPayable)}</td><td className="n">{R(r.paye)}</td><td className={`n ${r.assessed!.balance < 0 ? 'ok' : ''}`}>{r.assessed!.balance < 0 ? `refund ${R(-r.assessed!.balance)}` : R(r.assessed!.balance)}</td></tr>))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title="Business assessments (ITR14 / TT03)"
        wide
        empty={!entityYears.length && 'After the first year end.'}
        summary={(() => {
          const years = [...new Set(entityYears.map((e) => e.year))].sort().slice(-20);
          const pending = entityYears.filter((e) => e.assessedTax === null).length;
          return (
            <Mini
              option={miniColumns(th, years, [{ name: 'tax assessed', data: years.map((y) => Math.round(entityYears.filter((e) => e.year === y).reduce((s, e) => s + (e.assessedTax ?? 0), 0))), color: th.categorical[3] }], { fmt: (v) => R(v, true), labelLast: true })}
              keys={[
                { label: 'tax assessed a year', color: th.categorical[3], mark: 'bar' },
                { label: 'assessments', value: entityYears.length },
                { label: 'latest year', value: entityYears[0]?.year ?? '—' },
                { label: 'pending', value: pending, tone: pending ? 'warn' : undefined },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Taxpayer</th><th>Year</th><th>Regime</th><th className="n">Turnover</th><th className="n">Profit before tax</th><th className="n">Taxable income</th><th className="n">Provisional paid</th><th className="n">Assessed</th><th>Assessed on</th></tr></thead>
            <tbody>
              {entityYears.slice(0, 40).map((e) => (<tr key={`${e.entity}${e.year}`}><td>{entityName(F, e.entity)}</td><td>{e.year}</td><td>{e.regime}</td><td className="n">{R(e.turnover)}</td><td className="n">{R(e.profitBeforeTax)}</td><td className="n">{R(e.taxableIncome)}</td><td className="n">{R(e.provisionalPaid)}</td><td className="n">{e.assessedTax === null ? 'pending' : R(e.assessedTax)}</td><td>{e.assessedDay === null ? '—' : dayIso(e.assessedDay)}</td></tr>))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
    </>
  );
}

export function AuditSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const L = F.ledgers;
  const [result, setResult] = useState<{ ok: boolean; checked: number; firstBad: number | null; at: number } | null>(null);
  const exceptions = useMemo(() => auditBooks(L), [L, L.journal.count]);
  const articulation = useMemo(() => Object.keys(L.books).map((id) => {
    const b = L.books[id];
    const tb = trialBalance(b);
    const bs = balanceSheet(b, F.month);
    const cf = cashFlowStatement(b, b.lastCloseMonth + 1, F.month);
    return { id, name: b.name, entries: b.entryCount, tb: tb.balanced, bs: bs.balanced, cf: cf.reconciles, closes: b.closes.length, digest: b.lastHash };
  }), [L, F.month, L.journal.count]);
  const bad = articulation.filter((a) => !a.tb || !a.bs || !a.cf);
  const digests = [...L.journal.monthDigests].reverse().slice(0, 18);
  const log = [...F.log].reverse().slice(0, 40);
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Journal entries', value: L.journal.count.toLocaleString(), sub: `${L.journal.entries.length.toLocaleString()} retained in full · ${L.journal.pruned.toLocaleString()} archived to digests` },
          { label: 'Books', value: String(Object.keys(L.books).length), sub: `${articulation.filter((a) => a.closes).length} with annual statements` },
          { label: 'Articulation', value: bad.length ? `${bad.length} exceptions` : 'clean', sub: 'trial balance · balance sheet · cash flow', tone: bad.length ? 'err' : 'ok' },
          { label: 'Hash chain', value: result ? (result.ok ? 'intact' : 'BROKEN') : 'not verified', sub: result ? `${result.checked.toLocaleString()} entries checked at ${monthLabel(result.at)}` : 'click verify', tone: result ? (result.ok ? 'ok' : 'err') : undefined },
          { label: 'Chain digest', value: L.journal.lastHash.slice(0, 8), sub: L.journal.lastHash },
        ]} />
      </div>
      <Viz
        title="Verify the journal"
        note="hash-chained entries"
        info={`Each posting carries the FNV-1a 64-bit digest of the previous posting; recomputing the chain over the retained journal proves nothing was altered or removed. Months older than the retention window (${L.journal.retentionMonths}) are pruned after their month-end digest is stored, so the balances they built stay verifiable against the digests listed.`}
        summary={
          <>
            <button className="primary" onClick={() => { const r = verifyChain(L); setResult({ ...r, at: F.month }); }}>verify chain</button>
            <Stat label="chain" value={result ? (result.ok ? `intact · ${result.checked.toLocaleString()} checked` : 'BROKEN') : 'not verified'} tone={result ? (result.ok ? 'ok' : 'err') : undefined} />
            <Stat label="month digests" value={L.journal.monthDigests.length} />
            <Stat label="latest digest" value={L.journal.lastHash.slice(0, 10)} />
          </>
        }
      >
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="primary" onClick={() => { const r = verifyChain(L); setResult({ ...r, at: F.month }); }}>verify chain</button>
          <button className="ghost" onClick={() => store.setFinance({ section: 'books' })}>open the journal</button>
        </div>
        {result && !result.ok && <div className="err small">First bad entry: #{result.firstBad ?? 'tail'}.</div>}
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Month</th><th className="n">Entries</th><th className="n">Debits posted</th><th>Closing digest</th></tr></thead>
            <tbody>
              {digests.map((d) => (<tr key={d.month}><td>{monthLabel(d.month)}</td><td className="n">{d.count}</td><td className="n">{R(d.debits)}</td><td className="hash">{d.hash}</td></tr>))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title="Articulation of the statements by book"
        note="every trial balance balances, every balance sheet balances, every cash-flow statement reconciles"
        wide
        summary={
          <Mini
            height={40}
            option={miniSplit(th, [''], [
              { name: 'articulate', values: [articulation.length - bad.length], color: th.status.good },
              { name: 'exceptions', values: [bad.length], color: th.status.serious },
            ])}
            keys={[
              { label: 'books that articulate', value: articulation.length - bad.length, color: th.status.good, mark: 'bar', tone: bad.length ? undefined : 'ok' },
              { label: 'exceptions', value: bad.length, color: th.status.serious, mark: 'bar', tone: bad.length ? 'err' : undefined },
              { label: 'entries', value: articulation.reduce((s, a) => s + a.entries, 0).toLocaleString() },
              { label: 'years closed', value: articulation.reduce((s, a) => s + a.closes, 0) },
            ]}
          />
        }
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Book</th><th className="n">Entries</th><th>Trial balance</th><th>Balance sheet</th><th>Cash flow</th><th className="n">Years closed</th><th>Last digest</th></tr></thead>
            <tbody>
              {articulation.map((a) => (<tr key={a.id}><td><a onClick={() => store.setFinance({ section: 'books', entity: a.id })}>{a.name}</a></td><td className="n">{a.entries.toLocaleString()}</td><td><span className={`tag ${a.tb ? 'ok' : 'err'}`}>{a.tb ? 'balanced' : 'OUT'}</span></td><td><span className={`tag ${a.bs ? 'ok' : 'err'}`}>{a.bs ? 'balanced' : 'OUT'}</span></td><td><span className={`tag ${a.cf ? 'ok' : 'err'}`}>{a.cf ? 'reconciles' : 'NO'}</span></td><td className="n">{a.closes}</td><td className="hash">{a.digest}</td></tr>))}
            </tbody>
          </table>
        </Tbl>
        {exceptions.length > 0 && <div className="err small">{exceptions.map((e) => `${e.entity}: ${e.problem}`).join(' · ')}</div>}
      </Viz>
      <Viz
        title="Audit log"
        note="loans, filings, penalties, dividends, year-end closes"
        wide
        summary={(() => {
          const byKind = new Map<string, number>();
          for (const e of F.log) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
          return (
            <Mini
              option={miniBars(th, [...byKind].map(([label, value]) => ({ label, value })), { color: th.categorical[0], top: 5 })}
              keys={[
                { label: 'entries', value: F.log.length },
                { label: 'latest', value: log[0] ? `${dayIso(log[0].day)} · ${log[0].text.slice(0, 80)}` : '—' },
              ]}
            />
          );
        })()}
      >
        <div className="hist">
          {log.map((e, i) => (<div key={i}><span className="d">{dayIso(e.day)}</span><span className="muted">{e.kind}</span> {e.text}</div>))}
        </div>
      </Viz>
      <Viz title="Standards and sources" wide>
        <div className="muted small">
          Double-entry bookkeeping on a standard chart of accounts (1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses); statements presented on IFRS for SMEs lines: statement of financial position, statement of comprehensive income, statement of changes in equity, statement of cash flows (direct method, IAS 7 classes). Year end on the last day of February (the South African year of assessment). Payroll taxes per the Fourth Schedule to the Income Tax Act (PAYE by the annual-equivalent method), Unemployment Insurance Contributions Act, Skills Development Levies Act; VAT Act (15%, zero-rated basic foodstuffs, category A periods); Income Tax Act s12E (small business corporations), Sixth Schedule (turnover tax), s64E (dividends tax); Tax Administration Act ch. 15 and 16 (penalties and interest at the prescribed rate). Banking under the Mutual Banks Act 124 of 1993 with IFRS 9 expected credit losses and Basel I risk weights; credit granted under the National Credit Act affordability rules. Tables: SARS Budget 2026 (2026/27 year of assessment), SASSA grant values from 1 April 2026, national minimum wage from 1 March 2026, SARB repo rate and 3% target. See docs/ASSUMPTIONS.md for every figure and its provenance.
        </div>
      </Viz>
    </>
  );
}
