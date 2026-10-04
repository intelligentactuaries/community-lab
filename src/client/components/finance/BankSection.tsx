import { useMemo, useState } from 'react';
import { balanceSheet, incomeStatement, natural } from '../../../sim/finance/accounts';
import { amortisation, prudentialReturn } from '../../../sim/finance/bank';
import { EChart } from '../../charts/EChart';
import { Mini, Tbl, Viz, barOption, lineOption, moneyAxis } from '../../charts/helpers';
import { miniRows, miniSplit, miniTrend } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { store, useStore } from '../../lib/simStore';
import { Kpis } from './FinanceWorkspace';
import { R, entityName, monthLabel, pct } from './util';

export function BankSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const B = F.bank;
  const book = F.ledgers.books.bank;
  const now = F.month;
  const ret = useMemo(() => prudentialReturn({ ...F, bank: { ...B, returns: [] } }, now, 'live'), [F, B, now, F.ledgers.journal.count]);
  const bs = balanceSheet(book, now);
  const is = incomeStatement(book, book.lastCloseMonth + 1, now);
  const loans = Object.values(B.loans).sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.startMonth - a.startMonth);
  const [pick, setPick] = useState<string | null>(null);
  const loan = loans.find((l) => l.id === pick) ?? loans.find((l) => l.status === 'active') ?? loans[0];
  const sched = loan ? amortisation(loan.principal, loan.rate, loan.termMonths) : [];
  const mo = B.monthly.slice(-60);
  const stages = [1, 2, 3].map((s) => loans.filter((l) => l.status === 'active' && l.stage === s).reduce((a, l) => a + l.balance, 0));
  const shares = Object.entries(B.shares).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="viz wide kpi-row">
        <Kpis items={[
          { label: 'Member deposits', value: R(ret.deposits, true), sub: `${Object.keys(F.ledgers.books).filter((k) => k !== 'bank' && k !== 'gov' && k !== 'row').length} accounts · ${pct(B.rates.deposit, 2)} p.a.` },
          { label: 'Loans and advances', value: R(ret.loansGross, true), sub: `${loans.filter((l) => l.status === 'active').length} active · allowance ${R(ret.allowance, true)}` },
          { label: 'Capital adequacy', value: ret.car > 9 ? '> 900%' : pct(ret.car), sub: `minimum ${pct(B.rules.carMin, 0)} + buffer ${pct(B.rules.carBuffer, 1)}`, tone: ret.car < B.rules.carMin ? 'err' : undefined },
          { label: 'Liquid assets', value: ret.liquidityRatio > 9 ? '> 900%' : pct(ret.liquidityRatio), sub: `of deposits · required ${pct(B.rules.liquidMin, 0)}`, tone: ret.liquidityRatio < B.rules.liquidMin ? 'err' : undefined },
          { label: 'Non-performing loans', value: pct(ret.nplRatio), sub: `coverage ${ret.npl > 0 ? pct(ret.coverage, 0) : '—'} · written off ${B.stats.writtenOff}`, tone: ret.nplRatio > 0.1 ? 'warn' : undefined },
          { label: 'NIM · ROE', value: `${pct(ret.nim)} · ${pct(ret.roe)}`, sub: `prime ${pct(F.macro.prime, 2)} · personal ${pct(B.rates.personal, 2)}` },
          { label: 'Year to date', value: R(is.netProfit, true), sub: `${is.netProfit >= 0 ? 'profit' : 'loss'} after tax · dividends paid ${R(B.stats.dividendsPaid, true)}` },
        ]} />
      </div>
      <Viz title="Statement of financial position" note={`${B.name} · ${monthLabel(now)}`}>
        <Tbl>
          <table className="stmt">
            <tbody>
              <tr className="head"><td colSpan={2}>Assets</td></tr>
              {bs.assets.map((l) => (<tr key={l.code}><td>{l.name}</td><td className="n">{l.code === '1160' || l.code === '1590' ? `(${R(-l.amount)})` : R(l.amount)}</td></tr>))}
              <tr className="grand"><td>Total assets</td><td className="n">{R(bs.totalAssets)}</td></tr>
              <tr className="head"><td colSpan={2}>Liabilities and equity</td></tr>
              {bs.liabilities.map((l) => (<tr key={l.code}><td>{l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
              {bs.equity.map((l) => (<tr key={l.code}><td>{l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
              <tr className="grand"><td>Total liabilities and equity</td><td className="n">{R(bs.totalLiabilities + bs.totalEquity)}</td></tr>
            </tbody>
          </table>
        </Tbl>
        <button className="ghost" onClick={() => store.setFinance({ section: 'books', entity: 'bank' })}>open the bank's full books</button>
      </Viz>
      <Viz title="Income statement, financial year to date">
        <Tbl>
          <table className="stmt">
            <tbody>
              {is.revenue.map((l) => (<tr key={l.code}><td>{l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
              {is.expenses.map((l) => (<tr key={l.code}><td>{l.name}</td><td className="n">({R(l.amount)})</td></tr>))}
              <tr className="total"><td>Profit before tax</td><td className="n">{R(is.profitBeforeTax)}</td></tr>
              <tr><td>Income tax (27%)</td><td className="n">({R(is.incomeTax)})</td></tr>
              <tr className="grand"><td>Profit after tax</td><td className="n">{R(is.netProfit)}</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz title="Deposits and advances" note="month-end balances" wide>
        <EChart option={lineOption(th, mo.map((m) => monthLabel(m.month)), [{ name: 'deposits', data: mo.map((m) => Math.round(m.deposits)) }, { name: 'loans', data: mo.map((m) => Math.round(m.loans)) }, { name: 'non-performing', data: mo.map((m) => Math.round(m.npl)) }], moneyAxis)} />
      </Viz>
      <Viz title="Interest income, interest expense and impairment" note="monthly" wide>
        <EChart option={barOption(th, mo.map((m) => monthLabel(m.month)), [{ name: 'interest income', data: mo.map((m) => Math.round(m.interestIncome)) }, { name: 'interest on deposits', data: mo.map((m) => -Math.round(m.interestExpense)) }, { name: 'impairment', data: mo.map((m) => -Math.round(m.impairment)) }])} />
      </Viz>
      <Viz
        title="Loan book"
        note={`IFRS 9 stages: 1 ${R(stages[0], true)} · 2 ${R(stages[1], true)} · 3 ${R(stages[2], true)}`}
        wide
        empty={!loans.length && 'No loans yet: members borrow for living costs, funerals, legal costs, cars, home improvements and working capital.'}
        summary={
          <Mini
            height={40}
            option={miniSplit(th, [''], [
              { name: 'stage 1: performing', values: [stages[0]], color: th.status.good },
              { name: 'stage 2: 30+ days past due', values: [stages[1]], color: th.status.warning },
              { name: 'stage 3: credit-impaired', values: [stages[2]], color: th.status.serious },
            ], { fmt: (v) => R(v, true) })}
            keys={[
              { label: 'stage 1', value: R(stages[0], true), color: th.status.good, mark: 'bar' },
              { label: 'stage 2', value: R(stages[1], true), color: th.status.warning, mark: 'bar' },
              { label: 'stage 3', value: R(stages[2], true), color: th.status.serious, mark: 'bar' },
              { label: 'active loans', value: loans.filter((l) => l.status === 'active').length },
              { label: 'non-performing', value: pct(ret.nplRatio), tone: ret.nplRatio > 0.1 ? 'warn' : undefined },
              { label: 'originated · settled · written off · declined', value: `${B.stats.originated} · ${B.stats.settled} · ${B.stats.writtenOff} · ${B.stats.declined}` },
            ]}
          />
        }
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Loan</th><th>Borrower</th><th>Purpose</th><th className="n">Principal</th><th className="n">Balance</th><th className="n">Rate</th><th className="n">Instalment</th><th className="n">Paid</th><th>Stage</th><th className="n">DPD</th><th>Status</th></tr></thead>
            <tbody>
              {loans.slice(0, 40).map((l) => (
                <tr key={l.id} className={loan?.id === l.id ? 'sel' : ''} onClick={() => setPick(l.id)} style={{ cursor: 'pointer' }}>
                  <td>{l.id}</td><td>{entityName(F, l.borrower)}</td><td>{l.purpose}</td><td className="n">{R(l.principal)}</td><td className="n">{R(l.balance)}</td><td className="n">{pct(l.rate, 2)}</td><td className="n">{R(l.instalment)}</td><td className="n">{l.monthsPaid}/{l.termMonths}</td><td>{l.status === 'active' ? l.stage : ''}</td><td className="n">{l.dpd}</td><td>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">Credit policy: instalment at most {pct(B.rules.maxInstalmentShare, 0)} of net income, total debt service at most {pct(B.rules.maxDebtService, 0)} (National Credit Act affordability); a single exposure above {pct(B.rules.largeExposure, 0)} of capital needs board approval, 25% is the ceiling. Expected credit losses: stage 1 PD {pct(B.rules.pd12, 1)} × LGD {pct(B.rules.lgd, 0)}; stage 2 (30+ days) lifetime PD {pct(B.rules.pdLifetime, 0)}; stage 3 (90+ days) LGD; write-off at 180 days. Declined {B.stats.declined}: {Object.entries(B.stats.declinedReasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.</div>
      </Viz>
      {loan && (
        <Viz
          title={`Amortisation schedule — ${loan.id}`}
          note={`${entityName(F, loan.borrower)} · ${loan.purpose} · ${pct(loan.rate, 2)} over ${loan.termMonths} months`}
          summary={
            <Mini
              option={miniTrend(th, sched.map((r) => `month ${r.k}`), [{ name: 'balance after the instalment', data: sched.map((r) => r.closing), color: th.categorical[0], area: true }], { fmt: (v) => R(v), zero: true, marks: loan.status === 'active' && loan.monthsPaid > 0 ? [{ at: Math.min(sched.length - 1, loan.monthsPaid - 1), label: 'now' }] : [] })}
              keys={[
                { label: 'instalment', value: R(loan.instalment) },
                { label: 'balance', value: R(loan.balance) },
                { label: 'paid', value: `${loan.monthsPaid} of ${loan.termMonths}` },
                { label: 'status', value: loan.status === 'active' ? `stage ${loan.stage}${loan.dpd ? ` · ${loan.dpd} dpd` : ''}` : loan.status, tone: loan.status === 'written-off' || loan.dpd >= 90 ? 'err' : loan.dpd > 0 ? 'warn' : undefined },
              ]}
            />
          }
        >
          <Tbl>
            <table className="stmt">
              <thead><tr><th className="n">#</th><th className="n">Opening</th><th className="n">Interest</th><th className="n">Capital</th><th className="n">Instalment</th><th className="n">Closing</th></tr></thead>
              <tbody>
                {sched.map((r) => (<tr key={r.k} className={r.k === loan.monthsPaid + 1 && loan.status === 'active' ? 'sel' : ''}><td className="n">{r.k}</td><td className="n">{R(r.opening)}</td><td className="n">{R(r.interest)}</td><td className="n">{R(r.principal)}</td><td className="n">{R(r.instalment)}</td><td className="n">{R(r.closing)}</td></tr>))}
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      <Viz
        title="Prudential returns to the Prudential Authority"
        note="quarterly"
        wide
        empty={!B.returns.length && 'The first return is filed at the end of the first quarter.'}
        summary={(() => {
          const r = B.returns[B.returns.length - 1];
          if (!r) return null;
          const qs = B.returns.slice(-24);
          const big = (v: number) => (v > 9 ? '> 900%' : pct(v, 0));
          return (
            <Mini
              option={miniRows(th, qs.map((x) => x.label), [
                { name: 'capital adequacy', data: qs.map((x) => x.car), color: th.categorical[0], fmt: big, refs: [{ y: B.rules.carMin, label: `minimum ${pct(B.rules.carMin, 0)}` }], cap: 9.5 },
                { name: 'liquid assets ÷ deposits', data: qs.map((x) => x.liquidityRatio), color: th.categorical[2], fmt: big, refs: [{ y: B.rules.liquidMin, label: `required ${pct(B.rules.liquidMin, 0)}` }], cap: 9.5 },
              ])}
              keys={[
                { label: `latest (${r.label}) NPL`, value: pct(r.nplRatio) },
                { label: 'breaches', value: r.breaches.length ? r.breaches.length : 'none', tone: r.breaches.length ? 'err' : 'ok' },
                { label: 'returns filed', value: B.returns.length },
              ]}
            />
          );
        })()}
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Quarter</th><th className="n">Qualifying capital</th><th className="n">RWA</th><th className="n">CAR</th><th className="n">Liquid assets</th><th className="n">Liquidity</th><th className="n">Loans</th><th className="n">NPL</th><th className="n">Coverage</th><th className="n">Largest exposure</th><th className="n">NIM</th><th className="n">ROE</th><th>Breaches</th></tr></thead>
            <tbody>
              {[...B.returns].reverse().slice(0, 16).map((r) => (
                <tr key={r.month}><td>{r.label}</td><td className="n">{R(r.qualifyingCapital, true)}</td><td className="n">{R(r.rwa, true)}</td><td className="n">{r.car > 9 ? '> 900%' : pct(r.car)}</td><td className="n">{R(r.liquidAssets, true)}</td><td className="n">{r.liquidityRatio > 9 ? '> 900%' : pct(r.liquidityRatio)}</td><td className="n">{R(r.loansGross, true)}</td><td className="n">{pct(r.nplRatio)}</td><td className="n">{r.npl > 0 ? pct(r.coverage, 0) : '—'}</td><td className="n">{pct(r.largestShare)}</td><td className="n">{pct(r.nim)}</td><td className="n">{pct(r.roe)}</td><td>{r.breaches.length ? r.breaches.join('; ') : 'none'}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz
        title="Members' shares and dividends"
        note="member shares; founding preference shares held outside"
        info={`Mutual Banks Act 124 of 1993: minimum share capital R10 million, capital adequacy on Basel I risk weights (unsecured retail 100%, government paper 0%), a prescribed share of liabilities held in liquid assets, ${pct(B.rules.reserveTransfer, 0)} of net profit to the general reserve each year; dividends on member shares (${pct(B.rules.payoutRatio, 0)} of distributable profit) only when capital is comfortably above target, less 20% dividends tax withheld for SARS.`}
        summary={
          (() => {
            // Every member holds the same share, so the card shows the bank's capital instead: who put it up, and what it has kept.
            const parts = [
              { name: 'founding preference shares', values: [B.foundingCapital], color: th.categorical[0] },
              { name: 'member shares', values: [shares.reduce((s, [, v]) => s + v, 0)], color: th.categorical[2] },
              { name: 'general reserve', values: [natural(book, '3030')], color: th.categorical[3] },
              { name: 'retained earnings', values: [natural(book, '3020')], color: th.categorical[4] },
            ];
            return (
              <Mini
                height={40}
                option={miniSplit(th, [''], parts, { fmt: (v) => R(v, true) })}
                keys={[
                  ...parts.map((p) => ({ label: p.name, value: R(p.values[0], true), color: p.color, mark: 'bar' as const })),
                  { label: 'members', value: shares.length },
                  { label: 'dividends paid · preference', value: `${R(B.stats.dividendsPaid, true)} · ${R(B.stats.preferenceDividends, true)}` },
                ]}
              />
            );
          })()
        }
      >
        <Tbl>
          <table className="stmt">
            <thead><tr><th>Holder</th><th className="n">Shares</th></tr></thead>
            <tbody>
              <tr><td>Founding preference shares (development fund, dividend at half the repo rate)</td><td className="n">{R(B.foundingCapital)}</td></tr>
              {shares.map(([e, v]) => (<tr key={e}><td>{entityName(F, e)}</td><td className="n">{R(v)}</td></tr>))}
              <tr className="total"><td>Statutory general reserve · retained earnings</td><td className="n">{R(natural(book, '3030'))} · {R(natural(book, '3020'))}</td></tr>
            </tbody>
          </table>
        </Tbl>
      </Viz>
    </>
  );
}
