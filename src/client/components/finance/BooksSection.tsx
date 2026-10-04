import { useMemo, useState } from 'react';
import { ACCOUNT, CHART, balanceSheet, cashFlowStatement, changesInEquity, incomeStatement, ledgerLines, trialBalance } from '../../../sim/finance/accounts';
import { EChart } from '../../charts/EChart';
import { Mini, Tbl, Viz, lineOption, moneyAxis } from '../../charts/helpers';
import { miniColumns, miniSplit, miniTrend } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { store, useStore } from '../../lib/simStore';
import { R, dayIso, entityName, monthLabel } from './util';

type Stmt = 'income' | 'balance' | 'cashflow' | 'trial' | 'equity' | 'ledger' | 'journal' | 'annual';
const STMTS: Array<{ id: Stmt; label: string }> = [
  { id: 'income', label: 'Income statement' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'equity', label: 'Changes in equity' },
  { id: 'trial', label: 'Trial balance' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'journal', label: 'Journal' },
  { id: 'annual', label: 'Annual statements' },
];

export function BooksSection() {
  const st = useStore();
  const th = chartTheme();
  const F = st.sim.world.finance;
  const L = F.ledgers;
  const ids = Object.keys(L.books).sort((a, b) => order(a) - order(b) || L.books[a].name.localeCompare(L.books[b].name));
  const entity = st.financeEntity && L.books[st.financeEntity] ? st.financeEntity : 'bank';
  const book = L.books[entity];
  const [stmt, setStmt] = useState<Stmt>('income');
  const [period, setPeriod] = useState<'month' | 'year' | 'ytd' | 'all'>('ytd');
  const [search, setSearch] = useState('');
  const now = F.month;
  const from = period === 'month' ? now : period === 'year' ? now - 11 : period === 'ytd' ? book.lastCloseMonth + 1 : 0;
  const account = st.financeAccount && ACCOUNT[st.financeAccount] ? st.financeAccount : '1020';
  const is = useMemo(() => incomeStatement(book, from, now), [book, from, now, L.journal.count]);
  const bs = useMemo(() => balanceSheet(book, now), [book, now, L.journal.count]);
  const cf = useMemo(() => cashFlowStatement(book, from, now), [book, from, now, L.journal.count]);
  const eq = useMemo(() => changesInEquity(book, from, now), [book, from, now, L.journal.count]);
  const tb = useMemo(() => trialBalance(book), [book, L.journal.count]);
  const lines = useMemo(() => (stmt === 'ledger' ? ledgerLines(L, entity, account).slice(-400).reverse() : []), [L, entity, account, stmt, L.journal.count]);
  const journal = useMemo(() => {
    if (stmt !== 'journal') return [];
    const q = search.trim().toLowerCase();
    return L.journal.entries.filter((e) => e.entity === entity && e.month >= from && (!q || e.memo.toLowerCase().includes(q) || e.ref.toLowerCase().includes(q) || e.lines.some((l) => l.account.startsWith(q)))).slice(-300).reverse();
  }, [L, entity, from, search, stmt, L.journal.count]);
  const periodLabel = from === now ? monthLabel(now) : `${monthLabel(Math.max(0, from))} – ${monthLabel(now)}`;
  const trend = lineOption(th, book.monthly.slice(-60).map((m) => monthLabel(m.month)), [{ name: 'revenue', data: book.monthly.slice(-60).map((m) => Math.round(m.revenue)) }, { name: 'expenses', data: book.monthly.slice(-60).map((m) => Math.round(m.expenses)) }, { name: 'cash', data: book.monthly.slice(-60).map((m) => Math.round(m.cash)) }], moneyAxis);
  return (
    <>
      <div className="viz wide books-head">
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="panel-label">Entity</span>
          <select value={entity} onChange={(e) => store.setFinance({ entity: e.target.value })}>
            {ids.map((id) => (<option key={id} value={id}>{L.books[id].name}{L.books[id].closedMonth !== null ? ' (closed)' : ''}</option>))}
          </select>
          <span className="panel-label" style={{ marginLeft: 8 }}>Period</span>
          <div className="seg">
            {(['month', 'ytd', 'year', 'all'] as const).map((p) => (<button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'month' ? 'this month' : p === 'ytd' ? 'financial year to date' : p === 'year' ? 'last 12 months' : 'since inception'}</button>))}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          {STMTS.map((s) => (<button key={s.id} className={`tab ${stmt === s.id ? 'active' : ''}`} onClick={() => setStmt(s.id)}>{s.label}</button>))}
        </div>
        <div className="muted small">{book.name} · {F.entities[entity]?.kind ?? 'household'} · tax regime {F.entities[entity]?.regime ?? 'individual'}{F.entities[entity]?.vatRegistered ? ' · VAT vendor' : ''} · {book.entryCount.toLocaleString()} entries since {monthLabel(book.openedMonth)} · last digest {book.lastHash}</div>
      </div>
      {stmt === 'income' && (
        <Viz title={`Income statement — ${periodLabel}`} wide>
          <Tbl>
            <table className="stmt">
              <tbody>
                <tr className="head"><td colSpan={2}>Revenue</td></tr>
                {is.revenue.map((l) => (<tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
                <tr className="total"><td>Total revenue</td><td className="n">{R(is.totalRevenue)}</td></tr>
                <tr className="head"><td colSpan={2}>Expenses</td></tr>
                {is.expenses.map((l) => (<tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="n">({R(l.amount)})</td></tr>))}
                <tr className="total"><td>Total expenses</td><td className="n">({R(is.totalExpenses)})</td></tr>
                <tr className="total"><td>Profit before tax</td><td className="n">{R(is.profitBeforeTax)}</td></tr>
                {is.incomeTax !== 0 && <tr><td><span className="code">5350</span> Income tax expense</td><td className="n">({R(is.incomeTax)})</td></tr>}
                <tr className="grand"><td>{is.netProfit >= 0 ? 'Net profit' : 'Net loss'} for the period</td><td className="n">{R(is.netProfit)}</td></tr>
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      {stmt === 'balance' && (
        <Viz title={`Statement of financial position — ${monthLabel(now)}`} note={bs.balanced ? 'assets = liabilities + equity ✓' : 'DOES NOT BALANCE'} wide>
          <div className="stmt-cols">
            <Tbl>
              <table className="stmt">
                <tbody>
                  <tr className="head"><td colSpan={2}>Assets</td></tr>
                  {bs.assets.map((l) => (<tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="n">{ACCOUNT[l.code]?.contra ? `(${R(-l.amount)})` : R(l.amount)}</td></tr>))}
                  <tr className="grand"><td>Total assets</td><td className="n">{R(bs.totalAssets)}</td></tr>
                </tbody>
              </table>
            </Tbl>
            <Tbl>
              <table className="stmt">
                <tbody>
                  <tr className="head"><td colSpan={2}>Liabilities</td></tr>
                  {bs.liabilities.map((l) => (<tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
                  <tr className="total"><td>Total liabilities</td><td className="n">{R(bs.totalLiabilities)}</td></tr>
                  <tr className="head"><td colSpan={2}>Equity</td></tr>
                  {bs.equity.map((l) => (<tr key={l.code}><td><span className="code">{l.code}</span> {l.name}</td><td className="n">{R(l.amount)}</td></tr>))}
                  <tr className="total"><td>Total equity</td><td className="n">{R(bs.totalEquity)}</td></tr>
                  <tr className="grand"><td>Total liabilities and equity</td><td className="n">{R(bs.totalLiabilities + bs.totalEquity)}</td></tr>
                </tbody>
              </table>
            </Tbl>
          </div>
        </Viz>
      )}
      {stmt === 'cashflow' && (
        <Viz title={`Statement of cash flows — ${periodLabel}`} note={cf.reconciles ? 'opening + net change = closing ✓' : 'does not reconcile'} wide>
          <Tbl>
            <table className="stmt">
              <tbody>
                <tr><td>Cash from operating activities</td><td className="n">{R(cf.operating)}</td></tr>
                <tr><td>Cash from investing activities</td><td className="n">{R(cf.investing)}</td></tr>
                <tr><td>Cash from financing activities</td><td className="n">{R(cf.financing)}</td></tr>
                <tr className="total"><td>Net change in cash</td><td className="n">{R(cf.netChange)}</td></tr>
                <tr><td>Cash at the start of the period</td><td className="n">{R(cf.opening)}</td></tr>
                <tr className="grand"><td>Cash at the end of the period</td><td className="n">{R(cf.closing)}</td></tr>
              </tbody>
            </table>
          </Tbl>
          <div className="muted small">Direct method: each cash movement is classified by the account it settles (IAS 7); for the bank, deposits and advances are operating.</div>
        </Viz>
      )}
      {stmt === 'equity' && (
        <Viz title={`Statement of changes in equity — ${periodLabel}`} wide>
          <Tbl>
            <table className="stmt">
              <tbody>
                <tr><td>Opening equity</td><td className="n">{R(eq.opening)}</td></tr>
                <tr><td>Profit or loss for the period</td><td className="n">{R(eq.profit)}</td></tr>
                <tr><td>Capital introduced or withdrawn</td><td className="n">{R(eq.capital)}</td></tr>
                <tr><td>Transfers to the statutory reserve</td><td className="n">{R(eq.transfers)}</td></tr>
                <tr><td>Dividends declared</td><td className="n">{R(eq.dividends)}</td></tr>
                <tr className="grand"><td>Closing equity</td><td className="n">{R(eq.closing)}</td></tr>
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      {stmt === 'trial' && (
        <Viz
          title={`Trial balance — ${monthLabel(now)}`}
          note={tb.balanced ? 'debits = credits ✓' : 'OUT OF BALANCE'}
          wide
          summary={(() => {
            const cls = (['asset', 'liability', 'equity', 'revenue', 'expense'] as const).map((t, i) => {
              const rows = tb.rows.filter((r) => ACCOUNT[r.code]?.type === t);
              return { name: ['assets', 'liabilities', 'equity', 'revenue', 'expenses'][i], values: [rows.reduce((a, r) => a + r.debit, 0), rows.reduce((a, r) => a + r.credit, 0)], color: th.categorical[i] };
            });
            return (
              <Mini
                height={58}
                option={miniSplit(th, ['debits', 'credits'], cls, { fmt: (v) => R(v, true) })}
                keys={[
                  ...cls.filter((c) => c.values[0] + c.values[1] > 0).map((c) => ({ label: c.name, color: c.color, mark: 'bar' as const })),
                  { label: tb.balanced ? 'balanced at' : 'OUT OF BALANCE', value: tb.balanced ? R(tb.totalDebit, true) : `${R(tb.totalDebit, true)} vs ${R(tb.totalCredit, true)}`, tone: tb.balanced ? 'ok' : 'err' },
                  { label: 'accounts in use', value: tb.rows.length },
                ]}
              />
            );
          })()}
        >
          <Tbl>
            <table className="stmt">
              <thead><tr><th>Account</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
              <tbody>
                {tb.rows.map((r) => (<tr key={r.code}><td><span className="code">{r.code}</span> {r.name}</td><td className="n">{r.debit ? R(r.debit) : ''}</td><td className="n">{r.credit ? R(r.credit) : ''}</td></tr>))}
                <tr className="grand"><td>Totals</td><td className="n">{R(tb.totalDebit)}</td><td className="n">{R(tb.totalCredit)}</td></tr>
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      {stmt === 'ledger' && (
        <Viz
          title={`General ledger — ${ACCOUNT[account].code} ${ACCOUNT[account].name}`}
          note={`${lines.length} retained postings (older months are summarised in the balance)`}
          wide
          summary={(() => {
            const asc = [...lines].reverse();
            return (
              <Mini
                controls={
                  <select value={account} onChange={(e) => store.setFinance({ account: e.target.value })}>
                    {CHART.filter((a) => Math.abs(book.balances[a.code] ?? 0) > 0.004 || a.code === account).map((a) => (<option key={a.code} value={a.code}>{a.code} {a.name}</option>))}
                  </select>
                }
                option={asc.length ? miniTrend(th, asc.map((l) => dayIso(l.day)), [{ name: 'balance', data: asc.map((l) => l.balance), color: th.categorical[0], area: true, label: true }], { fmt: (v) => R(v, true), step: true }) : null}
                keys={[
                  { label: 'retained postings', value: lines.length },
                  { label: 'latest', value: lines[0] ? `${dayIso(lines[0].day)} · ${lines[0].memo.slice(0, 60)}` : '—' },
                ]}
              />
            );
          })()}
        >
          <div className="row wrap small" style={{ gap: 6 }}>
            <select value={account} onChange={(e) => store.setFinance({ account: e.target.value })}>
              {CHART.filter((a) => Math.abs(book.balances[a.code] ?? 0) > 0.004 || a.code === account).map((a) => (<option key={a.code} value={a.code}>{a.code} {a.name}</option>))}
            </select>
          </div>
          <Tbl>
            <table className="stmt ledger">
              <thead><tr><th>Date</th><th>Ref</th><th>Narration</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></tr></thead>
              <tbody>
                {lines.map((l) => (<tr key={l.seq}><td>{dayIso(l.day)}</td><td className="ref">{l.ref}</td><td>{l.memo}</td><td className="n">{l.debit ? R(l.debit) : ''}</td><td className="n">{l.credit ? R(l.credit) : ''}</td><td className="n">{R(l.balance)}</td></tr>))}
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      {stmt === 'journal' && (
        <Viz
          title={`General journal — ${periodLabel}`}
          note={`chain digest ${L.journal.lastHash}`}
          wide
          summary={(() => {
            const perMonth = new Map<number, number>();
            for (const e of L.journal.entries) if (e.entity === entity && e.month >= from) perMonth.set(e.month, (perMonth.get(e.month) ?? 0) + 1);
            const ms = [...perMonth.keys()].sort((a, b) => a - b).slice(-36);
            return (
              <Mini
                option={ms.length > 1 ? miniColumns(th, ms.map((m) => monthLabel(m)), [{ name: 'entries', data: ms.map((m) => perMonth.get(m) ?? 0), color: th.categorical[0] }], { labelLast: true }) : null}
                keys={[
                  { label: 'entries since inception', value: L.journal.count.toLocaleString() },
                  { label: 'in this period', value: ms.reduce((a, m) => a + (perMonth.get(m) ?? 0), 0).toLocaleString() },
                  { label: 'latest', value: journal[0] ? `${dayIso(journal[0].day)} · ${journal[0].memo.slice(0, 60)}` : '—' },
                ]}
              />
            );
          })()}
        >
          <div className="row wrap small" style={{ gap: 6 }}>
            <input placeholder="search narration, reference or account code" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 280 }} />
          </div>
          <Tbl>
            <table className="stmt journal">
              <thead><tr><th>#</th><th>Date</th><th>Ref</th><th>Narration</th><th>Account</th><th className="n">Debit</th><th className="n">Credit</th><th>Digest</th></tr></thead>
              <tbody>
                {journal.map((e) => e.lines.map((l, i) => (
                  <tr key={`${e.seq}-${i}`} className={i === 0 ? 'first' : ''}>
                    <td>{i === 0 ? e.seq : ''}</td><td>{i === 0 ? dayIso(e.day) : ''}</td><td className="ref">{i === 0 ? e.ref : ''}</td><td className="memo" title={i === 0 ? `${e.memo}${e.counterparty ? ` (${entityName(F, e.counterparty)})` : ''}` : undefined}>{i === 0 ? `${e.memo}${e.counterparty ? ` (${entityName(F, e.counterparty)})` : ''}` : ''}</td>
                    <td><span className="code">{l.account}</span> {ACCOUNT[l.account]?.name}</td><td className="n">{l.debit ? R(l.debit) : ''}</td><td className="n">{l.credit ? R(l.credit) : ''}</td><td className="hash">{i === 0 ? e.hash.slice(0, 10) : ''}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      {stmt === 'annual' && (
        <Viz
          title="Annual financial statements (years of assessment closed)"
          wide
          empty={!book.closes.length && 'The first close happens at the end of February.'}
          summary={(() => {
            const c = book.closes[book.closes.length - 1];
            if (!c) return null;
            const cs = book.closes.slice(-30);
            const loss = cs.some((x) => x.income.netProfit < 0);
            return (
              <Mini
                option={miniColumns(th, cs.map((x) => String(x.year)), [{ name: 'net profit', data: cs.map((x) => Math.round(x.income.netProfit)), color: th.categorical[0] }], { fmt: (v) => R(v, true), signed: true, labelLast: true })}
                keys={[
                  { label: 'net profit', color: th.categorical[0], mark: 'bar' },
                  ...(loss ? [{ label: 'loss', color: th.categorical[1], mark: 'bar' as const }] : []),
                  { label: `revenue ${c.year}`, value: R(c.income.totalRevenue, true) },
                  { label: 'equity at close', value: R(c.balance.totalEquity, true) },
                  { label: 'dividends', value: R(c.dividends, true) },
                  { label: 'years closed', value: book.closes.length },
                ]}
              />
            );
          })()}
        >
          <Tbl>
            <table className="stmt">
              <thead><tr><th>Year</th><th className="n">Revenue</th><th className="n">Expenses</th><th className="n">Tax</th><th className="n">Net profit</th><th className="n">Dividends</th><th className="n">Assets</th><th className="n">Liabilities</th><th className="n">Equity</th><th className="n">Operating cash</th></tr></thead>
              <tbody>
                {[...book.closes].reverse().map((c) => (
                  <tr key={c.year}><td>{c.year} (to {monthLabel(c.month)})</td><td className="n">{R(c.income.totalRevenue)}</td><td className="n">{R(c.income.totalExpenses)}</td><td className="n">{R(c.income.incomeTax)}</td><td className="n">{R(c.income.netProfit)}</td><td className="n">{R(c.dividends)}</td><td className="n">{R(c.balance.totalAssets)}</td><td className="n">{R(c.balance.totalLiabilities)}</td><td className="n">{R(c.balance.totalEquity)}</td><td className="n">{R(c.cashFlow.operating)}</td></tr>
                ))}
              </tbody>
            </table>
          </Tbl>
        </Viz>
      )}
      <Viz title="Monthly revenue, expenses and cash" note="last 60 months" size="wide">
        <EChart option={trend} />
      </Viz>
    </>
  );
}

function order(id: string): number {
  if (id === 'bank') return 0;
  if (id === 'gov') return 1;
  if (id === 'church' || id === 'scheme') return 2;
  if (id.startsWith('hh:')) return 4;
  if (id === 'row') return 5;
  return 3;
}
