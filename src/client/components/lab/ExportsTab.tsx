// Exports: the province's data out, each table with its data dictionary and
// its provenance (seed, basis hash, what was changed from the defaults, the
// simulated span), and synthetic experience with the true basis it was made
// on, so a table fitted to it can be scored against the answer. Each export
// saves as CSV or as one JSON file (the scelo.exchange/1 layout, which other
// tools, Scelo IDE among them, can read), or into the open workspace as a
// folder: every table as CSV, a README and the true basis.
//
// And the way in: a mortality table fitted elsewhere, imported as CSV, to
// live the province on, with the way back to the preset.

import { useRef, useState } from 'react';
import { type CommunityExport, MAX_SEED_YEARS, tableCsv } from '../../../shared/exchange';
import { experienceExport, macroExport, modelPointsExport, personYearsExport, provenanceFor } from '../../../shared/exports';
import { experienceCells, lastCountedDay, macroRows, modelPointRows, personYearRows, trueBasis, type Grouping } from '../../../sim/experience';
import { MORTALITY_PRESETS, buildQxTable, presetById } from '../../../sim/mortality';
import { assumptionsHash } from '../../../sim/params';
import { changedFromDefaults } from '../../../sim/patch';
import { shockLabel } from '../../../sim/shocks';
import { calendarForDay } from '../../../sim/time';
import { Mini, Tbl, Viz } from '../../charts/helpers';
import { miniXY } from '../../charts/mini';
import { chartTheme } from '../../charts/theme';
import { provinceBase } from '../../lib/lab';
import { applyInputs, clearOutsideInputs, mortalityFromCsv } from '../../lib/outside';
import { store, useStore } from '../../lib/simStore';
import { saveExportToWorkspace, useWorkspace } from '../../workbench/workspace';

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

export function downloadText(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Save / download buttons for one export, built when pressed (the province keeps moving). */
export function ExportActions({ make, label }: { make: () => CommunityExport; label: string }) {
  const ws = useWorkspace();
  const [last, setLast] = useState<{ text: string; err?: boolean } | null>(null);
  const toWorkspace = async () => {
    try {
      const e = make();
      const dir = await saveExportToWorkspace(e);
      setLast({ text: `Saved ${e.tables.length} table${e.tables.length === 1 ? '' : 's'}, a README and the export's JSON to ${dir}/ in the workspace.` });
    } catch (err) {
      setLast({ text: err instanceof Error ? err.message : String(err), err: true });
    }
  };
  return (
    <>
      <div className="row wrap">
        {ws.root && (
          <button type="button" className="primary" onClick={() => void toWorkspace()} title={`Every table as CSV, a README with the provenance and the data dictionary, and the ${label} as JSON, in a folder of the open workspace`}>
            Save to workspace
          </button>
        )}
        <button
          type="button"
          className={ws.root ? 'ghost' : ''}
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
          title="The whole export (every table, the provenance, the true basis) as one JSON file in the scelo.exchange/1 layout"
          onClick={() => {
            const e = make();
            downloadText(`${e.tables[0].name}.json`, JSON.stringify(e), 'application/json');
          }}
        >
          JSON
        </button>
      </div>
      {last && <div className={`small ${last.err ? 'err' : 'muted'}`}>{last.text}</div>}
    </>
  );
}

export function ExportsTab() {
  const st = useStore();
  const th = chartTheme();
  const sim = st.sim;
  const w = sim.world;
  const [ageWidth, setAgeWidth] = useState(5);
  const [group, setGroup] = useState<Grouping>('none');
  const [pool, setPool] = useState({ seeds: 16, years: 10 });
  const [job, setJob] = useState<{ id: string; status: string; done: number; total: number; error?: string; export?: CommunityExport | null } | null>(null);
  const [importMsg, setImportMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
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
  const importTable = async (f: File) => {
    const label = f.name.replace(/\.(csv|txt)$/i, '');
    const parsed = mortalityFromCsv(await f.text(), label, `imported from ${f.name} · ${new Date().toISOString().slice(0, 10)}`);
    if (!parsed.ok) {
      setImportMsg({ text: `${f.name}: ${parsed.errors.join('; ')}`, err: true });
      return;
    }
    const res = applyInputs({ label, from: f.name, mortality: parsed.value, shocks: store.params.shocks });
    setImportMsg({ text: res.message, err: !res.ok });
  };
  const supplied = sim.params.mortalityOverride;
  const preset = buildQxTable(presetById(sim.params.mortalityPreset));
  return (
    <>
      <Viz title="Exports" note={`basis ${w.basisHash}`} wide>
        <div className="small">
          The province's data out, each table with its data dictionary. Save it as CSV or as one JSON file, or into the open workspace as a folder of CSVs with a README. Every export carries the seed, the basis hash {w.basisHash}, what was changed from the defaults and the simulated span; experience carries the true basis it was generated on, so a fitted table can be scored against the answer.
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
        <ExportActions label="experience" make={() => experienceExport(experienceCells(store.sim, { ageWidth, group }), { truth: trueBasis(store.sim), provenance: provenance(), ageWidth, group: group === 'none' ? null : group })} />
        <div className="small lab-pool">
          <b>One province is about 400 people,</b>
          <span className="muted"> a handful of deaths a year. For a period model, pool seeds: the same basis lived {pool.seeds} times on the worker pool.</span>
          <div className="row wrap">
            <label className="row">Seeds <input className="lab-num" type="number" min={1} max={64} value={pool.seeds} onChange={(e) => setPool({ ...pool, seeds: Math.max(1, Math.min(64, Math.round(Number(e.target.value)))) })} /></label>
            <label className="row">Years <input className="lab-num" type="number" min={1} max={40} value={pool.years} onChange={(e) => setPool({ ...pool, years: Math.max(1, Math.min(40, Math.round(Number(e.target.value)))) })} /></label>
            <button type="button" onClick={() => void runPool()} disabled={job?.status === 'running' || pool.seeds * pool.years > MAX_SEED_YEARS}>Pool on the worker pool</button>
            <span className="muted">{pool.seeds * pool.years > MAX_SEED_YEARS ? <span className="err">at most {MAX_SEED_YEARS} province-years</span> : `about ${Math.max(1, Math.round((Math.ceil(pool.seeds / 8) * pool.years * 10) / 60))} min`}</span>
            {job?.status === 'running' && <span className="muted">{job.done}/{job.total}</span>}
            {job?.error && <span className="err">{job.error}</span>}
          </div>
          {job?.status === 'running' && <div className="progress"><i style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} /></div>}
          {job?.status === 'done' && job.export && (
            <>
              <div className="small">{job.export.headline?.map((h) => `${h.label} ${h.value}`).join(' · ')}</div>
              <ExportActions label="pooled experience" make={() => job.export as CommunityExport} />
            </>
          )}
        </div>
      </Viz>
      <Viz title="Who dies: the person-year panel" note="with the deaths register" wide>
        <div className="small">Every resident, year by year, with their circumstances, and death_event as the outcome. A gradient-boosted model with SHAP should rediscover what the simulation knows drives risk (it is listed in the true basis); a Poisson GLM with log(person_years) as the offset estimates it properly.</div>
        <ExportActions label="person-year panel" make={() => personYearsExport(personYearRows(store.sim), { truth: trueBasis(store.sim), provenance: provenance() })} />
      </Viz>
      <Viz title="The burial society's book" note="model points" wide>
        <div className="small">The society's in-force covers as model points (age_at_entry, sex, sum_assured, policy_term, duration_mth, premium_pp), the columns lifelib's BasicTerm models read: value them in Python or any projection engine and set the answer beside the society's own pricing in the Actuarial workbench.</div>
        <ExportActions label="model points" make={() => modelPointsExport(modelPointRows(store.sim), { provenance: provenance(), asAt: calendarForDay(store.sim.ctx.startMs, lastCountedDay(store.sim.world)).isoDate })} />
      </Viz>
      <Viz title="The economy, month by month" note={`${w.finance?.macro.months.length ?? 0} months`} wide>
        <div className="small">Prices, the repo rate the province's MPC set, output, jobs, inequality, the fiscus, the bank, oil and the rand: a series to fit a forecast to, then run the province on and see what happened.</div>
        <ExportActions label="economy" make={() => macroExport(macroRows(store.sim), { provenance: provenance() })} />
      </Viz>
      <Viz
        title="Supplied basis"
        note={supplied ? 'living on a supplied basis' : sim.params.shocks?.length ? 'under stress' : 'the preset basis'}
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
          <div className="small muted">Fit a mortality table to this province's experience (or bring any other) and live the province on it: the province is rebuilt on the table, every death channel follows it, and you can watch whether the basis you inferred is the one the province lives by. A CSV with an age column and qx_m and qx_f (or a pooled qx), as probabilities or per mille.</div>
        )}
        <div className="row wrap">
          <button type="button" onClick={() => fileRef.current?.click()}>Import a mortality table (CSV)</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importTable(f);
            }}
          />
          {importMsg && <span className={`small ${importMsg.err ? 'err' : 'muted'}`}>{importMsg.text}</span>}
        </div>
        {supplied && (
          <Tbl>
            <table>
              <thead>
                <tr><th className="n">Age</th><th className="n">Supplied q (men)</th><th className="n">Preset q (men)</th><th className="n">Supplied q (women)</th><th className="n">Preset q (women)</th></tr>
              </thead>
              <tbody>
                {[0, 1, 5, 20, 40, 60, 70, 80, 90].map((x) => (
                  <tr key={x}>
                    <td className="n">{x}</td>
                    <td className="n">{(sim.ctx.qx.M[x] * 1000).toFixed(2)}‰</td>
                    <td className="n muted">{(preset.M[x] * 1000).toFixed(2)}‰</td>
                    <td className="n">{(sim.ctx.qx.F[x] * 1000).toFixed(2)}‰</td>
                    <td className="n muted">{(preset.F[x] * 1000).toFixed(2)}‰</td>
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
