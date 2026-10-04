import { useEffect, useMemo, useState } from 'react';
import type { BatchSummary } from '../../sim/batch';
import { alivePeople } from '../../sim/ctx';
import { ASFR_SHAPE_SA, scaledAsfr } from '../../sim/fertility';
import { MORTALITY_PRESETS, lifeTable } from '../../sim/mortality';
import { shockLabel } from '../../sim/shocks';
import { JOBS, cityOfPerson, communityOfPerson } from '../../sim/population';
import { aeTable, realisedFertility } from '../../sim/stats';
import { MONTHS } from '../../sim/time';
import { EChart } from '../charts/EChart';
import { weatherOption } from '../charts/weather';
import { CardGrid, Mini, Tbl, Viz, barOption, lineOption, moneyAxis, useSeries } from '../charts/helpers';
import { miniColumns, miniRange, miniSplit, miniXY, quiet } from '../charts/mini';
import { baseOption, chartTheme } from '../charts/theme';
import { FinanceWorkspace } from './finance/FinanceWorkspace';
import { ActuarialWorkspace } from './actuarial/ActuarialWorkspace';
import { LabTab } from './lab/LabTab';
import { ExportsTab } from './lab/ExportsTab';
import { pyramid } from '../lib/analytics';
import { api } from '../lib/api';
import { store, useStore, type AnalyticsScope } from '../lib/simStore';
import { CITIES, CITY, COMMUNITIES, COMMUNITY, residentialOf } from '../../sim/world';
import type { CityId, CommunityId, Person, World } from '../../sim/types';
import { useTheme } from '../lib/theme';
import { Close, Expand } from './Icons';

// ─── Analysis scope: the province, one city, one settlement, one household or one person ───

function scopedPeople(w: World, s: AnalyticsScope): Person[] {
  const all = alivePeople(w);
  if (s.kind === 'city') return all.filter((p) => cityOfPerson(w, p) === s.id);
  if (s.kind === 'community') return all.filter((p) => communityOfPerson(w, p) === s.id);
  if (s.kind === 'household') return all.filter((p) => p.householdId === s.id);
  if (s.kind === 'person') return all.filter((p) => p.id === s.id);
  return all;
}

function scopeLabel(w: World, s: AnalyticsScope): string {
  if (s.kind === 'city') return CITY[s.id]?.name ?? s.id;
  if (s.kind === 'community') return COMMUNITY[s.id]?.name ?? s.id;
  if (s.kind === 'household') return `the ${w.households[s.id]?.name ?? '?'} household`;
  if (s.kind === 'person') {
    const p = w.people[s.id];
    return p ? `${p.firstName} ${p.surname}` : '?';
  }
  return 'the province';
}

function useScope(): { scope: AnalyticsScope; people: Person[]; label: string; narrowed: boolean } {
  const st = useStore();
  const w = st.sim.world;
  const scope = st.analyticsScope;
  return { scope, people: scopedPeople(w, scope), label: scopeLabel(w, scope), narrowed: scope.kind !== 'all' };
}

/** Banner on figures that only exist province-wide, so a narrowed scope never misleads. */
function ScopeNote({ what }: { what: string }) {
  const { narrowed, label } = useScope();
  if (!narrowed) return null;
  return (
    <div className="viz wide note">
      <div className="muted small">{what} is measured province-wide; the “{label}” scope narrows the composition cards, not these figures.</div>
    </div>
  );
}

function ScopePicker({ tab }: { tab: string }) {
  const st = useStore();
  const w = st.sim.world;
  if (['economy', 'finance', 'weather', 'montecarlo', 'basis', 'lab', 'exports'].includes(tab)) return null;
  const s = st.analyticsScope;
  const enc = s.kind === 'all' ? 'all' : s.kind === 'city' ? `t:${s.id}` : s.kind === 'community' ? `c:${s.id}` : s.kind === 'household' ? `h:${s.id}` : `p:${s.id}`;
  const hhs = Object.values(w.households).filter((h) => !h.dissolvedDay && h.memberIds.length).sort((a, b) => a.name.localeCompare(b.name));
  const ppl = alivePeople(w).sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName));
  const exists = enc === 'all' || s.kind === 'city' || (s.kind === 'community') || (s.kind === 'household' && !!w.households[s.id] && !w.households[s.id].dissolvedDay) || (s.kind === 'person' && !!w.people[s.id]?.alive);
  return (
    <select
      className="scope-pick"
      title="Analyse the whole province, one city, one settlement, one household or one person"
      value={exists ? enc : 'all'}
      onChange={(e) => {
        const v = e.target.value;
        store.setScope(
          v === 'all'
            ? { kind: 'all' }
            : v.startsWith('t:')
              ? { kind: 'city', id: v.slice(2) as CityId }
              : v.startsWith('c:')
                ? { kind: 'community', id: v.slice(2) as CommunityId }
                : v.startsWith('h:')
                  ? { kind: 'household', id: v.slice(2) }
                  : { kind: 'person', id: v.slice(2) },
        );
      }}
    >
      <option value="all">Whole province</option>
      <optgroup label="Cities">
        {CITIES.filter((c) => c.kind === 'city').map((c) => (
          <option key={c.id} value={`t:${c.id}`}>{c.name}</option>
        ))}
      </optgroup>
      <optgroup label="Settlements">
        {COMMUNITIES.filter((c) => c.tier !== 'civic').map((c) => (
          <option key={c.id} value={`c:${c.id}`}>{c.name} · {CITY[c.city].short}</option>
        ))}
      </optgroup>
      <optgroup label="Households">
        {hhs.map((h) => (
          <option key={h.id} value={`h:${h.id}`}>{h.name} · {COMMUNITY[w.buildings[h.houseId]?.community ?? 'ebenezer'].short}</option>
        ))}
      </optgroup>
      <optgroup label="People">
        {ppl.map((p) => (
          <option key={p.id} value={`p:${p.id}`}>{p.firstName} {p.surname} · {p.age}</option>
        ))}
      </optgroup>
    </select>
  );
}

const TABS: Array<{ id: string; label: string }> = [
  { id: 'population', label: 'Population' },
  { id: 'mortality', label: 'Mortality A/E' },
  { id: 'fertility', label: 'Fertility' },
  { id: 'health', label: 'Health' },
  { id: 'economy', label: 'Economy' },
  { id: 'finance', label: 'Economy, finance & tax' },
  { id: 'actuarial', label: 'Actuarial science' },
  { id: 'insurance', label: 'Scheme' },
  { id: 'social', label: 'Social & church' },
  { id: 'safety', label: 'Safety & court' },
  { id: 'education', label: 'Education' },
  { id: 'weather', label: 'Weather' },
  { id: 'montecarlo', label: 'Monte Carlo' },
  { id: 'lab', label: 'Policy & stress lab' },
  { id: 'basis', label: 'Basis' },
  { id: 'exports', label: 'Exports' },
];

/** How long the slide-down lasts; must match @keyframes drawerDown in styles.css. */
const CLOSE_MS = 220;

export function AnalyticsDrawer() {
  const st = useStore();
  useTheme();
  // The drawer slides up on open and down on close, so it has to stay mounted
  // (still showing its last tab) until the closing animation has finished.
  const [shown, setShown] = useState<string | null>(st.drawerTab);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (st.drawerTab) {
      setShown(st.drawerTab);
      setClosing(false);
      return;
    }
    if (shown === null) return;
    setClosing(true);
    const t = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [st.drawerTab, shown]);
  const tab = shown;
  if (!tab) return null;
  return (
    <div className={`drawer ${st.drawerFull ? 'full' : ''} ${closing ? 'closing' : ''}`} aria-hidden={closing}>
      <div className="drawer-head">
        <span className="panel-label">{TABS.find((t) => t.id === tab)?.label ?? tab}</span>
        <span className="muted small">tiles below switch tabs</span>
        <ScopePicker tab={tab} />
        <span className="grow" />
        <div className="tools">
          <button className={`icon ${st.drawerFull ? 'on' : ''}`} title={st.drawerFull ? 'Exit full screen' : 'Full screen — the cards grow to fill the screen'} onClick={() => store.setDrawerFull(!st.drawerFull)}>
            <Expand size={14} open={st.drawerFull} />
          </button>
          <button className="icon" title="Close (Esc)" onClick={() => store.openDrawer(null)}>
            <Close size={14} />
          </button>
        </div>
      </div>
      {tab === 'economy' || tab === 'finance' ? (
        <FinanceWorkspace />
      ) : tab === 'actuarial' ? (
        <ActuarialWorkspace />
      ) : (
        <CardGrid className="drawer-body scroll" full={st.drawerFull} deps={[tab, st.sim.world.day, st.analyticsScope]}>
          {tab === 'population' && <PopulationTab />}
          {tab === 'mortality' && <MortalityTab />}
          {tab === 'fertility' && <FertilityTab />}
          {tab === 'health' && <HealthTab />}
          {tab === 'insurance' && <InsuranceTab />}
          {tab === 'social' && <SocialTab />}
          {tab === 'safety' && <SafetyTab />}
          {tab === 'education' && <EducationTab />}
          {tab === 'weather' && <WeatherTab />}
          {tab === 'montecarlo' && <MonteCarloTab />}
          {tab === 'lab' && <LabTab />}
          {tab === 'basis' && <BasisTab />}
          {tab === 'exports' && <ExportsTab />}
        </CardGrid>
      )}
    </div>
  );
}

function PopulationTab() {
  const st = useStore();
  const series = useSeries();
  const th = chartTheme();
  const w = st.sim.world;
  const { scope, people, label, narrowed } = useScope();
  const py = useMemo(() => pyramid(w, people), [w, w.day, people]);
  const b = baseOption(th);
  const pyrOpt = {
    ...b,
    tooltip: { ...(b.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: Array<{ name: string; value: number; seriesName: string }>) => `${ps[0].name}<br/>${ps.map((p) => `${p.seriesName}: ${Math.abs(p.value)}`).join('<br/>')}` },
    grid: { left: 44, right: 14, top: 28, bottom: 24 },
    xAxis: { ...(b.xAxis as object), type: 'value', axisLabel: { color: th.muted, fontSize: 10, formatter: (v: number) => String(Math.abs(v)) } },
    yAxis: { ...(b.yAxis as object), type: 'category', data: py.bands, axisLabel: { color: th.muted, fontSize: 10 } },
    series: [
      { name: 'male', type: 'bar', stack: 'p', data: py.male.map((v) => -v), barMaxWidth: 14, itemStyle: { color: th.male, borderRadius: [3, 0, 0, 3] } },
      { name: 'female', type: 'bar', stack: 'p', data: py.female, barMaxWidth: 14, itemStyle: { color: th.female, borderRadius: [0, 3, 3, 0] } },
    ],
  };
  const x = series.map((s) => s.isoDate.slice(0, 7));
  return (
    <>
      <Viz title="Population pyramid" note={`${people.length} ${narrowed ? `in ${label}` : 'residents now'}`}>
        <EChart option={pyrOpt} />
      </Viz>
      <Viz title="Population, households" note={scope.kind === 'community' || scope.kind === 'city' ? `monthly · ${label}` : 'monthly'}>
        {scope.kind === 'community' || scope.kind === 'city' ? (
          <EChart option={lineOption(th, x, [
            { name: 'population', data: series.map((s) => (scope.kind === 'city' ? s.byCity : s.byCommunity)?.[scope.id]?.population ?? null) },
            { name: 'households', data: series.map((s) => (scope.kind === 'city' ? s.byCity : s.byCommunity)?.[scope.id]?.households ?? null) },
            { name: 'poor households', data: series.map((s) => (scope.kind === 'city' ? s.byCity : s.byCommunity)?.[scope.id]?.poor ?? null) },
          ])} />
        ) : (
          <EChart option={lineOption(th, x, [{ name: 'population', data: series.map((s) => s.population) }, { name: 'children (<15)', data: series.map((s) => s.children) }, { name: '65+', data: series.map((s) => s.elderly) }, { name: 'households', data: series.map((s) => s.households) }])} />
        )}
      </Viz>
      <Viz title={scope.kind === 'city' ? `${label}: settlements` : 'Cities: population'} note={scope.kind === 'city' ? residentialOf(scope.id).map((id) => COMMUNITY[id].name).join(' · ') : 'Emmaus · Newhaven · Ithemba'}>
        <EChart option={lineOption(th, x, scope.kind === 'city'
          ? residentialOf(scope.id).map((id) => ({ name: COMMUNITY[id].name, data: series.map((s) => s.byCommunity?.[id]?.population ?? null) }))
          : CITIES.filter((c) => c.kind === 'city').map((c) => ({ name: c.name, data: series.map((s) => s.byCity?.[c.id]?.population ?? null) })))} />
      </Viz>
      <Viz title={scope.kind === 'city' ? `${label}: household income` : 'Cities: household income'} note="mean monthly household income" info="Mean household income per city, or per settlement of the chosen city — from the estates of Hebron Heights to the townships of Ithemba.">
        <EChart option={lineOption(th, x, scope.kind === 'city'
          ? residentialOf(scope.id).map((id) => ({ name: COMMUNITY[id].name, data: series.map((s) => s.byCommunity?.[id]?.meanIncome ?? null) }))
          : CITIES.filter((c) => c.kind === 'city').map((c) => ({ name: c.name, data: series.map((s) => s.byCity?.[c.id]?.meanIncome ?? null) })), moneyAxis)} />
      </Viz>
      {narrowed && scope.kind !== 'community' && scope.kind !== 'city' && <ScopeNote what="The time series (population, vital events, year by year)" />}
      <Viz title="Vital events (cumulative)" note="births, deaths, marriages, migration">
        <EChart option={lineOption(th, x, [{ name: 'births', data: series.map((s) => s.births) }, { name: 'deaths', data: series.map((s) => s.deaths) }, { name: 'marriages', data: series.map((s) => s.marriages) }, { name: 'emigrated', data: series.map((s) => s.emigrations) }, { name: 'immigrated', data: series.map((s) => s.immigrations) }])} />
      </Viz>
      <Viz
        title="Year by year"
        wide
        empty={!w.stats.yearly.length && 'Completes after the first simulated year.'}
        summary={(() => {
          const y = w.stats.yearly[w.stats.yearly.length - 1];
          if (!y) return null;
          const ys = w.stats.yearly.slice(-40);
          return (
            <Mini
              option={miniColumns(th, ys.map((r) => String(r.year)), [
                { name: 'births', data: ys.map((r) => r.births), color: th.categorical[0] },
                { name: 'deaths', data: ys.map((r) => r.deaths), color: th.categorical[1] },
              ])}
              keys={[
                { label: `births ${y.year}`, value: y.births, color: th.categorical[0], mark: 'bar' },
                { label: 'deaths', value: y.deaths, color: th.categorical[1], mark: 'bar' },
                { label: 'population', value: y.population },
                { label: 'realised TFR', value: y.tfr.toFixed(2) },
                { label: 'A/E cumulative', value: y.aeRatio?.toFixed(2) ?? '—' },
              ]}
            />
          );
        })()}
      >
        <Tbl><table>
          <thead><tr><th>Year</th><th className="n">Pop</th><th className="n">Births</th><th className="n">Deaths</th><th className="n">CBR ‰</th><th className="n">CDR ‰</th><th className="n">Realised TFR</th><th className="n">e0 M / F (exp.)</th><th className="n">Marriages</th><th className="n">A/E (cum.)</th></tr></thead>
          <tbody>
            {w.stats.yearly.map((y) => (
              <tr key={y.year}><td>{y.year}</td><td className="n">{y.population}</td><td className="n">{y.births}</td><td className="n">{y.deaths}</td><td className="n">{y.cbr.toFixed(1)}</td><td className="n">{y.cdr.toFixed(1)}</td><td className="n">{y.tfr.toFixed(2)}</td><td className="n">{y.e0M?.toFixed(1) ?? '—'} / {y.e0F?.toFixed(1) ?? '—'}</td><td className="n">{y.marriages}</td><td className="n">{y.aeRatio?.toFixed(2) ?? '—'}</td></tr>
            ))}
            {!w.stats.yearly.length && <tr><td colSpan={10} className="muted">Completes after the first simulated year.</td></tr>}
          </tbody>
        </table></Tbl>
      </Viz>
    </>
  );
}

function MortalityTab() {
  // (scope banner rendered in the JSX below)
  const st = useStore();
  const th = chartTheme();
  const sim = st.sim;
  const rows = aeTable(sim.world.stats.exposures);
  const bands = rows.filter((r) => r.sex === 'all' && r.band !== 'all');
  const allM = rows.find((r) => r.sex === 'M' && r.band === 'all')!;
  const allF = rows.find((r) => r.sex === 'F' && r.band === 'all')!;
  const tot = rows.find((r) => r.sex === 'all' && r.band === 'all')!;
  const bandRows = rows.filter((r) => r.band !== 'all' && r.sex !== 'all');
  // Survival curves: basis vs experience-adjusted
  const ltM = lifeTable(sim.ctx.qx.M);
  const ltF = lifeTable(sim.ctx.qx.F);
  const adj = (qx: number[], ratio: number | null) => lifeTable(qx.map((q, i) => (i === qx.length - 1 ? 1 : Math.min(0.999, q * (ratio ?? 1)))));
  const ages = ltM.map((r) => String(r.age));
  const b = baseOption(th);
  const survOpt = {
    ...lineOption(th, ages, [
      { name: 'male basis', data: ltM.map((r) => r.lx / 1000), color: th.male },
      { name: 'female basis', data: ltF.map((r) => r.lx / 1000), color: th.female },
      ...(allM.ratio !== null && allM.actual >= 3 ? [{ name: 'male experience-adj.', data: adj(sim.ctx.qx.M, allM.ratio).map((r) => r.lx / 1000), color: th.male }] : []),
      ...(allF.ratio !== null && allF.actual >= 3 ? [{ name: 'female experience-adj.', data: adj(sim.ctx.qx.F, allF.ratio).map((r) => r.lx / 1000), color: th.female }] : []),
    ]),
  } as Record<string, unknown>;
  (survOpt.series as Array<Record<string, unknown>>).forEach((s, i) => {
    if (i >= 2) s.lineStyle = { width: 2, type: 'dashed' };
  });
  (survOpt.xAxis as Record<string, unknown>).axisLabel = { color: th.muted, fontSize: 10, interval: 9 };
  const qxOpt = {
    ...lineOption(th, ages, [{ name: 'male qx', data: sim.ctx.qx.M.map((q) => q * 1000), color: th.male }, { name: 'female qx', data: sim.ctx.qx.F.map((q) => q * 1000), color: th.female }], (v: number) => `${v}‰`),
  } as Record<string, unknown>;
  (qxOpt.yAxis as Record<string, unknown>).type = 'log';
  (qxOpt.xAxis as Record<string, unknown>).axisLabel = { color: th.muted, fontSize: 10, interval: 9 };
  const causes = Object.entries(sim.world.stats.deathsByCause).sort((a, b2) => b2[1] - a[1]);
  const aeOpt = {
    ...barOption(th, bands.map((r) => r.band), [{ name: 'A/E', data: bands.map((r) => Number((r.ratio ?? 0).toFixed(2))), color: th.categorical[0] }]),
  } as Record<string, unknown>;
  (aeOpt.series as Array<Record<string, unknown>>)[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: th.muted, type: 'dashed' }, data: [{ yAxis: 1 }] };
  void b;
  return (
    <>
      <ScopeNote what="Mortality experience (A/E, exposure, survival)" />
      <Viz
        title="Actual vs expected deaths"
        note={`basis: ${sim.ctx.qx.label}`}
        wide
        summary={
          <Mini
            height={96}
            option={miniRange(th, [
              { label: 'everyone', est: tot.ratio, lo: tot.lo, hi: tot.hi, color: th.fg },
              { label: 'men', est: allM.ratio, lo: allM.lo, hi: allM.hi, color: th.male },
              { label: 'women', est: allF.ratio, lo: allF.lo, hi: allF.hi, color: th.female },
            ], { ref: 1, refLabel: 'basis 1.00' })}
            keys={[
              { label: 'A/E with its 95% interval' },
              { label: 'deaths', value: `${tot.actual} vs ${tot.expected.toFixed(1)} expected`, tone: tot.ratio !== null && (tot.ratio > 1.5 || tot.ratio < 0.6) ? 'warn' : undefined },
              { label: 'exposure', value: `${tot.exposure.toFixed(0)} person-years` },
            ]}
          />
        }
      >
        <div className="row wrap" style={{ gap: 24, alignItems: 'flex-start' }}>
          <div className="stat-hero">
            <div className="big">{tot.ratio === null ? '—' : tot.ratio.toFixed(2)}</div>
            <div className="cmp">overall A/E · {tot.actual} deaths vs {tot.expected.toFixed(1)} expected on {tot.exposure.toFixed(0)} person-years · 95% Poisson interval [{tot.lo?.toFixed(2) ?? '—'}, {tot.hi?.toFixed(2) ?? '—'}]</div>
          </div>
          <div className="stat-hero">
            <div className="big">{allM.ratio === null ? '—' : allM.ratio.toFixed(2)} <small className="muted" style={{ fontSize: 12 }}>men</small></div>
            <div className="cmp">{allM.actual} vs {allM.expected.toFixed(1)}</div>
          </div>
          <div className="stat-hero">
            <div className="big">{allF.ratio === null ? '—' : allF.ratio.toFixed(2)} <small className="muted" style={{ fontSize: 12 }}>women</small></div>
            <div className="cmp">{allF.actual} vs {allF.expected.toFixed(1)}</div>
          </div>
        </div>
        <Tbl><table>
          <thead><tr><th>Age band</th><th>Sex</th><th className="n">Exposure (py)</th><th className="n">Actual</th><th className="n">Expected</th><th className="n">A/E</th><th className="n">95% interval</th></tr></thead>
          <tbody>
            {bandRows.map((r) => (
              <tr key={`${r.band}-${r.sex}`}><td>{r.band}</td><td>{r.sex}</td><td className="n">{r.exposure.toFixed(1)}</td><td className="n">{r.actual}</td><td className="n">{r.expected.toFixed(2)}</td><td className="n">{r.ratio === null ? '—' : r.ratio.toFixed(2)}</td><td className="n">{r.lo === null ? '—' : `[${r.lo.toFixed(2)}, ${r.hi?.toFixed(2)}]`}</td></tr>
            ))}
            <tr className="total"><td>all</td><td>all</td><td className="n">{tot.exposure.toFixed(1)}</td><td className="n">{tot.actual}</td><td className="n">{tot.expected.toFixed(2)}</td><td className="n">{tot.ratio?.toFixed(2) ?? '—'}</td><td className="n">{tot.lo === null ? '—' : `[${tot.lo.toFixed(2)}, ${tot.hi?.toFixed(2)}]`}</td></tr>
          </tbody>
        </table></Tbl>
        <div className="muted small">Expected deaths = Σ over person-days of the basis daily hazard (table qx with the improvement drift, no individual multipliers). Individual risk factors (conditions, vitality, grief, poverty) are normalised within each age band so they redistribute risk without moving the band off the table; illness episodes add their own deaths and the table share falls with age to compensate. Calibrated so the pooled A/E is ≈ 1 and flat by age under the default basis (docs/ASSUMPTIONS.md); departures in a single run are experience, not a bug.</div>
      </Viz>
      <Viz title="A/E by age band (both sexes)" empty={tot.actual === 0 && 'No deaths yet — the ratio needs actual deaths.'}><EChart option={aeOpt} /></Viz>
      <Viz title="Survival curve l(x)/1000: basis vs experience-adjusted"><EChart option={survOpt} /></Viz>
      <Viz title="Basis qx (log scale)"><EChart option={qxOpt} /></Viz>
      <Viz title="Deaths by cause" empty={!causes.length && 'No deaths yet.'}>
        <EChart option={barOption(th, causes.map((c) => c[0]), [{ name: 'deaths', data: causes.map((c) => c[1]), color: th.sequential[3] }], true)} />
      </Viz>
      <Viz title="Deaths by age band" empty={!Object.keys(sim.world.stats.deathsByBand).length && 'No deaths yet.'}>
        <EChart option={barOption(th, Object.keys(sim.world.stats.deathsByBand), [{ name: 'deaths', data: Object.values(sim.world.stats.deathsByBand), color: th.sequential[3] }])} />
      </Viz>
    </>
  );
}

function FertilityTab() {
  const st = useStore();
  const th = chartTheme();
  const sim = st.sim;
  const rf = realisedFertility(sim.world.stats);
  const basis = scaledAsfr(ASFR_SHAPE_SA, sim.params.tfr);
  const yrs = sim.world.stats.yearly;
  return (
    <>
      <ScopeNote what="Fertility measurement (ASFR, births A/E)" />
      <Viz
        title="Age-specific fertility: basis vs realised"
        note={`TFR basis ${sim.params.tfr.toFixed(2)} · realised ${rf.tfr.toFixed(2)}`}
        summaryLabel="full chart"
        summary={
          <Mini
            option={miniColumns(th, rf.bands.map((b) => b.band), [
              { name: 'basis (per 1,000)', data: sim.ctx.asfr.map((b) => Math.round(b.rate * 1000)), color: th.categorical[0] },
              { name: 'realised (per 1,000)', data: rf.bands.map((b) => Math.round(b.rate * 1000)), color: th.categorical[1] },
            ], { fmt: (v) => `${v}‰` })}
            keys={[
              { label: 'basis TFR', value: sim.params.tfr.toFixed(2), color: th.categorical[0], mark: 'bar' },
              { label: 'realised', value: rf.tfr > 0 ? rf.tfr.toFixed(2) : '—', color: th.categorical[1], mark: 'bar' },
              { label: 'births A/E', value: sim.world.stats.expectedBirths > 0 ? (sim.world.stats.births / sim.world.stats.expectedBirths).toFixed(2) : '—' },
            ]}
          />
        }
      >
        <EChart option={barOption(th, rf.bands.map((b) => b.band), [{ name: 'basis (per 1,000)', data: sim.ctx.asfr.map((b) => Math.round(b.rate * 1000)) }, { name: 'realised (per 1,000)', data: rf.bands.map((b) => Math.round(b.rate * 1000)) }])} />
        <div className="muted small">Realised rates divide births by woman-years in each band; with a few dozen women they are noisy — the births A/E below is the sturdier statistic.</div>
      </Viz>
      <Viz title="Births actual vs expected">
        <div className="stat-hero">
          <div className="big">{sim.world.stats.expectedBirths > 0 ? (sim.world.stats.births / sim.world.stats.expectedBirths).toFixed(2) : '—'}</div>
          <div className="cmp">{sim.world.stats.births} births vs {sim.world.stats.expectedBirths.toFixed(1)} expected on the ASFR basis</div>
        </div>
        <Tbl><table>
          <thead><tr><th>Band</th><th className="n">Woman-years</th><th className="n">Births</th><th className="n">Basis rate</th><th className="n">Realised</th></tr></thead>
          <tbody>
            {rf.bands.map((b, i) => (
              <tr key={b.band}><td>{b.band}</td><td className="n">{b.womanYears.toFixed(1)}</td><td className="n">{b.births}</td><td className="n">{(basis[i].rate * 1000).toFixed(0)}‰</td><td className="n">{(b.rate * 1000).toFixed(0)}‰</td></tr>
            ))}
          </tbody>
        </table></Tbl>
      </Viz>
      <Viz title="Births by year" size="wide" empty={!yrs.length && 'Completes after the first simulated year.'}>
        <EChart option={barOption(th, yrs.map((y) => String(y.year)), [{ name: 'births', data: yrs.map((y) => y.births) }])} />
      </Viz>
    </>
  );
}

function HealthTab() {
  const st = useStore();
  const th = chartTheme();
  const s = st.sim.world.stats;
  const series = useSeries();
  const kinds = Object.entries(s.illnessByKind).sort((a, b) => b[1] - a[1]);
  const { people, label, narrowed } = useScope();
  const conds: Record<string, number> = {};
  for (const p of people) for (const c of p.health.conditions) conds[c] = (conds[c] ?? 0) + 1;
  return (
    <>
      {narrowed && <ScopeNote what="Onset seasonality, episode counts and the monthly series" />}
      <Viz title="Illness onsets by calendar month" note="seasonality">
        <EChart option={barOption(th, MONTHS as unknown as string[], [{ name: 'onsets', data: s.illnessByMonth, color: th.sequential[3] }])} />
      </Viz>
      <Viz title="Episodes by kind" empty={!kinds.length && 'No illness episodes yet.'}>
        <EChart option={barOption(th, kinds.map((k) => k[0]), [{ name: 'episodes', data: kinds.map((k) => k[1]), color: th.sequential[3] }], true)} />
      </Viz>
      <Viz title="Ill and hospitalised (monthly)">
        <EChart option={lineOption(th, series.map((x) => x.isoDate.slice(0, 7)), [{ name: 'ill', data: series.map((x) => x.ill) }, { name: 'in ward', data: series.map((x) => x.inHospital) }, { name: 'mean vitality ×10', data: series.map((x) => Math.round(x.meanVitality * 10 * 10) / 10) }])} />
      </Viz>
      <Viz title="Chronic conditions now (prevalence)" note={narrowed ? label : undefined} empty={!Object.keys(conds).length && (narrowed ? `No chronic conditions in ${label}.` : 'Nobody has a chronic condition.')}>
        <EChart option={barOption(th, Object.keys(conds), [{ name: 'people', data: Object.values(conds), color: th.sequential[3] }], true)} />
        <div className="muted small">{s.clinicVisits} clinic consultations · {s.hospitalisations} admissions · {s.recoveries} recoveries</div>
      </Viz>
    </>
  );
}


export function InsuranceTab() {
  const st = useStore();
  const th = chartTheme();
  const ins = st.sim.world.insurance;
  const path = ins.surplusPath;
  const opt = lineOption(th, path.map((p) => String(p.month)), [{ name: 'reserve', data: path.map((p) => p.reserve) }], moneyAxis) as Record<string, unknown>;
  (opt.series as Array<Record<string, unknown>>)[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: th.status.serious, type: 'dashed' }, data: [{ yAxis: 0 }] };
  (opt.series as Array<Record<string, unknown>>)[0].areaStyle = { color: th.categorical[0], opacity: 0.08 };
  return (
    <>
      <Viz title="Surplus process of the community funeral & life scheme" note={ins.ruined ? `RUINED in month ${ins.ruinMonth}` : 'solvent'} wide empty={path.length < 2 && 'The surplus path starts after the first month.'}>
        <EChart option={opt} />
        <div className="muted small">Premiums in R{Math.round(ins.premiumsIn).toLocaleString()} · claims out R{Math.round(ins.claimsOut).toLocaleString()} ({ins.claimCount}) · policies {ins.policies}. A classical Cramér–Lundberg picture: a small pool, lumpy claims (life cover pays R{st.sim.params.lifeCoverSum.toLocaleString()} on an adult death) and a thin reserve. Use the Monte Carlo tab for the ruin probability across replications.</div>
      </Viz>
      <Viz title="Premiums vs claims by month" wide empty={path.length < 2 && 'Starts after the first month.'}>
        <EChart option={barOption(th, path.map((p) => String(p.month)), [{ name: 'premiums', data: path.map((p) => p.premiums) }, { name: 'claims', data: path.map((p) => p.claims) }])} />
      </Viz>
    </>
  );
}

function SocialTab() {
  const st = useStore();
  const th = chartTheme();
  const w = st.sim.world;
  const s = w.stats;
  const comName = (id: string) => COMMUNITY[id as CommunityId]?.name ?? id;
  const church = s.weeklyChurch.slice(-104);
  const x = church.map((c) => String(Math.round(c.day / 7)));
  const { scope, people: scoped, label: scLabel, narrowed } = useScope();
  const rels: Record<string, number> = {};
  for (const p of scoped) for (const r of Object.values(p.relationships)) rels[r.kind] = (rels[r.kind] ?? 0) + 1;
  const relRows = Object.entries(rels).sort((a, b) => b[1] - a[1]);
  const marital: Record<string, number> = {};
  for (const p of scoped) if (p.age >= 18) marital[p.marital] = (marital[p.marital] ?? 0) + 1;
  return (
    <>
      {narrowed && <ScopeNote what="Sunday attendance, disputes and the council" />}
      <Viz title="The city councils" note="six elected portfolio seats + health ex officio per city; every settlement holds at least one seat, none more than three" wide>
        <Tbl><table>
          <thead><tr><th>City</th><th>Portfolio</th><th>Holder</th><th>Settlement</th><th className="n">Tenure</th></tr></thead>
          <tbody>
            {w.council.filter((seat) => scope.kind !== 'city' || seat.city === scope.id).map((seat) => {
              const p = seat.personId ? w.people[seat.personId] : null;
              return (
                <tr key={`${seat.city}-${seat.role}`}>
                  <td>{CITY[seat.city]?.short ?? seat.city}</td>
                  <td>{seat.title}</td>
                  <td>{p ? `${p.firstName} ${p.surname} (${JOBS[p.job]?.label ?? p.job})` : <span className="muted">vacant</span>}</td>
                  <td>{seat.community ? comName(seat.community) : '—'}</td>
                  <td className="n">{seat.personId ? `${((w.day - seat.sinceDay) / 365).toFixed(1)} y` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></Tbl>
      </Viz>
      <Viz title="Sunday attendance (share of the church-going cities' residents)" note="weekly · Emmaus and Ithemba; Newhaven has no congregation">
        <EChart option={lineOption(th, x, [{ name: 'attendance %', data: church.map((c) => Math.round((c.attendance / Math.max(1, c.population)) * 100)) }], (v: number) => `${v}%`)} />
      </Viz>
      <Viz title="Disputes, mediations, fights">
        <EChart option={barOption(th, ['disputes', 'pastoral mediations', 'fights', 'conversations ÷ 100'], [{ name: 'count', data: [s.disputes, s.mediations, s.fights, Math.round(s.conversations / 100)], color: th.sequential[3] }])} />
      </Viz>
      <Viz title="Relationship ties (directed)" note={narrowed ? scLabel : undefined} empty={!relRows.length && 'No ties yet.'}>
        <EChart option={barOption(th, relRows.map((r) => r[0]), [{ name: 'ties', data: relRows.map((r) => r[1]), color: th.sequential[3] }], true)} />
      </Viz>
      <Viz title="Marital status (18+)" note={narrowed ? scLabel : undefined}>
        <EChart option={barOption(th, Object.keys(marital), [{ name: 'people', data: Object.values(marital), color: th.sequential[3] }])} />
      </Viz>
    </>
  );
}

function SafetyTab() {
  const st = useStore();
  const th = chartTheme();
  const w = st.sim.world;
  const s = w.stats;
  const kinds = Object.entries(s.incidentsByKind).sort((a, b) => b[1] - a[1]);
  const { people: scoped, label: scLabel, narrowed } = useScope();
  const ids = new Set(scoped.map((p) => p.id));
  const cases = Object.values(w.courtCases).slice(-40).reverse();
  const scopedIncs = Object.values(w.incidents).filter((i) => !narrowed || i.involvedIds.some((id) => ids.has(id)) || i.responderIds.some((id) => ids.has(id)));
  const incs = scopedIncs.slice(-40).reverse();
  // Incidents in each of the last 24 months (30.44-day months, counted back from today).
  const incMonths = new Array(24).fill(0);
  for (const i of scopedIncs) {
    const k = 23 - Math.floor((w.day - i.day) / 30.44);
    if (k >= 0 && k < 24) incMonths[k]++;
  }
  return (
    <>
      {narrowed && <ScopeNote what="The incident counters and the court roll" />}
      <Viz title="Incidents by kind" empty={!kinds.length && 'No incidents yet.'}>
        <EChart option={barOption(th, kinds.map((k) => k[0]), [{ name: 'incidents', data: kinds.map((k) => k[1]), color: th.sequential[3] }], true)} />
      </Viz>
      <Viz title="Policing and court">
        <EChart option={barOption(th, ['incidents', 'arrests', 'court cases', 'convictions', 'road accidents'], [{ name: 'count', data: [s.incidents, s.arrests, s.courtCases, s.convictions, s.roadAccidents], color: th.sequential[3] }])} />
        <div className="muted small">{Math.round(s.kmDriven).toLocaleString()} km driven · {s.roadAccidents} accidents · {s.ambulanceRuns} ambulance call-outs</div>
        <div className="muted small">Getting about: {s.trainRides.toLocaleString()} Hyperline · {s.busRides.toLocaleString()} bus · {s.taxiRides.toLocaleString()} minibus-taxi rides · {(s.rideTrips ?? 0).toLocaleString()} e-hailing trips (R{Math.round(s.rideFares ?? 0).toLocaleString()} in fares) · {s.airTrips.toLocaleString()} day trips by air on {s.flights.toLocaleString()} flights</div>
      </Viz>
      <Viz
        title="Recent incidents"
        note={narrowed ? `involving ${scLabel}` : undefined}
        wide
        summary={
          <Mini
            option={miniColumns(th, incMonths.map((_, k) => (k === 23 ? 'this month' : `${23 - k} months ago`)), [{ name: 'incidents', data: incMonths, color: th.sequential[3] }])}
            keys={[
              { label: 'incidents a month', color: th.sequential[3], mark: 'bar' },
              { label: narrowed ? `involving ${scLabel}` : 'on record', value: narrowed ? scopedIncs.length : w.stats.incidents },
              { label: narrowed ? 'arrests · district' : 'arrests', value: w.stats.arrests },
              { label: 'latest', value: incs[0] ? `${incs[0].kind} · day ${incs[0].day}` : '—' },
            ]}
          />
        }
      >
        <Tbl><table>
          <thead><tr><th>Day</th><th>Kind</th><th>Where</th><th>Handled by</th><th>Outcome</th><th className="n">Loss</th></tr></thead>
          <tbody>
            {incs.map((i) => (
              <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => store.select({ kind: 'incident', id: i.id }, { focus: true })}><td>{i.day}</td><td>{i.kind}</td><td>{i.buildingId ? w.buildings[i.buildingId]?.name : 'road'}</td><td>{i.handledBy ?? '—'}</td><td>{i.status} · {i.outcome}</td><td className="n">{i.loss ? `R${i.loss.toLocaleString()}` : ''}</td></tr>
            ))}
          </tbody>
        </table></Tbl>
      </Viz>
      <Viz
        title="Court roll"
        wide
        summary={(() => {
          const all = Object.values(w.courtCases);
          const n = (v: string) => all.filter((c) => c.verdict === v).length;
          const parts = [
            { name: 'guilty', values: [n('guilty')], color: th.categorical[1] },
            { name: 'not guilty', values: [n('not-guilty')], color: th.categorical[0] },
            { name: 'dismissed', values: [n('dismissed')], color: th.categorical[3] },
            { name: 'settled', values: [n('settled')], color: th.categorical[2] },
            { name: 'pending', values: [n('pending')], color: quiet(th) },
          ];
          return (
            <Mini
              height={40}
              option={all.length ? miniSplit(th, [''], parts) : null}
              keys={[
                ...parts.filter((p) => p.values[0] > 0).map((p) => ({ label: p.name, value: p.values[0], color: p.color, mark: 'bar' as const })),
                { label: 'latest', value: cases[0] ? `${cases[0].accusedName}: ${cases[0].charge}` : '—' },
              ]}
            />
          );
        })()}
      >
        <Tbl><table>
          <thead><tr><th>Filed</th><th>Accused</th><th>Charge</th><th>Hearing</th><th>Verdict</th><th>Sentence</th></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}><td>{c.filedDay}</td><td>{c.accusedName}</td><td>{c.charge}</td><td>{c.hearingDay}</td><td>{c.verdict}</td><td>{c.sentence ?? ''}</td></tr>
            ))}
          </tbody>
        </table></Tbl>
      </Viz>
    </>
  );
}

function EducationTab() {
  const st = useStore();
  const th = chartTheme();
  const w = st.sim.world;
  const series = useSeries();
  const { people: scoped, label: scLabel, narrowed } = useScope();
  const attain: Record<string, number> = {};
  for (const p of scoped) if (p.age >= 18) attain[p.education] = (attain[p.education] ?? 0) + 1;
  const order = ['none', 'primary', 'secondary', 'matric', 'tertiary', 'postgrad'];
  return (
    <>
      {narrowed && <ScopeNote what="The school-vs-homeschool series" />}
      <Viz title="Adult educational attainment" note={narrowed ? scLabel : undefined}>
        <EChart option={barOption(th, order, [{ name: 'adults', data: order.map((k) => attain[k] ?? 0), color: th.sequential[3] }])} />
      </Viz>
      <Viz title="School vs homeschool (monthly)">
        <EChart option={lineOption(th, series.map((s) => s.isoDate.slice(0, 7)), [{ name: 'at school', data: series.map((s) => s.atSchool) }, { name: 'homeschooled', data: series.map((s) => s.homeschooled) }])} />
      </Viz>
    </>
  );
}

function WeatherTab() {
  const st = useStore();
  const th = chartTheme();
  const log = st.sim.world.stats.weatherLog;
  return (
    <Viz title="Weather, wind and rain" note="each day's sky and its low–high; arrows show where the wind blows; drag the slider to move through the year" size="banner" empty={log.length < 2 && 'Weather is recorded from the first day.'}>
      <EChart option={weatherOption(th, log, store.startMs)} />
    </Viz>
  );
}

function MonteCarloTab() {
  const st = useStore();
  const th = chartTheme();
  const [years, setYears] = useState(30);
  const [seeds, setSeeds] = useState(20);
  const [job, setJob] = useState<{ id: string; status: string; done: number; total: number; summary: BatchSummary | null; error?: string } | null>(null);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(async () => {
      try {
        const j = await api.batch(job.id);
        setJob(j);
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job]);
  const run = async () => {
    const r = await api.startBatch({ params: st.params, years, seeds });
    setJob({ id: r.id, status: 'running', done: 0, total: seeds, summary: null });
  };
  const sum = job?.summary;
  const hist = (key: keyof BatchSummary['percentiles']) => {
    if (!sum) return null;
    const vals = sum.rows.map((r) => r[key as keyof typeof r]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const n = 12;
    const step = (hi - lo) / n || 1;
    const bins = new Array(n).fill(0);
    for (const v of vals) bins[Math.min(n - 1, Math.floor((v - lo) / step))]++;
    return barOption(th, bins.map((_, i) => (lo + i * step).toFixed(key === 'population' ? 0 : 2)), [{ name: key, data: bins, color: th.categorical[0] }]);
  };
  return (
    <>
      <Viz title="Replications of this basis" note={`basis ${st.sim.world.basisHash}`} wide>
        <div className="row wrap">
          <label>Years <input type="number" value={years} min={1} max={60} onChange={(e) => setYears(Number(e.target.value))} /></label>
          <label>Seeds <input type="number" value={seeds} min={1} max={200} onChange={(e) => setSeeds(Number(e.target.value))} /></label>
          <button className="primary" onClick={run} disabled={job?.status === 'running'}>Run on the server</button>
          {job && job.status === 'running' && <span className="muted">{job.done}/{job.total}</span>}
          {job?.status === 'done' && <a href={`/api/batch/${job.id}/csv`} download>download CSV</a>}
          {job?.error && <span className="err">{job.error}</span>}
        </div>
        {job && job.status === 'running' && <div className="progress"><i style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} /></div>}
        <div className="muted small">Each seed builds an independent community from the same parameter basis and runs it in time-lapse mode (≈ 4 s per 30 years). Common random numbers: streams are named, so a changed assumption perturbs only its own stream.</div>
        {sum && (
          <Tbl><table>
            <thead><tr><th>Metric</th><th className="n">p5</th><th className="n">p25</th><th className="n">median</th><th className="n">p75</th><th className="n">p95</th><th className="n">mean</th></tr></thead>
            <tbody>
              {Object.entries(sum.percentiles).map(([k, p]) => (
                <tr key={k}><td>{k}</td><td className="n">{fmtP(p.p5)}</td><td className="n">{fmtP(p.p25)}</td><td className="n">{fmtP(p.p50)}</td><td className="n">{fmtP(p.p75)}</td><td className="n">{fmtP(p.p95)}</td><td className="n">{fmtP(p.mean)}</td></tr>
              ))}
              <tr className="total"><td>pooled mortality A/E</td><td colSpan={6} className="n">{sum.pooledAe?.toFixed(3) ?? '—'}</td></tr>
              <tr className="total"><td>pooled births A/E</td><td colSpan={6} className="n">{sum.pooledFertilityAe?.toFixed(3) ?? '—'}</td></tr>
              <tr className="total"><td>P(scheme ruin within {sum.years} y)</td><td colSpan={6} className="n">{(sum.ruinProbability * 100).toFixed(0)}%</td></tr>
            </tbody>
          </table></Tbl>
        )}
      </Viz>
      {sum && hist('population') && <Viz title="Final population across seeds"><EChart option={hist('population')!} /></Viz>}
      {sum && hist('ae') && <Viz title="Mortality A/E across seeds"><EChart option={hist('ae')!} /></Viz>}
      {sum && hist('reserve') && <Viz title="Scheme reserve at the end across seeds"><EChart option={hist('reserve')!} /></Viz>}
    </>
  );
}

function fmtP(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
}

function BasisTab() {
  const st = useStore();
  const P = st.params;
  const preset = MORTALITY_PRESETS.find((p) => p.id === P.mortalityPreset);
  const rows = Object.entries(P).filter(([k]) => k !== 'educationMix' && k !== 'mortalityOverride' && k !== 'shocks');
  const csv = () => {
    const qx = st.sim.ctx.qx;
    const lines = ['age,qx_male,qx_female'];
    qx.M.forEach((q, i) => lines.push(`${i},${q.toExponential(6)},${qx.F[i].toExponential(6)}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qx-${qx.presetId}.csv`;
    a.click();
  };
  const ledger = () => {
    const w = st.sim.world;
    const lines = ['id,day,minute,kind,severity,text,personIds'];
    for (const e of w.events) lines.push([e.id, e.day, e.minute, e.kind, e.severity, `"${e.text.replace(/"/g, '""')}"`, e.personIds.join('|')].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `events-${w.basisHash}.csv`;
    a.click();
  };
  return (
    <>
      <Viz
        title="Assumption basis"
        note={`hash ${st.sim.world.basisHash}`}
        wide
        summary={(() => {
          const qx = st.sim.ctx.qx;
          const th = chartTheme();
          const perMille = (q: number[]) => q.map((v, i) => [i, Math.max(0.01, v * 1000)] as [number, number]);
          return (
            <Mini
              controls={
                <>
                  <button className="ghost" onClick={csv}>qx table (CSV)</button>
                  <button className="ghost" onClick={ledger}>event ledger (CSV)</button>
                </>
              }
              option={miniXY(th, [
                { name: 'male qx', data: perMille(qx.M), color: th.male },
                { name: 'female qx', data: perMille(qx.F), color: th.female },
              ], { yLog: true, xFmt: (v) => `age ${Math.round(v)}`, yFmt: (v) => `${v < 1 ? v.toFixed(2) : Math.round(v)}‰`, xMin: 0, xMax: qx.M.length - 1 })}
              keys={[
                { label: 'men', color: th.male },
                { label: 'women', color: th.female },
                { label: 'mortality', value: preset?.id ?? P.mortalityPreset },
                { label: 'fertility', value: `${P.fertilityShape} · TFR ${P.tfr.toFixed(2)}` },
                { label: 'seed', value: P.seed },
                { label: 'start', value: P.startDate },
                { label: 'parameters', value: rows.length + 1 },
              ]}
            />
          );
        })()}
      >
        <div className="row wrap">
          <button className="ghost" onClick={csv}>download qx table (CSV)</button>
          <button className="ghost" onClick={ledger}>download event ledger (CSV)</button>
        </div>
        <div className="muted small">Mortality: {P.mortalityOverride ? `${P.mortalityOverride.label}, supplied (${P.mortalityOverride.source}); the death channels stay calibrated to ${preset?.label}` : `${preset?.label} — ${preset?.source}`}. Fertility: {P.fertilityShape === 'sa' ? 'South African ASFR shape' : 'late ASFR shape'} scaled to TFR {P.tfr}. Provenance for every default is in docs/ASSUMPTIONS.md; the model description follows the ODD protocol (docs/ODD.md).</div>
        <Tbl><table>
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>
            ))}
            <tr><td>educationMix</td><td>{Object.entries(P.educationMix).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}</td></tr>
            {P.mortalityOverride && <tr><td>mortalityOverride</td><td>{P.mortalityOverride.label} — {P.mortalityOverride.source} (supplied; the preset stays the calibration)</td></tr>}
            {P.shocks?.map((s, i) => <tr key={`shock-${i}`}><td>{i ? '' : 'shocks'}</td><td>{shockLabel(s)}, from month {s.fromMonth}</td></tr>)}
          </tbody>
        </table></Tbl>
      </Viz>
    </>
  );
}
