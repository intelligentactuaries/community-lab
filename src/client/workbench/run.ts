// Running a file, by its kind:
//
//   province     parse, resolve its mortality table (a CSV in the workspace),
//                check every input against the engine's ranges, and rebuild
//                the province on it; the view switches to the province.
//   experiment   check the spec, put it on the server's worker pool, follow
//                its progress in the Console, keep the result in results/
//                and open it in the policy lab.
//   script       run it in a worker beside the editor (scriptWorker.ts),
//                its output in the Console; Stop terminates it and cancels
//                any job it started on the pool.
//
// Whatever is wrong is reported in the Problems list against the file (with a
// line where there is one) as well as in the Console, and nothing is
// half-applied: a province with a bad input is not rebuilt.

import type { ExperimentResult, MortalityOverride } from '../../shared/exchange';
import { fileKind, parseExperimentFile, parseJsonText, parseProvinceFile } from '../../shared/files';
import { mortalityFromCsv } from '../../shared/mortalityCsv';
import { lab } from '../lib/lab';
import { applyInputs } from '../lib/outside';
import { store } from '../lib/simStore';
import type { FromScript, ToScript } from './scriptApi';
import { saveExperimentToWorkspace, workspace } from './workspace';

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Run the active file (or `path`). Saves it first, so what runs is what is on disk. */
export async function runFile(path = workspace.state.active ?? ''): Promise<void> {
  const ws = workspace.state;
  if (!path || ws.running) return;
  const tab = ws.tabs.find((t) => t.path === path);
  if (!tab || tab.status !== 'ready') return;
  if (tab.text !== tab.saved) await workspace.save(path);
  const kind = fileKind(path);
  if (kind === 'province') return runProvince(path, tab.text);
  if (kind === 'experiment') return runExperiment(path, tab.text);
  if (kind === 'script') return runScript(path, tab.text);
  workspace.log('info', `${path} is not something to run: province, experiment and script files are (.province.json, .experiment.json, .js).`);
}

function fail(path: string, errors: string[], line?: number): void {
  workspace.setProblems(path, 'run', errors.map((message) => ({ severity: 'error', message, line })));
  for (const e of errors) workspace.log('error', `${path}: ${e}`);
  workspace.push({ kind: 'done', path, ms: 0, ok: false, text: 'Not run.' });
}

async function runProvince(path: string, text: string): Promise<void> {
  workspace.push({ kind: 'run', path, verb: `Running the province · ${stamp()}` });
  const t0 = performance.now();
  const parsed = parseJsonText(text);
  if (!parsed.ok) return fail(path, [parsed.error]);
  const file = parseProvinceFile(parsed.value);
  if (!file.ok) return fail(path, file.errors);
  const f = file.value;
  let mortality: MortalityOverride | undefined;
  if (typeof f.mortality === 'string') {
    try {
      const csv = await workspace.read(f.mortality);
      const label = f.mortality.split('/').pop()?.replace(/\.csv$/i, '') ?? f.mortality;
      const m = mortalityFromCsv(csv, label, `workspace: ${f.mortality}`);
      if (!m.ok) return fail(path, m.errors.map((e) => `mortality (${f.mortality}): ${e}`));
      mortality = m.value;
    } catch (e) {
      return fail(path, [`mortality: ${f.mortality} could not be read (${e instanceof Error ? e.message : String(e)})`]);
    }
  } else if (f.mortality) mortality = f.mortality;
  const res = applyInputs({ label: f.title ?? path, from: path, seed: f.seed, params: f.basis, mortality, shocks: f.shocks, over: 'defaults' });
  if (!res.ok) return fail(path, res.rejected.length ? res.rejected : [res.message]);
  const warnings = [...file.warnings, ...res.rejected.map((r) => `basis.${r}; left out`)];
  workspace.setProblems(path, 'run', warnings.map((message) => ({ severity: 'warning' as const, message })));
  for (const w of warnings) workspace.log('warn', w);
  workspace.log('info', `${res.message} Basis ${store.sim.world.basisHash}, ${Object.values(store.sim.world.people).filter((p) => p.alive && !p.emigrated).length} residents on ${store.cal().isoDate}.`);
  workspace.push({ kind: 'done', path, ms: Math.round(performance.now() - t0), ok: true, text: 'The province was rebuilt on it.' });
  workspace.push({ kind: 'action', text: 'The province is waiting, paused at its first morning.', label: 'Show the province', act: () => store.setView('province') });
  store.setView('province');
  store.say(`Rebuilt on ${path}`);
}

async function runExperiment(path: string, text: string): Promise<void> {
  workspace.push({ kind: 'run', path, verb: `Running the experiment · ${stamp()}` });
  const t0 = performance.now();
  const parsed = parseJsonText(text);
  if (!parsed.ok) return fail(path, [parsed.error]);
  const spec = parseExperimentFile(parsed.value);
  if (!spec.ok) return fail(path, spec.errors);
  workspace.setProblems(path, 'run', []);
  const s = spec.value;
  let job: { id: string; warnings?: string[] };
  try {
    const r = await fetch('/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
    const j = await r.json();
    if (!r.ok) return fail(path, [j.error ?? `HTTP ${r.status}`, ...(j.details ?? [])]);
    job = j;
  } catch (e) {
    return fail(path, [`the server did not answer: ${e instanceof Error ? e.message : String(e)}`]);
  }
  for (const w of job.warnings ?? []) workspace.log('warn', `Left out: ${w}`);
  // The lab shows the same experiment, and follows the same job.
  lab.open(s, path);
  lab.watch(job.id);
  let cancelled = false;
  workspace.setRunning({
    path,
    kind: 'experiment',
    startedAt: Date.now(),
    stop: () => {
      cancelled = true;
      void fetch(`/api/experiments/${job.id}`, { method: 'DELETE' });
    },
  });
  const label = `${s.title}: ${s.seeds} seeds × ${s.years} years × ${s.arms.length + 1} runs on the worker pool`;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = (await (await fetch(`/api/experiments/${job.id}`)).json()) as { status: string; done: number; total: number; error?: string; result: ExperimentResult | null };
      if (j.status === 'running' && !cancelled) {
        workspace.progress(job.id, label, j.done, j.total);
        continue;
      }
      if (j.status === 'done' && j.result) {
        workspace.progress(job.id, label, j.total, j.total, true);
        const r = j.result;
        const focus = (lab.state.draft.focus.length ? lab.state.draft.focus : r.metrics.map((m) => m.id)).slice(0, 6);
        const rows = r.arms.slice(1).flatMap((a) =>
          focus.map((id) => {
            const m = r.metrics.find((x) => x.id === id);
            const e = a.effects?.[id];
            return { arm: a.label, indicator: m?.label ?? id, baseline: r.arms[0].metrics[id]?.mean ?? null, effect: e?.mean ?? null, lo95: e?.lo ?? null, hi95: e?.hi ?? null };
          }),
        );
        workspace.push({ kind: 'table', rows, columns: ['arm', 'indicator', 'baseline', 'effect', 'lo95', 'hi95'] });
        let kept = '';
        try {
          kept = await saveExperimentToWorkspace(r, path);
          workspace.log('info', `Kept in ${kept}/: the runs and the effects as CSV, the result as JSON, and the spec.`);
        } catch (e) {
          workspace.log('warn', `The result is in the lab, but could not be saved to the workspace: ${e instanceof Error ? e.message : String(e)}`);
        }
        workspace.push({ kind: 'done', path, ms: Math.round(performance.now() - t0), ok: true, text: `Done in ${Math.round((r.elapsedMs ?? 0) / 1000)} s on the worker pool.` });
        workspace.push({
          kind: 'action',
          text: 'Every indicator, the forest of effects and the recent experiments are in the policy lab.',
          label: 'Open in the lab',
          act: () => {
            store.setView('province');
            store.openDrawer('lab');
          },
        });
        return;
      }
      workspace.progress(job.id, label, j.done, j.total, true);
      workspace.push({ kind: 'done', path, ms: Math.round(performance.now() - t0), ok: false, text: cancelled || j.status === 'cancelled' ? 'Stopped.' : `Failed: ${j.error ?? j.status}` });
      return;
    }
  } catch (e) {
    workspace.push({ kind: 'done', path, ms: Math.round(performance.now() - t0), ok: false, text: `Lost the job: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    workspace.setRunning(null);
  }
}

function runScript(path: string, code: string): Promise<void> {
  workspace.push({ kind: 'run', path, verb: `Running the script · ${stamp()}` });
  workspace.setProblems(path, 'run', []);
  const t0 = performance.now();
  const worker = new Worker(new URL('./scriptWorker.ts', import.meta.url), { type: 'module' });
  const jobs: Array<{ id: string; kind: string }> = [];
  return new Promise<void>((resolve) => {
    let over = false;
    const finish = (ok: boolean, text: string) => {
      if (over) return;
      over = true;
      worker.terminate();
      workspace.setRunning(null);
      workspace.push({ kind: 'done', path, ms: Math.round(performance.now() - t0), ok, text });
      resolve();
    };
    workspace.setRunning({
      path,
      kind: 'script',
      startedAt: Date.now(),
      stop: () => {
        for (const j of jobs) void fetch(j.kind === 'experiment' ? `/api/experiments/${j.id}` : `/api/exports/${j.id}`, { method: 'DELETE' });
        finish(false, 'Stopped.');
      },
    });
    worker.onmessage = (e: MessageEvent<FromScript>) => {
      const m = e.data;
      if (over) return;
      switch (m.type) {
        case 'log':
          workspace.log(m.level, m.text);
          break;
        case 'table':
          workspace.push({ kind: 'table', rows: m.rows, columns: m.columns });
          break;
        case 'plot':
          workspace.push({ kind: 'plot', spec: m.spec });
          break;
        case 'progress':
          workspace.progress(m.key, m.label, m.done, m.total, m.finished);
          break;
        case 'job':
          jobs.push({ id: m.id, kind: m.kind });
          break;
        case 'wrote':
          void workspace.refresh();
          break;
        case 'done':
          finish(true, 'Done.');
          break;
        case 'failed':
          workspace.log('error', m.line ? `${m.error} (line ${m.line})` : m.error);
          workspace.setProblems(path, 'run', [{ severity: 'error', message: m.error, line: m.line ?? undefined, col: m.col ?? undefined }]);
          finish(false, 'Failed.');
          break;
      }
    };
    worker.onerror = (e) => {
      workspace.log('error', `The script's worker failed: ${e.message || 'unknown error'}`);
      finish(false, 'Failed.');
    };
    worker.postMessage({ type: 'run', code, path } satisfies ToScript);
  });
}
