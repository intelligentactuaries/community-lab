import { useMemo, useState } from 'react';
import { alivePeople } from '../../sim/ctx';
import { MORTALITY_PRESETS } from '../../sim/mortality';
import { DEFAULT_PARAMS, type ScenarioParams } from '../../sim/params';
import { JOBS } from '../../sim/population';
import { fmtClock, calendarForDay } from '../../sim/time';
import type { SimEvent } from '../../sim/types';
import { CLIMATES } from '../../sim/weather';
import { store, useStore } from '../lib/simStore';
import { CITIES, CITY, COMMUNITY, cityOf } from '../../sim/world';
import { Chevron } from './Icons';
import { Glyph } from './Legend';
import { isDarkTheme, plotColor } from '../lib/householdColor';
import { useTheme } from '../lib/theme';

function Section({ id, title, count, open, onToggle, children }: { id: string; title: string; count?: string | number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="acc-head" onClick={onToggle} id={`sec-${id}`}>
        <span className="panel-label">{title}</span>
        <span className="row">
          {count !== undefined && <span className="count">{count}</span>}
          <Chevron size={13} open={open} />
        </span>
      </div>
      {open && <div className="acc-body">{children}</div>}
    </>
  );
}

export function Sidebar() {
  const st = useStore();
  useTheme();
  const [open, setOpen] = useState<Record<string, boolean>>({ scenario: false, households: true, people: false, events: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const w = st.sim.world;
  const people = alivePeople(w);
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length);
  return (
    <aside className="sidebar scroll">
      <div className="panel-rail" />
      <Section id="scenario" title="Scenario & basis" count={`#${w.basisHash}`} open={open.scenario} onToggle={() => toggle('scenario')}>
        <ScenarioForm />
      </Section>
      <Section id="households" title="Households" count={hhs.length} open={open.households} onToggle={() => toggle('households')}>
        <div className="list">
          {hhs
            .sort((a, b) => (w.buildings[a.houseId]?.plot ?? 0) - (w.buildings[b.houseId]?.plot ?? 0))
            .map((h, i, arr) => {
              const house = w.buildings[h.houseId];
              const members = h.memberIds.map((id) => w.people[id]).filter((p) => p?.alive);
              const sel = st.selection?.kind === 'household' && st.selection.id === h.id;
              const city = cityOf(house?.community);
              const prevCity = i > 0 ? cityOf(w.buildings[arr[i - 1].houseId]?.community) : null;
              return (
                <div key={h.id} style={{ display: 'contents' }}>
                  {city !== prevCity && <div className="panel-label" style={{ marginTop: i ? 8 : 2 }}>{CITY[city].name} · {CITIES.find((c) => c.id === city)?.blurb.split(':')[0]}</div>}
                <div className={`list-row ${sel ? 'sel' : ''}`} onClick={() => store.select({ kind: 'household', id: h.id }, { focus: true })}>
                  <span className="plotnum" style={{ background: plotColor(house?.plot, isDarkTheme()) }} title={`Plot ${house?.plot} — household colour`}>{house?.plot}</span>
                  <span>
                    <div>{h.name} <span className="muted small">· {house ? COMMUNITY[house.community].short : ''}</span></div>
                    <div className="sub">{members.map((m) => m.firstName).join(', ')}</div>
                  </span>
                  <span className="right">
                    {members.length} · R{Math.round(h.savings / 1000)}k{h.poor ? ' · poor' : ''}{h.vehicleId ? (h.extraVehicleIds.length ? ` · ${1 + h.extraVehicleIds.length} cars` : ' · car') : ''}
                  </span>
                </div>
                </div>
              );
            })}
        </div>
      </Section>
      <Section id="people" title="People" count={people.length} open={open.people} onToggle={() => toggle('people')}>
        <PeopleList />
      </Section>
      <Section id="events" title="Events" count={w.events.length} open={open.events} onToggle={() => toggle('events')}>
        <EventFeed />
      </Section>
    </aside>
  );
}

function PeopleList() {
  const st = useStore();
  useTheme();
  const [q, setQ] = useState('');
  const w = st.sim.world;
  const people = useMemo(() => {
    const list = alivePeople(w);
    const needle = q.trim().toLowerCase();
    return (needle ? list.filter((p) => `${p.firstName} ${p.surname} ${p.job} ${p.archetype}`.toLowerCase().includes(needle)) : list).sort((a, b) => a.surname.localeCompare(b.surname) || b.age - a.age);
  }, [w, q, st.sim.world.day]);
  return (
    <>
      <input className="search" placeholder="search name, job, type…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {people.map((p) => {
          const sel = st.selection?.kind === 'person' && st.selection.id === p.id;
          const a = p.plan[p.planIdx];
          return (
            <div key={p.id} className={`list-row ${sel ? 'sel' : ''}`} onClick={() => store.select({ kind: 'person', id: p.id }, { focus: true, follow: true })}>
              <Glyph archetype={p.archetype} sex={p.sex} />
              <span>
                <div>
                  {p.firstName} {p.surname}
                  {p.away ? <span className="tag" style={{ marginLeft: 6 }}>away</span> : null}
                </div>
                <div className="sub">{a?.label ?? '—'}</div>
              </span>
              <span className="right row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                {p.age} · {JOBS[p.job]?.label ?? p.job}
                <span className="hh-chip" style={{ background: plotColor(w.buildings[w.households[p.householdId]?.houseId ?? '']?.plot, isDarkTheme()) }} title={`${w.households[p.householdId]?.name ?? ''} household`} />
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const SEV_FILTERS = ['all', 'joy', 'sad', 'alert', 'danger'] as const;

function EventFeed() {
  const st = useStore();
  const [filter, setFilter] = useState<(typeof SEV_FILTERS)[number]>('all');
  const w = st.sim.world;
  const events = w.events.slice(-400).reverse().filter((e) => filter === 'all' || e.severity === filter).slice(0, 150);
  const jump = (e: SimEvent) => {
    if (e.personIds[0] && w.people[e.personIds[0]]?.alive) store.select({ kind: 'person', id: e.personIds[0] }, { focus: true, follow: false });
    else if (e.householdId && w.households[e.householdId]) store.select({ kind: 'household', id: e.householdId }, { focus: true });
    else if (e.buildingId && w.buildings[e.buildingId]) store.select({ kind: 'building', id: e.buildingId }, { focus: true });
  };
  return (
    <>
      <div className="row wrap" style={{ gap: 4 }}>
        {SEV_FILTERS.map((f) => (
          <button key={f} className={`ghost ${filter === f ? 'primary' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <div className="events">
        {events.map((e) => {
          const cal = calendarForDay(store.startMs, e.day);
          return (
            <div key={e.id} className={`ev ${e.severity}`} onClick={() => jump(e)}>
              <div className="bar" />
              <div>
                <span className="when">{cal.isoDate} {fmtClock(e.minute)} · {e.kind}</span>
                <div>{e.text}</div>
              </div>
            </div>
          );
        })}
        {!events.length && <div className="muted small">No events yet — press play.</div>}
      </div>
    </>
  );
}

// ─── Scenario form ────────────────────────────────────────────────────────

type NumKey = { [K in keyof ScenarioParams]-?: ScenarioParams[K] extends number ? K : never }[keyof ScenarioParams];

const NUMERIC: Array<{ key: NumKey; label: string; min: number; max: number; step: number; pct?: boolean; section?: string }> = [
  { key: 'households', label: 'Households at start', min: 1, max: 16, step: 1, section: 'Population' },
  { key: 'meanHouseholdSize', label: 'Mean household size', min: 1.5, max: 7, step: 0.1 },
  { key: 'maleShareAtBirth', label: 'Male share at birth', min: 0.45, max: 0.55, step: 0.001 },
  { key: 'homeschoolShare', label: 'Homeschool share', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'tertiaryProgression', label: 'Matric → tertiary (leaves)', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'mortalityImprovement', label: 'Mortality improvement / yr', min: 0, max: 0.03, step: 0.001, pct: true, section: 'Mortality & health' },
  { key: 'bereavementMultiplier', label: 'Widowhood mortality ×', min: 1, max: 3, step: 0.05 },
  { key: 'povertyMortalityMultiplier', label: 'Poverty mortality ×', min: 1, max: 2, step: 0.05 },
  { key: 'careQuality', label: 'Clinic care quality', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'fluAttackRate', label: 'Seasonal flu attack rate', min: 0, max: 0.5, step: 0.01, pct: true },
  { key: 'tfr', label: 'Total fertility rate', min: 0.8, max: 6, step: 0.01, section: 'Fertility & family' },
  { key: 'contraceptionShare', label: 'Extra contraception share', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'marriageAgeM', label: 'Peak marriage age (men)', min: 20, max: 45, step: 1 },
  { key: 'marriageAgeF', label: 'Peak marriage age (women)', min: 18, max: 42, step: 1 },
  { key: 'courtshipHazard', label: 'Courtship hazard / yr', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'divorceHazard', label: 'Divorce hazard / yr', min: 0, max: 0.1, step: 0.001, pct: true },
  { key: 'churchAttendance', label: 'Church attendance', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'youthEmigrationHazard', label: 'Youth emigration / yr', min: 0, max: 0.5, step: 0.01, pct: true, section: 'Migration & safety' },
  { key: 'immigrationHazard', label: 'Vacant house re-let / yr', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'intrudersPerYear', label: 'Intruder visits / yr', min: 0, max: 60, step: 1 },
  { key: 'disputeRate', label: 'Disputes / 100 people / yr', min: 0, max: 200, step: 1 },
  { key: 'policeEffectiveness', label: 'Police effectiveness ×', min: 0, max: 2, step: 0.05 },
  { key: 'roadAccidentPer1000Km', label: 'Road accidents / 1,000 km', min: 0, max: 0.05, step: 0.0005 },
  { key: 'carOwnership', label: 'Car ownership', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'trainMach', label: 'Hyperline cruise (Mach)', min: 1, max: 12, step: 0.5 },
  { key: 'funeralPremium', label: 'Funeral premium (R/mo)', min: 0, max: 1000, step: 10, section: 'Economy & insurance' },
  { key: 'funeralBenefit', label: 'Funeral benefit (R)', min: 0, max: 100000, step: 1000 },
  { key: 'lifeCoverSum', label: 'Life cover sum (R)', min: 0, max: 2000000, step: 10000 },
  { key: 'lifeCoverPremium', label: 'Life premium (R/mo/adult)', min: 0, max: 2000, step: 10 },
  { key: 'funeralCoverShare', label: 'Households with funeral cover', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'lifeCoverShare', label: 'Households with life cover', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'medicalAidShare', label: 'Households with medical aid', min: 0, max: 1, step: 0.01, pct: true },
  { key: 'schemeReserve', label: 'Scheme opening reserve (R)', min: 0, max: 5000000, step: 10000 },
  { key: 'childGrant', label: 'Child grant (R/mo)', min: 0, max: 3000, step: 10 },
  { key: 'oldAgeGrant', label: 'Old-age grant (R/mo)', min: 0, max: 6000, step: 10 },
  { key: 'povertyLine', label: 'Poverty line (R/person/mo)', min: 0, max: 6000, step: 10 },
  { key: 'retirementAge', label: 'Retirement age', min: 55, max: 75, step: 1 },
];

export function ScenarioForm() {
  const st = useStore();
  const [draft, setDraft] = useState<ScenarioParams>({ ...st.params });
  const set = <K extends keyof ScenarioParams>(k: K, v: ScenarioParams[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(st.params);
  let lastSection = '';
  return (
    <div className="form">
      <label>Seed</label>
      <input type="text" value={draft.seed} onChange={(e) => set('seed', e.target.value)} />
      <label>Start date</label>
      <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />
      <label>Place name</label>
      <input type="text" value={draft.placeName} onChange={(e) => set('placeName', e.target.value)} />
      <label>Age profile</label>
      <select value={draft.ageProfile} onChange={(e) => set('ageProfile', e.target.value as ScenarioParams['ageProfile'])}>
        <option value="young">young (many children)</option>
        <option value="balanced">balanced</option>
        <option value="ageing">ageing</option>
      </select>
      <label>Health profile</label>
      <select value={draft.healthProfile} onChange={(e) => set('healthProfile', e.target.value as ScenarioParams['healthProfile'])}>
        <option value="sa-rural">South Africa, rural</option>
        <option value="sa-urban">South Africa, urban</option>
        <option value="developed">developed country</option>
      </select>
      <label>Mortality basis</label>
      <select value={draft.mortalityPreset} onChange={(e) => set('mortalityPreset', e.target.value)}>
        {MORTALITY_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <label>HIV dynamics</label>
      <select value={draft.hivEnabled ? 'on' : 'off'} onChange={(e) => set('hivEnabled', e.target.value === 'on')}>
        <option value="on">on</option>
        <option value="off">off</option>
      </select>
      <label>Fertility shape</label>
      <select value={draft.fertilityShape} onChange={(e) => set('fertilityShape', e.target.value as ScenarioParams['fertilityShape'])}>
        <option value="sa">South African (early plateau)</option>
        <option value="late">late (developed)</option>
      </select>
      <label>Climate</label>
      <select value={draft.climate} onChange={(e) => set('climate', e.target.value as ScenarioParams['climate'])}>
        {CLIMATES.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <div className="section-title">Adult education mix at start</div>
      {(Object.keys(draft.educationMix) as Array<keyof ScenarioParams['educationMix']>).map((k) => (
        <div className="slider" key={k}>
          <label>{k}</label>
          <span className="v">{Math.round(draft.educationMix[k] * 100)}%</span>
          <input type="range" min={0} max={1} step={0.01} value={draft.educationMix[k]} onChange={(e) => set('educationMix', { ...draft.educationMix, [k]: Number(e.target.value) })} style={{ gridColumn: '1 / -1' }} />
        </div>
      ))}
      {NUMERIC.map((n) => {
        const sec = n.section && n.section !== lastSection ? n.section : null;
        if (n.section) lastSection = n.section;
        const v = draft[n.key] as number;
        return (
          <div key={n.key} style={{ display: 'contents' }}>
            {sec && <div className="section-title">{sec}</div>}
            <div className="slider">
              <label>{n.label}</label>
              <span className="v">{n.pct ? `${(v * 100).toFixed(n.step < 0.01 ? 1 : 0)}%` : v >= 1000 ? v.toLocaleString() : v}</span>
              <input type="range" min={n.min} max={n.max} step={n.step} value={v} onChange={(e) => set(n.key, Number(e.target.value) as ScenarioParams[typeof n.key])} style={{ gridColumn: '1 / -1' }} />
            </div>
          </div>
        );
      })}
      <div className="form-actions full">
        <button className="primary" disabled={!dirty} onClick={() => store.rebuild(draft)}>
          Rebuild province
        </button>
        <button className="ghost" onClick={() => setDraft({ ...DEFAULT_PARAMS })}>defaults</button>
        <button className="ghost" onClick={() => store.openDrawer('montecarlo')}>Monte Carlo…</button>
      </div>
      <div className="muted small full">Changing the basis rebuilds the province from day 0 with the same seed so runs are comparable. The household count and baseline mix are Ebenezer's; the other settlements take their tier's profile. Basis hash: {st.sim.world.basisHash}.</div>
    </div>
  );
}
