// The policy & stress lab: ask the province a question as an experiment —
// a template for actuaries, governments or social developers, or a basis or
// stress Scelo sent — run every arm on the same seeds on the server, read the
// effects with their intervals, and hand the result on: to Scelo as data, or
// to the swarm's council with the province's residents as its society.

import { MAX_SEED_YEARS, type MetricDef, seedYears, tableCsv } from '@scelo/core/exchange';
import { useEffect } from 'react';
import { DEFAULT_PARAMS } from '../../../sim/params';
import { shockLabel } from '../../../sim/shocks';
import { experimentExport } from '../../../shared/sceloExport';
import { TEMPLATES } from '../../../shared/templates';
import { forestOption, type ForestRow } from '../../charts/lab';
import { EChart } from '../../charts/EChart';
import { Tbl, Viz } from '../../charts/helpers';
import { chartTheme } from '../../charts/theme';
import { lab, useLab } from '../../lib/lab';
import { bridge, useBridge } from '../../lib/sceloBridge';

const AUDIENCES: Array<{ id: 'actuarial' | 'government' | 'social'; label: string }> = [
  { id: 'actuarial', label: 'Actuaries' },
  { id: 'government', label: 'Governments' },
  { id: 'social', label: 'Social development' },
];

/** Seconds a simulated year takes one of the server's workers with the whole pool busy (measured: a province of
 *  ~400 people, eight workers on an eight-core laptop), for the estimate before a run. */
const SECONDS_PER_WORKER_YEAR = 10;
const WORKERS = 8;

export function fmtMetric(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'share') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'R') {
    const a = Math.abs(v);
    return `${v < 0 ? '−' : ''}${a >= 1e6 ? `R${(a / 1e6).toFixed(2)}m` : `R${Math.round(a).toLocaleString('en-GB')}`}`;
  }
  if (unit === '0/1') return v.toFixed(2);
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-GB');
  return v.toFixed(Math.abs(v) >= 10 ? 1 : 3);
}

function signed(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtMetric(Math.abs(v), unit)}`;
}

export function LabTab() {
  const L = useLab();
  const B = useBridge();
  const th = chartTheme();
  const d = L.draft;
  useEffect(() => {
    void lab.refreshRecent();
  }, []);
  const running = L.job?.status === 'running';
  const runs = d.seeds * (d.arms.length + 1);
  const estimate = Math.ceil(runs / WORKERS) * d.years * SECONDS_PER_WORKER_YEAR;
  const cost = seedYears(d.seeds, d.years, d.arms.length + 1);
  const tooBig = cost > MAX_SEED_YEARS;
  const r = L.result;
  const metric = (id: string): MetricDef | undefined => r?.metrics.find((m) => m.id === id);
  const shown = r ? [...d.focus.filter((id) => metric(id)), ...r.metrics.map((m) => m.id).filter((id) => !d.focus.includes(id))] : [];
  const forest: ForestRow[] = r
    ? r.arms.slice(1).flatMap((a, ai) =>
        d.focus
          .map((id) => {
            const m = metric(id);
            const e = a.effects?.[id];
            const base = r.arms[0].metrics[id]?.mean;
            if (!m || !e || !Number.isFinite(e.mean) || !Number.isFinite(base) || base === 0) return null;
            const rel = (x: number) => (100 * x) / Math.abs(base);
            return { label: r.arms.length > 2 ? `${m.label} · ${a.label}` : m.label, est: rel(e.mean), lo: rel(e.lo), hi: rel(e.hi), color: th.categorical[ai % th.categorical.length], tip: `${a.label}: ${signed(e.mean, m.unit)} (95% ${signed(e.lo, m.unit)} to ${signed(e.hi, m.unit)})` } satisfies ForestRow;
          })
          .filter((x): x is ForestRow => x !== null),
      )
    : [];
  const send = (to: 'soft-data' | 'workspace') => {
    if (!r) return;
    bridge.send(experimentExport(r), to);
    bridge.fact(`community:experiment:${r.id}`, `Community Lab · ${r.spec.title}`, `${r.spec.seeds} seeds × ${r.spec.years} years, every arm paired with the baseline`);
  };
  const download = () => {
    if (!r) return;
    const e = experimentExport(r);
    const blob = new Blob([tableCsv(e.tables[0])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `community-experiment-${r.id}.csv`;
    a.click();
  };
  return (
    <>
      <Viz title="Ask the province a question" note="a template, or a basis or stress from Scelo" wide>
        {AUDIENCES.map((au) => (
          <div key={au.id} className="lab-audience">
            <span className="panel-label">{au.label}</span>
            <div className="chipset">
              {TEMPLATES.filter((t) => t.audience === au.id).map((t) => (
                <button key={t.id} type="button" className={`chip ${d.templateId === t.id ? 'on' : ''}`} title={t.question} onClick={() => lab.pickTemplate(t.id)}>
                  {t.title}
                </button>
              ))}
            </div>
          </div>
        ))}
        {d.fromScelo && <div className="small lab-from">From Scelo: {d.fromScelo}</div>}
      </Viz>
      <Viz title={d.title || 'The experiment'} note={`${runs} runs of ${d.years} years`} wide>
        <label className="lab-field">
          <span className="muted small">Question</span>
          <textarea rows={2} value={d.question} onChange={(e) => lab.setDraft({ question: e.target.value })} />
        </label>
        {d.arms.map((a) => (
          <div key={a.id} className="lab-arm">
            <b>{a.label}</b>
            {Object.entries(a.params ?? {}).map(([k, v]) =>
              typeof v === 'number' ? (
                <label key={k} className="row small">
                  <span className="muted">{k}</span>
                  <input type="number" value={v} step="any" onChange={(e) => lab.setArmParam(a.id, k, Number(e.target.value))} />
                  {typeof (DEFAULT_PARAMS as unknown as Record<string, unknown>)[k] === 'number' && <span className="muted">default {(DEFAULT_PARAMS as unknown as Record<string, number>)[k]}</span>}
                </label>
              ) : (
                <span key={k} className="muted small">
                  {k}: {JSON.stringify(v)}
                </span>
              ),
            )}
            {a.mortality && <span className="small">Mortality basis: {a.mortality.label} <span className="muted">({a.mortality.source})</span></span>}
            {a.shocks?.map((s, i) => (
              <span key={i} className="small">Shock: {shockLabel(s)}{s.fromMonth ? `, from month ${s.fromMonth}` : ''}</span>
            ))}
          </div>
        ))}
        <div className="row wrap">
          <label className="row small">Seeds <input className="lab-num" type="number" min={2} max={64} value={d.seeds} onChange={(e) => lab.setDraft({ seeds: Math.max(2, Math.min(64, Math.round(Number(e.target.value)))) })} /></label>
          <label className="row small">Years <input className="lab-num" type="number" min={1} max={40} value={d.years} onChange={(e) => lab.setDraft({ years: Math.max(1, Math.min(40, Math.round(Number(e.target.value)))) })} /></label>
          <label className="row small" title="Start every arm from this province's own parameters (as changed in the Scenario panel) rather than the defaults">
            <input type="checkbox" checked={d.fromProvince} onChange={(e) => lab.setDraft({ fromProvince: e.target.checked })} /> from this province's basis
          </label>
          <span className="grow" />
          {running ? (
            <button type="button" onClick={() => void lab.cancel()}>Cancel</button>
          ) : (
            <button type="button" className="primary" onClick={() => void lab.run()} disabled={!d.arms.length || tooBig}>
              Run on the server
            </button>
          )}
        </div>
        <div className="muted small">
          Every arm runs on the same {d.seeds} seeds as the baseline (common random numbers), so each effect is a paired difference with a 95% interval. About {estimate < 90 ? `${estimate} s` : `${Math.round(estimate / 60)} min`} on the server's worker pool; the province here keeps running meanwhile.
        </div>
        {tooBig && (
          <div className="small err">
            {cost.toLocaleString('en-GB')} province-years (seeds × years × runs); a job may ask for at most {MAX_SEED_YEARS}. Fewer seeds, years or arms.
          </div>
        )}
        {L.job && (
          <>
            {running && <div className="progress"><i style={{ width: `${(L.job.done / Math.max(1, L.job.total)) * 100}%` }} /></div>}
            <div className="small">
              {running ? `${L.job.done} of ${L.job.total} runs` : L.job.status === 'done' ? `Done in ${Math.round((r?.elapsedMs ?? 0) / 1000)} s.` : L.job.status === 'cancelled' ? 'Cancelled.' : <span className="err">{L.job.error}</span>}
            </div>
            {L.job.warnings.map((w) => (
              <div key={w} className="small err">Left out: {w}</div>
            ))}
          </>
        )}
      </Viz>
      {r && (
        <Viz title="Effects against the baseline" note="relative to the baseline's mean, 95% intervals" size="wide" empty={!forest.length && 'No effect could be measured over this horizon.'}>
          <EChart option={forestOption(th, forest)} />
        </Viz>
      )}
      {r && (
        <Viz title="Every indicator" note={`${r.spec.seeds} seeds × ${r.spec.years} years · assumptions ${r.provenance.assumptionsHash ?? '—'}`} wide>
          <Tbl>
            <table>
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th className="n">Baseline</th>
                  {r.arms.slice(1).map((a) => (
                    <th key={a.id} className="n" colSpan={2}>{a.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((id) => {
                  const m = metric(id) as MetricDef;
                  return (
                    <tr key={id} title={m.description}>
                      <td>{m.label}</td>
                      <td className="n">{fmtMetric(r.arms[0].metrics[id]?.mean, m.unit)}</td>
                      {r.arms.slice(1).map((a) => {
                        const e = a.effects?.[id];
                        const clear = e && Number.isFinite(e.lo) && (e.lo > 0 || e.hi < 0);
                        return [
                          <td key={`${a.id}-e`} className="n">
                            {e && Number.isFinite(e.mean) ? <span className={clear ? '' : 'muted'}>{signed(e.mean, m.unit)}</span> : '—'}
                            {e && Number.isFinite(e.lo) && <span className="muted small"> [{signed(e.lo, m.unit)}, {signed(e.hi, m.unit)}]</span>}
                          </td>,
                          <td key={`${a.id}-b`} className="n muted small">{e?.better === null || e?.better === undefined ? '' : `better ${Math.round(e.better * e.n)}/${e.n}`}</td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Tbl>
          <div className="muted small">An effect whose interval crosses zero is shown faint: on these seeds it cannot be told from the province's own randomness. More seeds narrow every interval.</div>
        </Viz>
      )}
      {r && (
        <Viz title="Hand it on" note={B.connected ? 'to Scelo and the swarm' : 'download, or open Community Lab from Scelo IDE'} wide>
          <div className="row wrap">
            {B.connected && (
              <button type="button" className="primary" onClick={() => send('soft-data')} title="The runs (a row per seed and arm) become Scelo's dataset; the effects travel with them">
                Send to Scelo
              </button>
            )}
            {B.connected && B.canSaveToWorkspace && (
              <button type="button" onClick={() => send('workspace')} title="CSV files, a README and the experiment's JSON in the open workspace, for Python and R">
                Save to workspace
              </button>
            )}
            <button type="button" className="ghost" onClick={download}>Download CSV</button>
            {B.swarmApi && (
              <button type="button" onClick={() => void lab.askCouncil(B.swarmApi as string)} disabled={L.council?.status === 'running'} title="The swarm's council weighs this evidence; the province's own residents react as its society">
                Ask the council
              </button>
            )}
          </div>
          {L.council && (
            <div className="lab-council">
              <div className={`small ${L.council.status === 'error' ? 'err' : ''}`}>{L.council.message}</div>
              {L.council.summary && (
                <div className="small">
                  Trust the evidence <b>{Math.round(L.council.summary.trust)}%</b> · distrust <b>{Math.round(L.council.summary.distrust)}%</b> · uncertain <b>{Math.round(L.council.summary.uncertain)}%</b>
                  {L.council.summary.risks.length > 0 && <div className="muted">Risks raised: {L.council.summary.risks.join(' · ')}</div>}
                  {L.council.summary.society && <div className="muted">The residents: {L.council.summary.society}</div>}
                </div>
              )}
              {L.council.runId && B.connected && (
                <button type="button" className="ghost" onClick={() => bridge.openSwarm(L.council?.runId ?? undefined)}>
                  Open the deliberation in the swarm
                </button>
              )}
            </div>
          )}
        </Viz>
      )}
      <Viz title="Recent experiments" note="kept on the server" empty={!L.recent.length && 'Experiments you run are kept here.'}>
        <Tbl>
          <table>
            <tbody>
              {L.recent.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => void lab.load(x.id)}>
                  <td>{x.title}</td>
                  <td className="n muted small">{new Date(x.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
    </>
  );
}
