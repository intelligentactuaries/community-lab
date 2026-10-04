// The Scelo exchange, from Community Lab's side: the province's data out —
// as Scelo datasets that land in Soft Data, or as files in the open
// workspace — and what Scelo has sent in (a fitted basis, a stress) with the
// way back to the preset. On a page of its own (no Scelo around it) every
// export downloads instead.

import { type CommunityExport, MAX_SEED_YEARS, tableCsv } from '@scelo/core/exchange';
import { useState } from 'react';
import { MORTALITY_PRESETS, buildQxTable, presetById } from '../../../sim/mortality';
import { experienceCells, lastCountedDay, macroRows, modelPointRows, personYearRows, trueBasis, type Grouping } from '../../../sim/experience';
import { assumptionsHash } from '../../../sim/params';
import { changedFromDefaults } from '../../../sim/patch';
import { shockLabel } from '../../../sim/shocks';
import { calendarForDay } from '../../../sim/time';
import { experienceExport, macroExport, modelPointsExport, personYearsExport, provenanceFor } from '../../../shared/sceloExport';
import { Mini, Tbl, Viz } from '../../charts/helpers';
import { miniXY } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { provinceBase } from '../../lib/lab';
import { bridge, clearOutsideInputs, useBridge } from '../../lib/sceloBridge';
import { store, useStore } from '../../lib/simStore';

function provenance() {
  const sim = store.sim;
  const changed = changedFromDefaults(sim.params);
  if (sim.params.mortalityOverride) changed.mortalityOverride = { label: sim.params.mortalityOverride.label, source: sim.params.mortalityOverride.source };
  if (sim.params.shocks) changed.shocks = sim.params.shocks.map(shockLabel);
  return provenanceFor({
    span: { from: calendarForDay(sim.ctx.startMs, 0).isoDate, to: calendarForDay(sim.ctx.startMs, lastCountedDay(sim.world)).isoDate },
    seed: sim.params.seed,
    basisHash: sim.world.basisHash,
    assumptionsHash: assumptionsHash(sim.params),
    scenario: `${sim.params.regionName} Province, as on screen`,
    changed,
  });
}

function downloadText(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

/** Send / save / download buttons for one export, built when pressed (the province keeps moving). */
function Actions({ make, label }: { make: () => CommunityExport; label: string }) {
  const B = useBridge();
  const [last, setLast] = useState<string | null>(null);
  const go = (to: 'soft-data' | 'workspace') => {
    const e = make();
    const ok = bridge.send(e, to);
    setLast(ok ? (to === 'soft-data' ? `Sent: ${e.tables[0].rows.length.toLocaleString('en-GB')} rows are Scelo's dataset now.` : `Saved ${e.tables.length + 2} files to the workspace.`) : 'Scelo did not answer; try again from Scelo IDE.');
    if (ok) bridge.fact(`community:${e.exportKind}`, `Community Lab · ${e.title}`, e.headline?.map((h) => `${h.label} ${h.value}`).join(' · '));
  };
  return (
    <>
      <div className="row wrap">
        {B.connected && (
          <button type="button" className="primary" onClick={() => go('soft-data')} title={`The ${label} becomes the dataset in Scelo's Soft Data`}>
            Send to Scelo
          </button>
        )}
        {B.connected && B.canSaveToWorkspace && (
          <button type="button" onClick={() => go('workspace')} title="Every table as CSV, a README with the provenance and dictionary, and the true basis as JSON, in the open workspace">
            Save to workspace
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const e = make();
            downloadText(`${e.tables[0].name}.csv`, tableCsv(e.tables[0]), 'text/csv');
          }}
        >
          CSV
        </button>
        <button
          type="button"
          className="ghost"
          title="The whole export (every table, the provenance, the true basis) as one JSON file Scelo can read"
          onClick={() => {
            const e = make();
            downloadText(`${e.tables[0].name}.scelo.json`, JSON.stringify(e), 'application/json');
          }}
        >
          JSON
        </button>
      </div>
      {last && <div className="small muted">{last}</div>}
    </>
  );
}

export function SceloTab() {
  const st = useStore();
  const B = useBridge();
  const th = chartTheme();
  const sim = st.sim;
  const w = sim.world;
  const [ageWidth, setAgeWidth] = useState(5);
  const [group, setGroup] = useState<Grouping>('none');
  const [pool, setPool] = useState({ seeds: 16, years: 10 });
  const [job, setJob] = useState<{ id: string; status: string; done: number; total: number; error?: string; export?: CommunityExport | null } | null>(null);
  const years = (lastCountedDay(w) / 365.25).toFixed(1);
  const runPool = async () => {
    const r = await fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'experience', base: provinceBase(), mortality: store.params.mortalityOverride, shocks: store.params.shocks, seeds: pool.seeds, years: pool.years, ageWidth, group }) });
    const j = await r.json();
    if (!r.ok) {
      setJob({ id: '', status: 'error', done: 0, total: 0, error: j.error });
      return;
    }
    setJob(j);
    const t = setInterval(async () => {
      const s = await (await fetch(`/api/exports/${j.id}`)).json();
      setJob(s);
      if (s.status !== 'running') clearInterval(t);
    }, 1500);
  };
  const supplied = sim.params.mortalityOverride;
  const preset = buildQxTable(presetById(sim.params.mortalityPreset));
  return (
    <>
      <Viz title="Scelo" note={B.connected ? `linked · ${B.host}` : B.embedded ? 'waiting for Scelo…' : 'on its own page'} wide>
        <div className="small">
          {B.connected
            ? 'Linked to Scelo. What you send lands in Soft Data as the dataset (Tools routes it to the models that fit it) or, with a workspace open, as files Python and R can read. A basis Scelo fits, or a stress it asks for, arrives here.'
            : B.embedded
              ? 'Inside a page that has not answered yet. Exports download meanwhile.'
              : 'Community Lab on a page of its own: every export downloads, with its provenance. Open it from Scelo IDE (the "community lab" link at the top right) to send data straight into the pipeline, and take bases and stresses back.'}
        </div>
        <div className="muted small">
          Every export carries the seed, the basis hash {w.basisHash}, what was changed from the defaults, and the simulated span; experience carries the true basis it was generated on, so a fitted table can be scored against the answer.
        </div>
      </Viz>
      <Viz title="Mortality experience" note={`${years} years of this province`} wide>
        <div className="small">Deaths and person-years by calendar year, age and sex (and, if you like, city, settlement or wealth tier), rebuilt person by person, with the deaths expected on the true basis beside them. For Lee–Carter, CBD, a life table, A/E.</div>
        <div className="row wrap small">
          <span className="muted">Ages</span>
          <div className="chipset">
            {[1, 5].map((a) => (
              <button key={a} type="button" className={`chip ${ageWidth === a ? 'on' : ''}`} onClick={() => setAgeWidth(a)}>
                {a === 1 ? 'single' : '5-year bands'}
              </button>
            ))}
          </div>
          <span className="muted">by</span>
          <div className="chipset">
            {(['none', 'city', 'settlement', 'tier'] as Grouping[]).map((g) => (
              <button key={g} type="button" className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
                {g === 'none' ? 'province' : g}
              </button>
            ))}
          </div>
        </div>
        <Actions label="experience" make={() => experienceExport(experienceCells(store.sim, { ageWidth, group }), { truth: trueBasis(store.sim), provenance: provenance(), ageWidth, group: group === 'none' ? null : group })} />
        <div className="small lab-pool">
          <b>One province is about 400 people,</b>
          <span className="muted"> a handful of deaths a year. For a period model, pool seeds: the same basis lived {pool.seeds} times on the server.</span>
          <div className="row wrap">
            <label className="row">Seeds <input className="lab-num" type="number" min={1} max={64} value={pool.seeds} onChange={(e) => setPool({ ...pool, seeds: Math.max(1, Math.min(64, Math.round(Number(e.target.value)))) })} /></label>
            <label className="row">Years <input className="lab-num" type="number" min={1} max={40} value={pool.years} onChange={(e) => setPool({ ...pool, years: Math.max(1, Math.min(40, Math.round(Number(e.target.value)))) })} /></label>
            <button type="button" onClick={() => void runPool()} disabled={job?.status === 'running' || pool.seeds * pool.years > MAX_SEED_YEARS}>Pool on the server</button>
            <span className="muted">{pool.seeds * pool.years > MAX_SEED_YEARS ? <span className="err">at most {MAX_SEED_YEARS} province-years</span> : `about ${Math.max(1, Math.round((Math.ceil(pool.seeds / 8) * pool.years * 10) / 60))} min`}</span>
            {job?.status === 'running' && <span className="muted">{job.done}/{job.total}</span>}
            {job?.error && <span className="err">{job.error}</span>}
          </div>
          {job?.status === 'running' && <div className="progress"><i style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} /></div>}
          {job?.status === 'done' && job.export && (
            <>
              <div className="small">{job.export.headline?.map((h) => `${h.label} ${h.value}`).join(' · ')}</div>
              <Actions label="pooled experience" make={() => job.export as CommunityExport} />
            </>
          )}
        </div>
      </Viz>
      <Viz title="Who dies: the person-year panel" note="with the deaths register" wide>
        <div className="small">Every resident, year by year, with their circumstances, and death_event as the outcome. Scelo's GBM and SHAP should rediscover what the simulation knows drives risk (it is listed in the true basis); a Poisson GLM with log(person_years) as the offset estimates it properly.</div>
        <Actions label="person-year panel" make={() => personYearsExport(personYearRows(store.sim), { truth: trueBasis(store.sim), provenance: provenance() })} />
      </Viz>
      <Viz title="The burial society's book" note="lifelib model points" wide>
        <div className="small">The society's in-force covers as model points (age_at_entry, sex, sum_assured, policy_term, duration_mth, premium_pp): value them with lifelib in Scelo and set the answer beside Community Lab's own pricing in its Actuarial workbench.</div>
        <Actions label="model points" make={() => modelPointsExport(modelPointRows(store.sim), { provenance: provenance(), asAt: calendarForDay(store.sim.ctx.startMs, lastCountedDay(store.sim.world)).isoDate })} />
      </Viz>
      <Viz title="The economy, month by month" note={`${w.finance?.macro.months.length ?? 0} months`} wide>
        <div className="small">Prices, the repo rate the province's MPC set, output, jobs, inequality, the fiscus, the bank, oil and the rand: a series to fit a forecast to, then run the province on and see what happened.</div>
        <Actions label="economy" make={() => macroExport(macroRows(store.sim), { provenance: provenance() })} />
      </Viz>
      <Viz
        title="From Scelo"
        note={supplied ? 'living on a supplied basis' : sim.params.shocks?.length ? 'under stress' : 'nothing applied'}
        wide
        summary={
          supplied ? (
            <Mini
              option={miniXY(
                th,
                [
                  { name: supplied.label, data: sim.ctx.qx.M.slice(0, 101).map((q, x) => [x, Math.max(0.01, q * 1000)] as [number, number]), color: th.categorical[0] },
                  { name: MORTALITY_PRESETS.find((p) => p.id === sim.params.mortalityPreset)?.label ?? 'preset', data: preset.M.slice(0, 101).map((q, x) => [x, Math.max(0.01, q * 1000)] as [number, number]), color: th.muted },
                ],
                { yLog: true, xFmt: (v) => `age ${Math.round(v)}`, yFmt: (v) => `${v < 1 ? v.toFixed(2) : Math.round(v)}‰`, xMin: 0, xMax: 100 },
              )}
              keys={[
                { label: `${supplied.label} (men)`, color: th.categorical[0] },
                { label: 'preset (men)', color: th.muted, mark: 'dash' },
                { label: 'source', value: supplied.source },
              ]}
            />
          ) : undefined
        }
        summaryLabel="history"
      >
        {supplied || sim.params.shocks?.length ? (
          <div className="small">
            {supplied && (
              <div>
                Basis: <b>{supplied.label}</b> <span className="muted">({supplied.source})</span>. A/E in the analytics is measured against it; every death channel follows it.
              </div>
            )}
            {sim.params.shocks?.map((s, i) => (
              <div key={i}>Shock: {shockLabel(s)}, from month {s.fromMonth}.</div>
            ))}
            <button type="button" className="ghost" onClick={() => clearOutsideInputs()}>Return to the preset basis and lift the shocks</button>
          </div>
        ) : (
          <div className="small muted">When Scelo fits a mortality table to this province's experience it can send it back: the province is rebuilt on it, and you can watch whether the basis Scelo inferred is the one the province lives by. Stresses arrive the same way.</div>
        )}
        {B.received.length > 0 && (
          <Tbl>
            <table>
              <thead>
                <tr><th>Received</th><th>From</th><th>What happened</th></tr>
              </thead>
              <tbody>
                {B.received.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.at).toLocaleTimeString('en-GB', { timeStyle: 'short' })} · {r.label}</td>
                    <td className="muted">{r.from}</td>
                    <td className={r.ok ? '' : 'err'}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tbl>
        )}
      </Viz>
    </>
  );
}
