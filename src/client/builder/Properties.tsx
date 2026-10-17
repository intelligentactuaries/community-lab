// The builder's right-hand panel: what is selected and how to change it, the
// checks (each one flies to its place), and the world's own settings.

import { useState } from 'react';
import type { Facing } from '../../sim/layout/builders';
import { ASSET, tierWealth } from '../../sim/plan/assets';
import { removeCity, removeSettlement, setOption, setTrack, snapToRoad, turnBuilding, updateBuilding, updateCity, updateRoad, updateSettlement, updateWorld, resizeBuilding } from '../../sim/plan/edit';
import type { PlanBuilding, PlanCity, PlanSettlement, WorldPlan } from '../../sim/plan/types';
import type { Issue } from '../../sim/plan/validate';
import { JOBS } from '../../sim/population';
import type { Tier } from '../../sim/types';
import { Alert, CheckCircle, Copy, Info, Rotate, Trash } from '../components/Icons';
import { store } from '../lib/simStore';
import type { CommunityProfile } from '../../sim/params';
import { builder, useBuilder } from './builderStore';
import { deleteSelection, duplicateSelection } from './BuilderCanvas';
import { iconFor } from './icons';
import { TIER_LABEL, TIER_TINT } from './render';

const TIERS: Tier[] = ['ultra', 'affluent', 'comfortable', 'middle', 'working', 'low-income', 'civic'];
const TIER_HELP: Record<Tier, string> = {
  ultra: 'The estates: executives and professionals, two cars, full cover, years of savings.',
  affluent: 'Professional households: most adults tertiary-educated, a car each, medical aid.',
  comfortable: 'Comfortable suburbia: matric and diplomas, most households with a car.',
  middle: 'The middle-class baseline: mixed schooling, three in five with a car.',
  working: 'Working-class: piece work and the taxi rank, few cars, thin savings.',
  'low-income': 'Low-income: high unemployment, almost no cars, burial cover before anything else.',
  civic: 'A civic zone: institutions, no households.',
};

export function Properties() {
  const b = useBuilder();
  const tab = b.propsTab;
  const setTab = (t: typeof tab) => ((builder.propsTab = t), builder.bump());
  const errors = b.issues.filter((i) => i.level === 'error').length;
  const warnings = b.issues.filter((i) => i.level === 'warning').length;
  if (!b.plan) return <aside className="inspector" />;
  return (
    <aside className="inspector b-props">
      <div className="b-tabs">
        <button className={tab === 'inspect' ? 'on' : ''} onClick={() => setTab('inspect')}>Inspect</button>
        <button className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>
          Checks {errors ? <span className="b-count err">{errors}</span> : warnings ? <span className="b-count warn">{warnings}</span> : <span className="b-count ok">✓</span>}
        </button>
        <button className={tab === 'world' ? 'on' : ''} onClick={() => setTab('world')}>World</button>
      </div>
      <div className="scroll b-props-body">
        {tab === 'inspect' && <Inspect plan={b.plan} />}
        {tab === 'checks' && <Checks issues={b.issues} />}
        {tab === 'world' && <WorldPanel plan={b.plan} />}
      </div>
    </aside>
  );
}

// ─── Inspect ────────────────────────────────────────────────────────────────

function Inspect({ plan }: { plan: WorldPlan }) {
  const sel = builder.selection;
  if (!sel.length) {
    return (
      <div className="card">
        <h3>Nothing selected</h3>
        <p className="muted small">Pick something from the library and click on the map to place it, or click a building, a road, a settlement or a city to change it.</p>
        <Shortcuts />
      </div>
    );
  }
  const buildings = sel.filter((s) => s.kind === 'building').map((s) => plan.buildings.find((x) => x.id === (s as { id: string }).id)).filter(Boolean) as PlanBuilding[];
  if (buildings.length > 1) return <ManyBuildings list={buildings} />;
  if (buildings.length === 1) return <BuildingCard pb={buildings[0]} plan={plan} />;
  const s = sel[0];
  if (s.kind === 'road') return <RoadCard plan={plan} index={s.index} />;
  if (s.kind === 'settlement') {
    const st = plan.settlements.find((x) => x.id === s.id);
    return st ? <SettlementCard plan={plan} s={st} /> : null;
  }
  if (s.kind === 'city') {
    const c = plan.cities.find((x) => x.id === s.id);
    return c ? <CityCard plan={plan} c={c} /> : null;
  }
  if (s.kind === 'track') return <TrackCard plan={plan} index={s.index} />;
  return null;
}

function Num({ value, onChange, min, max, step = 1, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      value={draft ?? String(Math.round(value * 100) / 100)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const v = Number(draft);
          if (Number.isFinite(v)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
          setDraft(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() && draft !== value) onChange(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

const R = (n: number) => `R${Math.round(n).toLocaleString('en-ZA')}`;

function BuildingCard({ pb, plan }: { pb: PlanBuilding; plan: WorldPlan }) {
  const a = ASSET[pb.asset];
  const Icon = iconFor(a?.icon ?? 'square');
  const settlement = plan.settlements.find((s) => s.id === pb.settlement);
  const tier = settlement?.tier ?? 'middle';
  const books = a?.business?.(tier === 'civic' ? 'middle' : tier, pb) ?? null;
  const issues = builder.issues.filter((i) => i.ids?.includes(pb.id));
  const commit = (next: WorldPlan) => builder.commit(next);
  const facings = a?.facings ?? (['N', 'E', 'S', 'W'] as Facing[]);
  const fixed = !a || a.fixedSize;
  const snapped = snapToRoad(plan, pb, 60);
  return (
    <>
      <div className="card">
        <h3>
          <span className="b-glyph big"><Icon size={20} /></span>
          <span className="grow">{pb.name}</span>
          <span className="tag">{a?.label ?? pb.asset}</span>
        </h3>
        {a && <p className="muted small b-blurb-full">{a.blurb}</p>}
        <div className="form b-form">
          <label>Name</label>
          <Text value={pb.name} onChange={(v) => commit(updateBuilding(plan, pb.id, { name: v, options: { ...pb.options, ownerNamed: false } }))} />
          <label>Settlement</label>
          <select value={pb.settlement} onChange={(e) => commit(updateBuilding(plan, pb.id, { settlement: e.target.value }))}>
            {plan.settlements.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <label>Door faces</label>
          <div className="seg mini">
            {(['N', 'E', 'S', 'W'] as Facing[]).map((f) => (
              <button key={f} disabled={!facings.includes(f)} className={pb.facing === f ? 'on' : ''} onClick={() => commit(turnBuilding(plan, pb.id, f))} title={{ N: 'North', E: 'East', S: 'South', W: 'West' }[f]}>
                {f}
              </button>
            ))}
          </div>
          <label>Position (m)</label>
          <div className="row b-pair">
            <Num value={pb.x} onChange={(v) => commit(updateBuilding(plan, pb.id, { x: Math.round(v) }))} />
            <Num value={pb.y} onChange={(v) => commit(updateBuilding(plan, pb.id, { y: Math.round(v) }))} />
          </div>
          <label>Size (m)</label>
          <div className="row b-pair">
            <Num value={pb.w} disabled={fixed} min={a?.min.w} max={a?.max.w} onChange={(v) => commit(resizeBuilding(plan, pb.id, { x: pb.x, y: pb.y, w: v, h: pb.h }))} />
            <Num value={pb.h} disabled={fixed} min={a?.min.h} max={a?.max.h} onChange={(v) => commit(resizeBuilding(plan, pb.id, { x: pb.x, y: pb.y, w: pb.w, h: v }))} />
          </div>
          {pb.plot != null && (
            <>
              <label>Plot</label>
              <span className="mono">{pb.plot}</span>
            </>
          )}
          {a?.options?.map((o) => (
            <OptionRow key={o.key} o={o} value={pb.options?.[o.key] ?? o.default} onChange={(v) => commit(setOption(plan, pb.id, o.key, v))} />
          ))}
        </div>
        {pb.raw && <p className="muted small">Drawn by hand in Unity Province. Moving it keeps the interior; turning or resizing it lays the rooms out afresh from its asset.</p>}
        <div className="row wrap b-actions">
          <button className="ghost" onClick={() => commit(turnBuilding(plan, pb.id))} title="Turn the door to the next side (F)"><Rotate size={13} /> Turn</button>
          {snapped && (Math.round(snapped.x) !== pb.x || Math.round(snapped.y) !== pb.y || snapped.facing !== pb.facing) && (
            <button className="ghost" onClick={() => commit(updateBuilding(turnBuilding(plan, pb.id, snapped.facing), pb.id, { x: Math.round(snapped.x), y: Math.round(snapped.y) }))} title="Door to the nearest road, set back as the province sets its buildings">To the road</button>
          )}
          <button className="ghost" onClick={duplicateSelection} title="Duplicate (Ctrl+D)"><Copy size={13} /> Duplicate</button>
          <button className="ghost danger" onClick={deleteSelection} title="Delete (Del)"><Trash size={13} /> Delete</button>
        </div>
      </div>
      {a && (a.staff?.length || books || a.public || a.roles?.length) && (
        <div className="card">
          <div className="panel-label">In the simulation</div>
          <div className="kv">
            {a.roles?.length ? (
              <>
                <span className="k">Serves as</span>
                <span className="v">{a.roles.join(', ')} for {a.scope === 'settlement' ? 'its settlement' : a.scope === 'city' ? 'its city' : 'the whole world'}</span>
              </>
            ) : null}
            {a.staff?.length ? (
              <>
                <span className="k">Posts filled first</span>
                <span className="v">{a.staff.map((s) => `${JOBS[s.job]?.label ?? s.job}${s.n > 1 ? ` × ${s.n}` : ''}`).join(', ')}</span>
                <span className="k">Hired from</span>
                <span className="v">{[...new Set(a.staff.map((s) => (s.from === 'settlement' ? 'the settlement' : s.from === 'city' ? 'the city' : 'anywhere')))].join(', ')}</span>
              </>
            ) : null}
            {a.public && (
              <>
                <span className="k">Paid by</span>
                <span className="v">the state (public payroll)</span>
              </>
            )}
            {books && (
              <>
                <span className="k">Keeps books</span>
                <span className="v">{books.kind === 'church' ? 'a PBO (tithes, no VAT)' : `${books.regime === 'cit' ? 'company tax' : books.regime === 'sbc' ? 'small business corporation' : books.regime === 'turnover' ? 'turnover tax' : books.regime}${books.vatRegistered ? ', VAT vendor' : ', not a VAT vendor'}`}</span>
                <span className="k">Opens with</span>
                <span className="v">{Object.entries(books.opening).map(([k, v]) => `${R(v)} ${k === '1020' ? 'cash' : k === '1200' ? 'stock' : 'property'}`).join(' · ') || 'nothing'}</span>
              </>
            )}
            {settlement && (
              <>
                <span className="k">Wealth here</span>
                <span className="v">{TIER_LABEL[settlement.tier]}{settlement.tier !== 'civic' ? ` (${Math.round(tierWealth(settlement.tier) * 100)} / 100)` : ''}</span>
              </>
            )}
          </div>
        </div>
      )}
      {issues.length > 0 && (
        <div className="card">
          <div className="panel-label">Checks</div>
          {issues.map((i, k) => (
            <IssueRow key={k} i={i} />
          ))}
        </div>
      )}
    </>
  );
}

function OptionRow({ o, value, onChange }: { o: NonNullable<(typeof ASSET)[string]['options']>[number]; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  return (
    <>
      <label>{o.label}</label>
      {o.kind === 'select' ? (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {o.choices?.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : o.kind === 'toggle' ? (
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <Num value={Number(value)} min={o.min} max={o.max} step={o.step} onChange={(v) => onChange(v)} />
      )}
    </>
  );
}

function ManyBuildings({ list }: { list: PlanBuilding[] }) {
  const by: Record<string, number> = {};
  for (const b of list) by[ASSET[b.asset]?.label ?? b.asset] = (by[ASSET[b.asset]?.label ?? b.asset] ?? 0) + 1;
  const plan = builder.plan!;
  return (
    <div className="card">
      <h3>{list.length} buildings</h3>
      <div className="tags">
        {Object.entries(by).map(([k, n]) => (
          <span key={k} className="tag">{n} × {k}</span>
        ))}
      </div>
      <div className="form b-form">
        <label>Move all to</label>
        <select value="" onChange={(e) => {
          let next = plan;
          for (const b of list) next = updateBuilding(next, b.id, { settlement: e.target.value });
          builder.commit(next);
        }}>
          <option value="" disabled>a settlement…</option>
          {plan.settlements.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="row wrap b-actions">
        <button className="ghost" onClick={() => {
          let next = plan;
          for (const b of list) next = turnBuilding(next, b.id);
          builder.commit(next);
        }}><Rotate size={13} /> Turn each</button>
        <button className="ghost" onClick={duplicateSelection}><Copy size={13} /> Duplicate</button>
        <button className="ghost danger" onClick={deleteSelection}><Trash size={13} /> Delete</button>
      </div>
    </div>
  );
}

function RoadCard({ plan, index }: { plan: WorldPlan; index: number }) {
  const r = plan.roads[index];
  if (!r) return null;
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
  const commit = (patch: Partial<typeof r>) => builder.commit(updateRoad(plan, index, patch));
  const horizontal = r.y1 === r.y2;
  return (
    <div className="card">
      <h3>{r.name}</h3>
      <p className="muted small">{Math.round(len)} m, running {horizontal ? 'east–west' : 'north–south'}. Every door within 30 m of a road is reached by it; roads that cross or touch are joined.</p>
      <div className="form b-form">
        <label>Name</label>
        <Text value={r.name} onChange={(v) => commit({ name: v })} />
        <label>Width</label>
        <div className="seg mini">
          {[7, 9, 11].map((w) => (
            <button key={w} className={(r.width ?? 7) === w ? 'on' : ''} onClick={() => commit({ width: w === 7 ? undefined : w })}>{w === 7 ? 'Street' : w === 9 ? 'Avenue' : 'Highway'}</button>
          ))}
        </div>
        <label>From (m)</label>
        <div className="row b-pair">
          <Num value={r.x1} onChange={(v) => commit(horizontal ? { x1: v } : { x1: v, x2: v })} />
          <Num value={r.y1} onChange={(v) => commit(horizontal ? { y1: v, y2: v } : { y1: v })} />
        </div>
        <label>To (m)</label>
        <div className="row b-pair">
          <Num value={r.x2} onChange={(v) => commit(horizontal ? { x2: v } : { x1: v, x2: v })} />
          <Num value={r.y2} onChange={(v) => commit(horizontal ? { y1: v, y2: v } : { y2: v })} />
        </div>
      </div>
      <div className="row wrap b-actions">
        <button className="ghost danger" onClick={deleteSelection}><Trash size={13} /> Delete</button>
      </div>
    </div>
  );
}

function SettlementCard({ plan, s }: { plan: WorldPlan; s: PlanSettlement }) {
  const houses = plan.buildings.filter((b) => b.settlement === s.id && ASSET[b.asset]?.kind === 'house').length;
  const others = plan.buildings.filter((b) => b.settlement === s.id && ASSET[b.asset]?.kind !== 'house').length;
  const auto = Math.max(houses ? 1 : 0, Math.round(houses * 0.8));
  const hh = s.households ?? auto;
  const commit = (patch: Partial<PlanSettlement>) => builder.commit(updateSettlement(plan, s.id, patch));
  return (
    <div className="card">
      <h3>
        <span className="b-swatch" style={{ background: TIER_TINT[s.tier] }} />
        <span className="grow">{s.name}</span>
        <span className="tag">{TIER_LABEL[s.tier]}</span>
      </h3>
      <p className="muted small">{houses} house{houses === 1 ? '' : 's'} and {others} other building{others === 1 ? '' : 's'} in a {Math.round(s.w)} × {Math.round(s.h)} m zone. Households are drawn from its wealth profile (the scenario's tiers in Settings).</p>
      <div className="form b-form">
        <label>Name</label>
        <Text value={s.name} onChange={(v) => commit({ name: v, short: v.split(' ')[0] })} />
        <label>Short name</label>
        <Text value={s.short} onChange={(v) => commit({ short: v })} />
        <label>City</label>
        <select value={s.city} onChange={(e) => commit({ city: e.target.value })}>
          {plan.cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label>Wealth</label>
        <select value={s.tier} onChange={(e) => commit({ tier: e.target.value as Tier })}>
          {TIERS.map((t) => (
            <option key={t} value={t}>{TIER_LABEL[t]}</option>
          ))}
        </select>
        <span className="full muted small">{TIER_HELP[s.tier]}</span>
        {s.tier !== 'civic' && (
          <>
            <label>Households at the start</label>
            <span className="mono">{Math.min(hh, houses)} of {houses}</span>
            <input className="full" type="range" min={0} max={Math.max(1, houses)} step={1} value={Math.min(hh, houses)} onChange={(e) => commit({ households: Number(e.target.value) })} />
            <span className="full muted small">{s.households == null ? 'Four houses in five are seated; the rest wait for newcomers.' : <a href="#" onClick={(e) => (e.preventDefault(), commit({ households: null }))}>Back to four in five</a>}</span>
          </>
        )}
        <label>Zone (m)</label>
        <div className="row b-pair">
          <Num value={s.x} onChange={(v) => commit({ x: v })} />
          <Num value={s.y} onChange={(v) => commit({ y: v })} />
        </div>
        <label />
        <div className="row b-pair">
          <Num value={s.w} min={40} onChange={(v) => commit({ w: v })} />
          <Num value={s.h} min={40} onChange={(v) => commit({ h: v })} />
        </div>
      </div>
      <div className="row wrap b-actions">
        <button className="ghost" onClick={() => builder.focus(s.x, s.y, s.w, s.h)}>Fly to it</button>
        <button className="ghost danger" disabled={plan.settlements.length <= 1} onClick={() => builder.commit(removeSettlement(plan, s.id), { select: [] })}><Trash size={13} /> Delete zone</button>
      </div>
      {s.tier !== 'civic' && <PeopleHere plan={plan} s={s} />}
    </div>
  );
}

const EDU_TIERS: Array<Exclude<Tier, 'civic'>> = ['ultra', 'affluent', 'comfortable', 'middle', 'working', 'low-income'];

/**
 * The settlement's people: its tier's profile (the scenario's), and where this
 * settlement departs from it. A slider moved is an override; "as the tier" takes
 * it back.
 */
function PeopleHere({ plan, s }: { plan: WorldPlan; s: PlanSettlement }) {
  const tier = s.tier as Exclude<Tier, 'civic'>;
  const base = store.params.tiers[tier];
  const own = s.profile ?? {};
  const set = (patch: Partial<CommunityProfile>) => builder.commit(updateSettlement(plan, s.id, { profile: { ...own, ...patch } }));
  const clear = (k: keyof CommunityProfile) => {
    const next = { ...own };
    delete next[k];
    builder.commit(updateSettlement(plan, s.id, { profile: Object.keys(next).length ? next : undefined }));
  };
  const share = (k: 'unemployment' | 'carOwnership' | 'medicalAidShare' | 'funeralCoverShare' | 'lifeCoverShare', label: string, max = 1) => {
    const v = (own[k] ?? base[k]) as number;
    const changed = own[k] !== undefined;
    return (
      <>
        <label>{label}</label>
        <span className="mono">{Math.round(v * 100)}%{changed ? <a href="#" className="b-reset" title={`Back to the tier's ${Math.round((base[k] as number) * 100)}%`} onClick={(e) => (e.preventDefault(), clear(k))}> ↺</a> : <span className="muted small"> tier</span>}</span>
        <input className="full" type="range" min={0} max={max} step={0.01} value={v} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<CommunityProfile>)} />
      </>
    );
  };
  const eduLike = own.educationMix ? EDU_TIERS.find((t) => JSON.stringify(store.params.tiers[t].educationMix) === JSON.stringify(own.educationMix)) ?? 'custom' : '';
  const savings = own.savingsMonths ?? base.savingsMonths;
  const tertiary = (m: CommunityProfile['educationMix']) => Math.round((m.tertiary + m.postgrad) * 100);
  return (
    <div className="b-people">
      <div className="panel-label">People here</div>
      <p className="muted small">Drawn from the {TIER_LABEL[s.tier]} profile in the scenario (Settings › Scenario). Move a slider to set this settlement apart; ↺ takes it back.</p>
      <div className="form b-form">
        <label>Schooling like</label>
        <select value={eduLike} onChange={(e) => (e.target.value ? set({ educationMix: { ...store.params.tiers[e.target.value as Exclude<Tier, 'civic'>].educationMix } }) : clear('educationMix'))}>
          <option value="">its tier ({tertiary(base.educationMix)}% tertiary)</option>
          {EDU_TIERS.map((t) => (
            <option key={t} value={t}>{TIER_LABEL[t]} ({tertiary(store.params.tiers[t].educationMix)}% tertiary)</option>
          ))}
          {eduLike === 'custom' && <option value="custom" disabled>its own</option>}
        </select>
        {share('unemployment', 'Without work', 0.8)}
        {share('carOwnership', 'Households with a car')}
        {share('medicalAidShare', 'Medical aid')}
        {share('funeralCoverShare', 'Funeral cover')}
        {share('lifeCoverShare', 'Life cover')}
        <label>Savings (months)</label>
        <div className="row b-pair">
          <Num value={savings[0]} min={0} max={120} step={0.5} onChange={(v) => set({ savingsMonths: [v, Math.max(v, savings[1])] })} />
          <Num value={savings[1]} min={0} max={240} step={0.5} onChange={(v) => set({ savingsMonths: [Math.min(savings[0], v), v] })} />
        </div>
      </div>
    </div>
  );
}

function CityCard({ plan, c }: { plan: WorldPlan; c: PlanCity }) {
  const settlements = plan.settlements.filter((s) => s.city === c.id);
  const commit = (patch: Partial<PlanCity>) => builder.commit(updateCity(plan, c.id, patch));
  return (
    <div className="card">
      <h3>
        <span className="grow">{c.name}</span>
        <span className="tag">{c.kind === 'city' ? 'city' : c.kind === 'centre' ? 'shared centre' : 'airport'}</span>
      </h3>
      <p className="muted small">{settlements.length ? `Settlements: ${settlements.map((s) => s.name).join(', ')}.` : 'No settlements yet: draw one inside it.'} A city shares its school, clinic, police, court and cemetery, and elects a council of six with its medical officer.</p>
      <div className="form b-form">
        <label>Name</label>
        <Text value={c.name} onChange={(v) => commit({ name: v, short: v.split(' ')[0] })} />
        <label>Short name</label>
        <Text value={c.short} onChange={(v) => commit({ short: v })} />
        <label>Kind</label>
        <select value={c.kind} onChange={(e) => commit({ kind: e.target.value as PlanCity['kind'] })}>
          <option value="city">A city of settlements</option>
          <option value="centre">A shared centre (no council)</option>
          <option value="airport">The airport</option>
        </select>
        <label>Tagline</label>
        <Text value={c.tagline ?? ''} placeholder="the town by the river" onChange={(v) => commit({ tagline: v })} />
        <label>Churchgoing</label>
        <select value={c.faith == null ? 'scenario' : String(c.faith)} onChange={(e) => commit({ faith: e.target.value === 'scenario' ? null : Number(e.target.value) })}>
          <option value="scenario">as the scenario says</option>
          <option value="0.06">secular (6%)</option>
          <option value="0.4">lukewarm (40%)</option>
          <option value="0.75">churchgoing (75%)</option>
          <option value="0.95">devout (95%)</option>
        </select>
        <label>Bounds (m)</label>
        <div className="row b-pair">
          <Num value={c.x} onChange={(v) => commit({ x: v })} />
          <Num value={c.y} onChange={(v) => commit({ y: v })} />
        </div>
        <label />
        <div className="row b-pair">
          <Num value={c.w} min={40} onChange={(v) => commit({ w: v })} />
          <Num value={c.h} min={40} onChange={(v) => commit({ h: v })} />
        </div>
      </div>
      <div className="row wrap b-actions">
        <button className="ghost" onClick={() => builder.focus(c.x, c.y, c.w, c.h)}>Fly to it</button>
        <button className="ghost danger" disabled={plan.cities.length <= 1} onClick={() => builder.commit(removeCity(plan, c.id), { select: [] })}><Trash size={13} /> Delete city</button>
      </div>
    </div>
  );
}

function TrackCard({ plan, index }: { plan: WorldPlan; index: number }) {
  const pts = plan.track ?? [];
  const p = pts[index];
  if (!p) return null;
  const stations = plan.buildings.filter((b) => b.asset === 'station').length;
  return (
    <div className="card">
      <h3>Hyperline guideway</h3>
      <p className="muted small">Bend {index + 1} of {pts.length}. {stations} station{stations === 1 ? '' : 's'} placed; trains run with two or more beside the guideway, at the scenario's cruising Mach.</p>
      <div className="form b-form">
        <label>Bend at (m)</label>
        <div className="row b-pair">
          <Num value={p.x} onChange={(v) => builder.commit(setTrack(plan, pts.map((q, i) => (i === index ? { x: v, y: q.y } : q))))} />
          <Num value={p.y} onChange={(v) => builder.commit(setTrack(plan, pts.map((q, i) => (i === index ? { x: q.x, y: v } : q))))} />
        </div>
      </div>
      <div className="row wrap b-actions">
        <button className="ghost" onClick={() => builder.setTool('track')}>Extend it</button>
        <button className="ghost danger" onClick={deleteSelection}><Trash size={13} /> Remove the bend</button>
        <button className="ghost danger" onClick={() => builder.commit(setTrack(plan, []), { select: [] })}>Remove the guideway</button>
      </div>
    </div>
  );
}

// ─── Checks ─────────────────────────────────────────────────────────────────

function IssueRow({ i }: { i: Issue }) {
  const Icon = i.level === 'error' ? Alert : i.level === 'warning' ? Alert : Info;
  const go = () => {
    const plan = builder.plan;
    if (!plan) return;
    const ids = i.ids ?? [];
    const bs = plan.buildings.filter((b) => ids.includes(b.id));
    if (bs.length) {
      const x0 = Math.min(...bs.map((b) => b.x));
      const y0 = Math.min(...bs.map((b) => b.y));
      const x1 = Math.max(...bs.map((b) => b.x + b.w));
      const y1 = Math.max(...bs.map((b) => b.y + b.h));
      builder.select(bs.map((b) => ({ kind: 'building', id: b.id })));
      builder.focus(x0, y0, x1 - x0, y1 - y0);
      return;
    }
    const s = plan.settlements.find((x) => ids.includes(x.id));
    if (s) {
      builder.select([{ kind: 'settlement', id: s.id }]);
      builder.focus(s.x, s.y, s.w, s.h);
      return;
    }
    const c = plan.cities.find((x) => ids.includes(x.id));
    if (c) {
      builder.select([{ kind: 'city', id: c.id }]);
      builder.focus(c.x, c.y, c.w, c.h);
      return;
    }
    if (i.at) builder.focus(i.at.x - 40, i.at.y - 40, 80, 80);
  };
  const clickable = !!(i.ids?.length || i.at);
  return (
    <div className={`b-issue ${i.level} ${clickable ? 'go' : ''}`} onClick={clickable ? go : undefined}>
      <span className="b-issue-icon"><Icon size={14} /></span>
      <span>{i.text}</span>
    </div>
  );
}

function Checks({ issues }: { issues: Issue[] }) {
  const groups: Array<[Issue['level'], string]> = [
    ['error', 'Stops the world from running'],
    ['warning', 'Will run, but'],
    ['note', 'Good to know'],
  ];
  if (!issues.length)
    return (
      <div className="card">
        <h3><CheckCircle size={18} /> All clear</h3>
        <p className="muted small">Homes, a shop, roads to every door, nothing overlapping. Run it when you are ready.</p>
      </div>
    );
  return (
    <>
      {groups.map(([level, title]) => {
        const list = issues.filter((i) => i.level === level);
        if (!list.length) return null;
        return (
          <div key={level} className="card">
            <div className="panel-label">{title} · {list.length}</div>
            {list.slice(0, 80).map((i, k) => (
              <IssueRow key={k} i={i} />
            ))}
            {list.length > 80 && <span className="muted small">and {list.length - 80} more</span>}
          </div>
        );
      })}
    </>
  );
}

// ─── The world ──────────────────────────────────────────────────────────────

function WorldPanel({ plan }: { plan: WorldPlan }) {
  const st = builder.stats;
  const commit = (patch: Parameters<typeof updateWorld>[1]) => builder.commit(updateWorld(plan, patch));
  const posts = st ? Object.entries(st.posts).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <div className="card">
        <h3>{plan.name}</h3>
        <div className="form b-form">
          <label>Name</label>
          <Text value={plan.name} onChange={(v) => commit({ name: v })} />
          <label>Region</label>
          <Text value={plan.region} onChange={(v) => commit({ region: v })} />
          <span className="full muted small">The region names the Mutual Bank ({plan.region} Mutual Bank) and the burial society.</span>
          <label>Description</label>
          <Text value={plan.description ?? ''} placeholder="One line about it" onChange={(v) => commit({ description: v })} />
          <label>Map size (m)</label>
          <div className="row b-pair">
            <Num value={plan.size.w} min={400} max={12000} step={100} onChange={(v) => commit({ size: { w: v, h: plan.size.h } })} />
            <Num value={plan.size.h} min={400} max={12000} step={100} onChange={(v) => commit({ size: { w: plan.size.w, h: v } })} />
          </div>
          <label>Baseline settlement</label>
          <select value={plan.baseline ?? ''} onChange={(e) => commit({ baseline: e.target.value || null })}>
            <option value="">none (every settlement by its tier)</option>
            {plan.settlements.filter((s) => s.tier !== 'civic').map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="full muted small">The baseline settlement seats the scenario's household count with its education mix and cover shares (as Ebenezer does in the province).</span>
        </div>
      </div>
      {st && (
        <div className="card">
          <div className="panel-label">At the start</div>
          <div className="kv">
            <span className="k">Buildings</span>
            <span className="v">{st.buildings} ({st.houses} houses: {st.plotsByTier.small} small, {st.plotsByTier.standard} standard, {st.plotsByTier.large} large)</span>
            <span className="k">Households</span>
            <span className="v">{st.households}</span>
            <span className="k">People (about)</span>
            <span className="v">{st.population}</span>
            <span className="k">Roads</span>
            <span className="v">{st.roadKm} km</span>
            <span className="k">Businesses</span>
            <span className="v">{st.businesses} keeping books (and the Mutual Bank, the burial society, the transport operators)</span>
          </div>
          {posts.length > 0 && (
            <>
              <div className="panel-label" style={{ marginTop: 6 }}>Posts filled first</div>
              <div className="tags">
                {posts.map(([job, n]) => (
                  <span key={job} className="tag">{JOBS[job as keyof typeof JOBS]?.label ?? job} × {n}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="card">
        <div className="panel-label">Cities and settlements</div>
        {plan.cities.map((c) => (
          <div key={c.id} className="b-place">
            <a href="#" onClick={(e) => (e.preventDefault(), builder.select([{ kind: 'city', id: c.id }]), builder.focus(c.x, c.y, c.w, c.h))}>{c.name}</a>
            {plan.settlements.filter((s) => s.city === c.id).map((s) => (
              <a key={s.id} href="#" className="b-place-s" onClick={(e) => (e.preventDefault(), builder.select([{ kind: 'settlement', id: s.id }]), builder.focus(s.x, s.y, s.w, s.h))}>
                <span className="b-swatch" style={{ background: TIER_TINT[s.tier] }} /> {s.name} <span className="muted small">{TIER_LABEL[s.tier]}</span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Shortcuts() {
  const rows: Array<[string, string]> = [
    ['V', 'select and move'],
    ['R / S', 'road / street of houses'],
    ['Z / C', 'settlement / city'],
    ['T', 'Hyperline guideway'],
    ['X', 'erase'],
    ['F', 'turn the door'],
    ['Del', 'delete'],
    ['Ctrl+D', 'duplicate'],
    ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ['Arrows', 'nudge (Shift: ×10)'],
    ['G', 'snap on or off'],
    ['0', 'fit the world'],
    ['Space + drag', 'pan'],
  ];
  return (
    <div className="b-keys">
      {rows.map(([k, v]) => (
        <div key={k}>
          <kbd>{k}</kbd>
          <span className="muted small">{v}</span>
        </div>
      ))}
    </div>
  );
}
