import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/narrative';
import { alivePeople, householdMembers } from '../../sim/ctx';
import { ARCHETYPE_LABEL } from '../../sim/personality';
import { JOBS, councilSeatOf } from '../../sim/population';
import { CITY, COMMUNITY } from '../../sim/world';
import { calendarForDay, fmtClock } from '../../sim/time';
import type { Building, Conversation, Household, Incident, Person, Vehicle } from '../../sim/types';
import { EChart } from '../charts/EChart';
import { moneyAxis } from '../charts/helpers';
import { baseOption, chartTheme } from '../charts/theme';
import { interview, scriptConversation } from '../lib/dialogue';
import { store, useStore } from '../lib/simStore';
import { balanceSheet, incomeStatement, natural } from '../../sim/finance/accounts';
import { hhEntity } from '../../sim/finance/posting';
import { R as fmtR, pct as fmtPct } from './finance/util';
import { useTheme } from '../lib/theme';
import { Glyph } from './Legend';
import { isDarkTheme, plotColor } from '../lib/householdColor';

export function Inspector() {
  const st = useStore();
  const w = st.sim.world;
  const sel = st.selection;
  if (!sel) {
    const picks = [w.roles.pastorId, w.roles.dmoId, w.roles.doctorId, w.roles.policeIds[0], w.roles.magistrateId].map((id) => (id ? w.people[id] : null)).filter((p): p is Person => !!p && p.alive);
    return (
      <aside className="inspector scroll">
      <div className="panel-rail" />
        <div className="card">
          <div className="panel-label">Inspector</div>
          <div className="muted">Click a person, a house or a building on the map. Double-click to drill in.</div>
          <div className="panel-label" style={{ marginTop: 6 }}>Key people</div>
          <div className="list">
            {picks.map((p) => (
              <div key={p.id} className="list-row" onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>
                <Glyph archetype={p.archetype} sex={p.sex} />
                <span>
                  {p.firstName} {p.surname}
                  <div className="sub">{JOBS[p.job].label}</div>
                </span>
                <span className="right">{p.age}</span>
              </div>
            ))}
          </div>
          <div className="panel-label" style={{ marginTop: 6 }}>Live conversations</div>
          <div className="list">
            {Object.values(w.conversations)
              .filter((c) => c.participantIds.every((id) => w.people[id]?.conversationId === c.id))
              .slice(-8)
              .map((c) => (
                <div key={c.id} className="list-row" onClick={() => store.select({ kind: 'conversation', id: c.id }, { focus: true })}>
                  <span />
                  <span>
                    {c.participantIds.map((id) => w.people[id]?.firstName).join(' & ')}
                    <div className="sub">{c.topic} · {c.tone}</div>
                  </span>
                  <span className="right">{c.lines.length} lines</span>
                </div>
              ))}
            {!Object.keys(w.conversations).length && <div className="muted small">None right now{st.sim.micro ? '' : ' (time-lapse mode)'}.</div>}
          </div>
        </div>
      </aside>
    );
  }
  return (
    <aside className="inspector scroll">
      <div className="panel-rail" />
      {sel.kind === 'person' && w.people[sel.id] && <PersonCard p={w.people[sel.id]} />}
      {sel.kind === 'household' && w.households[sel.id] && <HouseholdCard hh={w.households[sel.id]} />}
      {sel.kind === 'building' && w.buildings[sel.id] && <BuildingCard b={w.buildings[sel.id]} />}
      {sel.kind === 'conversation' && w.conversations[sel.id] && <ConversationCard c={w.conversations[sel.id]} />}
      {sel.kind === 'incident' && w.incidents[sel.id] && <IncidentCard inc={w.incidents[sel.id]} />}
    </aside>
  );
}

function PersonCard({ p }: { p: Person }) {
  const st = useStore();
  useTheme();
  const w = st.sim.world;
  const fin = w.finance;
  const slip = fin?.payslips[p.id];
  const taxYear = fin ? Object.values(fin.tax.personYears).filter((r) => r.personId === p.id).sort((a, b) => b.year.localeCompare(a.year))[0] : undefined;
  const hh = w.households[p.householdId];
  const home = hh ? w.buildings[hh.houseId] : null;
  const hcol = plotColor(home?.plot, isDarkTheme());
  const a = p.plan[p.planIdx];
  const partner = p.partnerId ? w.people[p.partnerId] : null;
  const rels = Object.entries(p.relationships)
    .map(([id, r]) => ({ id, r, q: w.people[id] }))
    .filter((x) => x.q && x.q.alive)
    .sort((x, y) => Math.abs(y.r.strength) - Math.abs(x.r.strength))
    .slice(0, 14);
  const b5 = p.big5;
  const conv = p.conversationId ? w.conversations[p.conversationId] : null;
  const seat = councilSeatOf(w, p.id);
  return (
    <>
      <div className="card">
        <h3>
          <Glyph archetype={p.archetype} sex={p.sex} size={22} /> {p.firstName} {p.surname}
          {!p.alive && <span className="tag err">deceased</span>}
          {p.away && <span className="tag warn">away: {p.away.reason}</span>}
        </h3>
        <div className="row wrap">
          <button className="ghost" onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>follow</button>
          {hh && <button className="ghost" onClick={() => store.select({ kind: 'household', id: hh.id }, { focus: true })}>household</button>}
          {conv && <button className="ghost" onClick={() => store.select({ kind: 'conversation', id: conv.id }, { focus: true })}>conversation</button>}
        </div>
        <div className="kv">
          <span className="k">Age</span><span className="v">{p.age} · {p.sex === 'M' ? 'male' : 'female'} · {p.stage}</span>
          <span className="k">Type</span><span className="v">{ARCHETYPE_LABEL[p.archetype]} ({p.shape})</span>
          <span className="k">Work</span><span className="v">{JOBS[p.job]?.label}{p.workplaceId ? ` at ${w.buildings[p.workplaceId]?.name}` : ''}{p.income ? ` · R${p.income.toLocaleString()}/mo` : ''}</span>
          {seat && <><span className="k">Council</span><span className="v">{seat.title} seat{seat.role !== 'health' ? ' · stipended' : ''}</span></>}
          {slip && <><span className="k">Payslip</span><span className="v">gross R{Math.round(slip.gross).toLocaleString()} · PAYE R{Math.round(slip.paye).toLocaleString()} · UIF R{Math.round(slip.uif).toLocaleString()} · net R{Math.round(slip.net).toLocaleString()}{slip.medicalBeneficiaries ? ` · medical credit for ${slip.medicalBeneficiaries}` : ''}</span></>}
          {taxYear && <><span className="k">SARS</span><span className="v">{taxYear.assessed ? `${taxYear.year} assessed: tax R${Math.round(taxYear.assessed.taxPayable).toLocaleString()} on R${Math.round(taxYear.assessed.taxableIncome).toLocaleString()}, ${taxYear.assessed.balance < 0 ? `refund R${Math.round(-taxYear.assessed.balance).toLocaleString()}` : `owing R${Math.round(taxYear.assessed.balance).toLocaleString()}`}` : `${taxYear.year} year to date: remuneration R${Math.round(taxYear.remuneration).toLocaleString()}, PAYE R${Math.round(taxYear.paye).toLocaleString()} (${taxYear.months} months)`}</span></>}
          <span className="k">Education</span><span className="v">{p.education}{p.schooling !== 'none' ? ` · ${p.schooling}` : ''}</span>
          <span className="k">Family</span><span className="v">{p.marital}{partner ? ` to ${partner.firstName} ${partner.surname}` : ''}{p.childIds.length ? ` · ${p.childIds.filter((id) => w.people[id]?.alive).length} children` : ''}</span>
          <span className="k">Home</span><span className="v">{hh ? <span className="hh-tag" style={{ borderColor: hcol }}><span className="hh-chip" style={{ background: hcol }} />{hh.name} household · plot {home?.plot} · {home ? `${COMMUNITY[home.community].short}, ${CITY[COMMUNITY[home.community].city].short}` : ''}</span> : '—'}</span>
          <span className="k">Now</span><span className="v">{a ? `${a.label} (${fmtClock(a.start)}–${fmtClock(a.end)})` : '—'}{p.loc.buildingId ? ` · ${w.buildings[p.loc.buildingId]?.name}` : p.inVehicleId ? ` · ${aboard(w.vehicles[p.inVehicleId], p)}` : p.waitingLine ? (p.waitingLine === 'hyperline' ? ' · waiting on the platform' : ' · waiting at the bus stop') : p.waitingFor ? ' · waiting at the gate' : ' · outside'}</span>
          <span className="k">Faith</span><span className="v">{Math.round(p.faith * 100)}% attendance propensity</span>
          <span className="k">Mood</span><span className="v">{p.mood.toFixed(2)} · stress {p.stress.toFixed(2)}{p.grief ? ` · grieving for ${p.grief.forName}` : ''}</span>
          <span className="k">Health</span>
          <span className="v">
            {p.health.state} · vitality {Math.round(p.health.vitality * 100)}%
            <div className="tags" style={{ marginTop: 3 }}>
              {p.health.illnesses.map((i) => (
                <span key={i.id} className={`tag ${i.severity > 0.6 ? 'err' : 'warn'}`}>{i.name} {Math.round(i.severity * 100)}%{i.treated ? ' · treated' : ''}{i.hospitalised ? ' · ward' : ''}</span>
              ))}
              {p.health.conditions.map((c) => (
                <span key={c} className="tag">{c}</span>
              ))}
              {p.pregnancy && <span className="tag ok">pregnant · due in {p.pregnancy.dueDay - w.day} d</span>}
            </div>
          </span>
          {p.criminalRecord > 0 && (<><span className="k">Record</span><span className="v">{p.criminalRecord} arrest(s)</span></>)}
        </div>
        <div className="panel-label">Big Five</div>
        <div className="bars">
          {([['O', b5.O], ['C', b5.C], ['E', b5.E], ['A', b5.A], ['N', b5.N]] as const).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span className="muted">{k}</span>
              <div className="track"><div className="fill" style={{ width: `${v * 100}%` }} /></div>
              <span className="num">{Math.round(v * 100)}</span>
            </div>
          ))}
        </div>
        <div className="panel-label">Today</div>
        <DayTimeline p={p} />
      </div>
      <div className="card">
        <div className="panel-label">Relationships</div>
        <div className="rel">
          {rels.map(({ id, r, q }) => (
            <div key={id} style={{ display: 'contents' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => store.select({ kind: 'person', id }, { focus: true })}>{q.firstName} {q.surname}</span>
              <span className="k">{r.kind}</span>
              <div className="meter"><i className={r.strength < 0 ? 'neg' : ''} style={{ left: r.strength < 0 ? `${50 + r.strength * 50}%` : '50%', width: `${Math.abs(r.strength) * 50}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="panel-label">Life history</div>
        <div className="hist">
          {[...p.history].reverse().slice(0, 30).map((h, i) => (
            <div key={i}><span className="d">{calendarForDay(store.startMs, h.day).isoDate}</span>{h.text}</div>
          ))}
        </div>
      </div>
      {p.alive && !p.emigrated && <Interview p={p} />}
    </>
  );
}

/** Where someone in a vehicle is, in words. */
function aboard(v: Vehicle | undefined, p?: Person): string {
  switch (v?.kind) {
    case 'ride':
      if (p && v.driverId === p.id) return v.stage === 'pickup' ? 'driving for Hamba, on the way to a pickup' : v.stage === 'ride' ? `driving for Hamba with a fare aboard (R${v.fare ?? '—'})` : v.stage === 'return' ? 'driving home at the end of the shift' : 'online on the Hamba app, waiting for a request';
      return `in a Hamba e-hailing car (R${v.fare ?? '—'}${(v.surge ?? 1) > 1.05 ? `, surge ×${(v.surge ?? 1).toFixed(1)}` : ''})`;
    case 'train':
      return 'aboard the Hyperline';
    case 'plane':
      return v.airborne ? 'in the air' : 'aboard the plane';
    case 'bus':
      return 'on the bus';
    case 'taxi':
      return 'in a minibus taxi';
    case 'ambulance':
      return 'in the ambulance';
    case 'police':
      return 'in the patrol car';
    default:
      return 'in the car';
  }
}

const KIND_COLOR: Record<string, string> = { sleep: 'var(--muted)', work: 'var(--link)', school: 'var(--link)', homeschool: 'var(--link)', church: 'var(--accent)', fellowship: 'var(--accent)', biblestudy: 'var(--accent)', youth: 'var(--accent)', choir: 'var(--accent)', funeral: 'var(--status-sad)', wedding: 'var(--status-joy)', celebration: 'var(--status-joy)', clinic: 'var(--adversarial)', hospital: 'var(--adversarial)', court: 'var(--dissent)' };

function DayTimeline({ p }: { p: Person }) {
  return (
    <>
      <div className="timeline" title={p.plan.map((a) => `${fmtClock(a.start)} ${a.label}`).join('\n')}>
        {p.plan.map((a, i) => (
          <span key={i} style={{ width: `${((a.end - a.start) / 1440) * 100}%`, background: KIND_COLOR[a.kind] ?? 'var(--border)', opacity: 0.85 }} title={`${fmtClock(a.start)}–${fmtClock(a.end)} ${a.label}`} />
        ))}
      </div>
      <div className="muted small">{p.plan.filter((a) => a.kind !== 'idle' && a.kind !== 'sleep').map((a) => `${fmtClock(a.start)} ${a.label}`).join(' · ')}</div>
    </>
  );
}

function Interview({ p }: { p: Person }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    setHistory([]);
    setLive('');
    setErr(null);
    abortRef.current?.();
  }, [p.id]);
  const ask = () => {
    const q = input.trim();
    if (!q || busy) return;
    const next: ChatMessage[] = [...history, { role: 'user', content: q }];
    setHistory(next);
    setInput('');
    setBusy(true);
    setErr(null);
    setLive('');
    let acc = '';
    abortRef.current = interview(p, next, {
      onDelta: (t) => {
        acc += t;
        setLive(acc);
      },
      onDone: (t) => {
        setHistory((h) => [...h, { role: 'assistant', content: t.trim() }]);
        setLive('');
        setBusy(false);
      },
      onError: (m) => {
        setErr(m);
        setBusy(false);
      },
    });
  };
  return (
    <div className="card">
      <div className="panel-label">Talk to {p.firstName}</div>
      <div className="convo">
        {history.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'user' ? 'right' : ''}`}>
            <div className="who">{m.role === 'user' ? 'you' : p.firstName}</div>
            {m.content}
          </div>
        ))}
        {live && (
          <div className="bubble live">
            <div className="who">{p.firstName}</div>
            {live}
          </div>
        )}
        {err && <div className="err small">{err}</div>}
      </div>
      <div className="chat-input">
        <input placeholder={`Ask ${p.firstName} something…`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} disabled={busy} />
        <button onClick={ask} disabled={busy || !input.trim()}>ask</button>
      </div>
      <div className="muted small">In character, from the simulation state only. Uses the configured model.</div>
    </div>
  );
}

function HouseholdCard({ hh }: { hh: Household }) {
  const st = useStore();
  const { resolved } = useTheme();
  const w = st.sim.world;
  const house = w.buildings[hh.houseId];
  const members = householdMembers(w, hh.id).sort((a, b) => b.age - a.age);
  const th = chartTheme();
  const ledger = hh.ledger.slice(-36);
  const option = {
    ...baseOption(th),
    grid: { left: 44, right: 10, top: 24, bottom: 22 },
    xAxis: { ...(baseOption(th).xAxis as object), type: 'category', data: ledger.map((l) => l.month) },
    yAxis: { ...(baseOption(th).yAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: moneyAxis } },
    series: [
      { name: 'income', type: 'line', data: ledger.map((l) => l.income), showSymbol: false, lineStyle: { width: 2 }, color: th.categorical[2] },
      { name: 'expenses', type: 'line', data: ledger.map((l) => l.expenses), showSymbol: false, lineStyle: { width: 2 }, color: th.categorical[1] },
      { name: 'savings', type: 'line', data: ledger.map((l) => l.savings), showSymbol: false, lineStyle: { width: 2 }, color: th.categorical[0] },
    ],
  };
  void resolved;
  return (
    <>
      <div className="card">
        <h3><span className="hh-chip" style={{ background: plotColor(house?.plot, isDarkTheme()), width: 14, height: 14 }} /> {hh.name} household</h3>
        <div className="row wrap">
          <button className="ghost" onClick={() => store.select({ kind: 'household', id: hh.id }, { focus: true })}>zoom to house</button>
        </div>
        <div className="kv">
          <span className="k">House</span><span className="v">{house?.name} (plot {house?.plot})</span>
          <span className="k">Income</span><span className="v">R{Math.round(hh.monthlyIncome).toLocaleString()}/mo · expenses R{Math.round(hh.monthlyExpenses).toLocaleString()}</span>
          <span className="k">Savings</span><span className={`v ${hh.savings < 0 ? 'err' : ''}`}>R{Math.round(hh.savings).toLocaleString()}{hh.poor ? ' · below the poverty line' : ''}</span>
          <span className="k">Cover</span><span className="v">{[hh.insurance.funeral && 'funeral', hh.insurance.life && 'life', hh.insurance.medical && 'medical aid'].filter(Boolean).join(', ') || 'none'}{hh.arrears ? ` · ${hh.arrears} mo arrears` : ''}</span>
          <span className="k">Cars</span><span className="v">{hh.vehicleId ? [hh.vehicleId, ...hh.extraVehicleIds].map((id) => w.vehicles[id]?.kind ?? 'car').join(', ') : 'none'}</span>
          <span className="k">School</span><span className="v">{hh.homeschool ? 'homeschools' : 'children attend the school'}</span>
          <span className="k">Faith</span><span className="v">{Math.round(hh.faith * 100)}%</span>
        </div>
        <div className="panel-label">Members</div>
        <div className="list">
          {members.map((p) => (
            <div key={p.id} className="list-row" onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>
              <Glyph archetype={p.archetype} sex={p.sex} />
              <span>
                {p.firstName} {p.surname}
                <div className="sub">{p.plan[p.planIdx]?.label ?? ''}</div>
              </span>
              <span className="right">{p.age} · {JOBS[p.job]?.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="panel-label">Household finances (last 36 months)</div>
        <EChart option={option} height={160} />
      </div>
      <HouseholdAccounts hh={hh} />
    </>
  );
}

/** The household's books in brief: this month's income statement and its balance sheet, with a way into the ledger. */
function HouseholdAccounts({ hh }: { hh: Household }) {
  const st = useStore();
  const F = st.sim.world.finance;
  const e = hhEntity(hh.id);
  const book = F?.ledgers.books[e];
  if (!book) return null;
  const is = incomeStatement(book, F.month, F.month);
  const bs = balanceSheet(book, F.month);
  const tax = is.expenses.filter((l) => l.code === '5110' || l.code === '5120').reduce((s, l) => s + l.amount, 0);
  const cons = is.expenses.filter((l) => l.code >= '5010' && l.code <= '5070').reduce((s, l) => s + l.amount, 0);
  const loans = Object.values(F.bank.loans).filter((l) => l.status === 'active' && l.borrower === e);
  return (
    <div className="card">
      <div className="panel-label">Accounts · this month</div>
      <div className="acct">
        <span className="h">Income statement</span>
        {is.revenue.map((l) => (<Fragment key={l.code}><span>{l.name}</span><span className="right">{fmtR(l.amount)}</span></Fragment>))}
        <span>Consumption</span><span className="right">({fmtR(cons)})</span>
        <span>PAYE and UIF</span><span className="right">({fmtR(tax)})</span>
        {is.expenses.filter((l) => !(l.code >= '5010' && l.code <= '5070') && l.code !== '5110' && l.code !== '5120').map((l) => (<Fragment key={l.code}><span>{l.name}</span><span className="right">({fmtR(l.amount)})</span></Fragment>))}
        <span className="t">Saved this month</span><span className="right t">{fmtR(is.netProfit)}</span>
        <span className="h">Balance sheet</span>
        <span>Deposits at the Mutual Bank</span><span className="right">{fmtR(natural(book, '1020'))}</span>
        {natural(book, '1510') > 0 && <><span>Vehicle (at cost)</span><span className="right">{fmtR(natural(book, '1510'))}</span></>}
        {natural(book, '1500') > 0 && <><span>Home improvements</span><span className="right">{fmtR(natural(book, '1500'))}</span></>}
        {natural(book, '1700') > 0 && <><span>Shares in the Mutual Bank</span><span className="right">{fmtR(natural(book, '1700'))}</span></>}
        {loans.map((l) => (<Fragment key={l.id}><span>Loan {l.id}: {l.purpose} ({l.monthsPaid}/{l.termMonths}{l.arrears ? `, ${l.arrears} in arrears` : ''})</span><span className="right">({fmtR(l.balance)})</span></Fragment>))}
        <span className="t">Net worth</span><span className="right t">{fmtR(bs.totalEquity)}</span>
      </div>
      <div className="row wrap">
        <button className="ghost" onClick={() => store.openFinance('books', e, '1020')}>open the ledger</button>
        <button className="ghost" onClick={() => store.openFinance('tax')}>tax</button>
      </div>
    </div>
  );
}

function BuildingCard({ b }: { b: Building }) {
  const st = useStore();
  const w = st.sim.world;
  const inside = alivePeople(w).filter((p) => p.loc.buildingId === b.id && !p.away);
  return (
    <div className="card">
      <h3>{b.name}</h3>
      <div className="kv">
        <span className="k">Kind</span><span className="v">{b.kind}</span>
        <span className="k">Rooms</span><span className="v">{b.rooms.map((r) => r.name).join(', ')}</span>
        <span className="k">Inside now</span><span className="v">{inside.length}</span>
      </div>
      <div className="list">
        {inside.map((p) => (
          <div key={p.id} className="list-row" onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>
            <Glyph archetype={p.archetype} sex={p.sex} />
            <span>
              {p.firstName} {p.surname}
              <div className="sub">{p.plan[p.planIdx]?.label ?? ''}{p.loc.roomId ? ` · ${b.rooms.find((r) => r.id === p.loc.roomId)?.name ?? ''}` : ''}</div>
            </span>
            <span className="right">{p.age}</span>
          </div>
        ))}
      </div>
      {b.kind === 'bank' && <BankBrief />}
      {b.kind === 'cemetery' && (
        <>
          <div className="panel-label">Graves</div>
          <div className="hist">{w.graves.map((g) => (<div key={g.personId}><span className="d">{calendarForDay(store.startMs, g.day).isoDate}</span>{g.name}</div>))}</div>
        </>
      )}
    </div>
  );
}

function BankBrief() {
  const st = useStore();
  const F = st.sim.world.finance;
  const book = F?.ledgers.books.bank;
  if (!book) return null;
  const B = F.bank;
  const loans = Object.values(B.loans).filter((l) => l.status === 'active');
  const last = B.monthly[B.monthly.length - 1];
  return (
    <>
      <div className="panel-label">{B.name}</div>
      <div className="acct">
        <span>Member deposits</span><span className="right">{fmtR(natural(book, '2100'))}</span>
        <span>Loans and advances ({loans.length} active)</span><span className="right">{fmtR(natural(book, '1150'))}</span>
        <span>Treasury bills and Reserve Bank balances</span><span className="right">{fmtR(natural(book, '1600') + natural(book, '1030'))}</span>
        <span>Capital and reserves</span><span className="right">{fmtR(natural(book, '3010') + natural(book, '3020') + natural(book, '3030') + natural(book, '3050'))}</span>
        <span>Capital adequacy · liquidity</span><span className="right">{last ? `${last.car > 9 ? '> 900%' : fmtPct(last.car)} · ${last.liquidity > 9 ? '> 900%' : fmtPct(last.liquidity)}` : '—'}</span>
        <span>Deposit rate · personal loans</span><span className="right">{fmtPct(B.rates.deposit, 2)} · {fmtPct(B.rates.personal, 2)}</span>
      </div>
      <div className="row wrap">
        <button className="ghost" onClick={() => store.openFinance('bank')}>open the bank's books</button>
      </div>
    </>
  );
}

function ConversationCard({ c }: { c: Conversation }) {
  const st = useStore();
  const w = st.sim.world;
  const parts = c.participantIds.map((id) => w.people[id]).filter(Boolean);
  const live = parts.every((p) => p.conversationId === c.id);
  const canScript = st.aiMode !== 'off' && (c.llm === 'none' || c.llm === 'failed') && live;
  return (
    <div className="card">
      <h3>{parts.map((p) => p.firstName).join(' & ')}</h3>
      <div className="row wrap">
        {parts.map((p) => (
          <button key={p.id} className="ghost" onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>
            <Glyph archetype={p.archetype} sex={p.sex} size={12} /> {p.firstName}
          </button>
        ))}
        <button className="ghost" onClick={() => store.select({ kind: 'conversation', id: c.id }, { focus: true })}>zoom in</button>
      </div>
      <div className="kv">
        <span className="k">Where</span><span className="v">{c.buildingId ? w.buildings[c.buildingId]?.name : 'outside'}</span>
        <span className="k">Tone</span><span className="v">{c.tone} · {c.topic}</span>
        <span className="k">Status</span><span className="v">{live ? 'talking' : 'ended'} · {c.llm === 'none' ? 'procedural chatter' : c.llm === 'pending' ? 'asking the model…' : c.llm === 'streaming' ? 'model is writing…' : c.llm === 'done' ? 'scripted by the model' : 'model failed — showing chatter'}</span>
        {live && c.hymn && (
          <>
            <span className="k">Singing</span><span className="v">hymn {c.hymn.number} · {c.hymn.title}</span>
            <span className="k">Voices</span><span className="v">{c.hymn.singerIds.length} of {c.hymn.singerIds.length + c.hymn.silentIds.length} in the pews</span>
          </>
        )}
      </div>
      {canScript && (
        <button className="primary" onClick={() => scriptConversation(c.id)}>Script with AI</button>
      )}
      {st.aiMode === 'off' && <div className="muted small">Dialogue AI is off (Settings → Dialogue).</div>}
      <div className="convo">
        {c.lines.map((l, i) => {
          const p = w.people[l.speakerId];
          const right = i > 0 && l.speakerId === c.participantIds[1];
          return (
            <div key={i} className={`bubble ${right ? 'right' : ''}`}>
              <div className="who">{l.chorus ? 'The congregation' : p?.firstName ?? '?'} · {fmtClock(l.minute % 1440)}</div>
              {l.chorus ? `♪ ${l.text}` : l.text}
            </div>
          );
        })}
        {(c.llm === 'pending' || c.llm === 'streaming') && <div className="bubble live"><div className="who">…</div></div>}
      </div>
    </div>
  );
}

function IncidentCard({ inc }: { inc: Incident }) {
  const st = useStore();
  const w = st.sim.world;
  const cc = inc.courtCaseId ? w.courtCases[inc.courtCaseId] : null;
  return (
    <div className="card">
      <h3>{inc.kind}</h3>
      <div className="kv">
        <span className="k">When</span><span className="v">{calendarForDay(store.startMs, inc.day).isoDate} {fmtClock(inc.minute)}</span>
        <span className="k">Where</span><span className="v">{inc.buildingId ? w.buildings[inc.buildingId]?.name : 'on the road'}</span>
        <span className="k">Status</span><span className="v">{inc.status} · {inc.outcome || '—'} · by {inc.handledBy ?? '—'}</span>
        <span className="k">Involved</span><span className="v">{inc.involvedIds.map((id) => w.people[id] ? `${w.people[id].firstName} ${w.people[id].surname}` : id).join(', ')}</span>
        {inc.loss > 0 && (<><span className="k">Loss</span><span className="v">R{inc.loss.toLocaleString()}</span></>)}
        {cc && (<><span className="k">Court</span><span className="v">{cc.charge} · {cc.verdict}{cc.sentence ? ` · ${cc.sentence}` : ''}</span></>)}
      </div>
    </div>
  );
}
