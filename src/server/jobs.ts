// The server's long jobs, each a set of engine runs on the worker pool:
//   experiments      every arm on every seed, summarised with paired effects
//   pooled exports   one basis on many seeds, its experience cells pooled
//   batches          the Monte Carlo tab's seeds (same rows as before, no longer blocking)
// A job is polled by id; finished experiments and exports are kept in sqlite.

import type { CommunityExport, ExperimentResult, ExperimentSpec, MortalityOverride, ParamPatch, Shock, TrueBasis } from '@scelo/core/exchange';
import { type BatchRow, type BatchSummary, aggregate } from '../sim/batch';
import { type ArmRun, experimentSeeds, summariseExperiment } from '../sim/experiment';
import { type ExperienceCell, type Grouping, poolCells } from '../sim/experience';
import type { ScenarioParams } from '../sim/params';
import { applyPatch, changedFromDefaults } from '../sim/patch';
import { APP_VERSION, experienceExport, provenanceFor } from '../shared/sceloExport';
import { saveBatch, saveExperiment, saveExport } from './db';
import { pool } from './pool';

export type JobKind = 'experiment' | 'export' | 'batch';
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  startedAt: number;
  error?: string;
  /** Rejected parameter changes, named, so the caller sees what was left out. */
  warnings: string[];
  result?: ExperimentResult | CommunityExport | BatchSummary;
}

const jobs = new Map<string, Job>();
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(kind?: JobKind): Job[] {
  return [...jobs.values()].filter((j) => !kind || j.kind === kind).sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') return false;
  j.status = 'cancelled';
  pool.cancel(id);
  return true;
}

/** Run `tasks`, ticking the job's progress; a failed task fails the job, a cancelled job stops waiting. */
async function runAll<T>(job: Job, tasks: Array<() => Promise<T>>): Promise<T[] | null> {
  job.total = tasks.length;
  const out: T[] = [];
  try {
    await Promise.all(
      tasks.map(async (t) => {
        const r = await t();
        out.push(r);
        job.done++;
      }),
    );
  } catch (e) {
    if (job.status === 'cancelled') return null;
    job.status = 'error';
    job.error = e instanceof Error ? e.message : String(e);
    pool.cancel(job.id);
    return null;
  }
  return job.status === 'cancelled' ? null : out;
}

// ─── experiments ────────────────────────────────────────────────────────

export function startExperiment(spec: ExperimentSpec): Job {
  const id = newId('x');
  const warnings = [...applyPatch({}, spec.base).rejected.map((r) => `base: ${r}`), ...spec.arms.flatMap((a) => applyPatch({}, a.params).rejected.map((r) => `${a.id}: ${r}`))];
  const job: Job = { id, kind: 'experiment', title: spec.title, status: 'running', done: 0, total: 0, startedAt: Date.now(), warnings };
  jobs.set(id, job);
  const seeds = experimentSeeds(spec);
  const arms = [null, ...spec.arms];
  const tasks = seeds.flatMap((seed) => arms.map((arm) => () => pool.run<ArmRun>({ kind: 'arm', spec: { base: spec.base, baseMortality: spec.baseMortality, baseShocks: spec.baseShocks, years: spec.years }, arm, seed }, id)));
  void runAll(job, tasks).then((runs) => {
    if (!runs) return;
    const result = summariseExperiment(id, spec, runs, Date.now() - job.startedAt, APP_VERSION);
    job.result = result;
    job.status = 'done';
    saveExperiment(id, spec.title, spec, result);
  });
  return job;
}

// ─── pooled experience exports ──────────────────────────────────────────

export interface PooledExportRequest {
  base?: ParamPatch;
  /** The basis and shocks the province lives under, when it lives under some (a basis Scelo sent). */
  mortality?: MortalityOverride;
  shocks?: Shock[];
  seeds: number;
  years: number;
  ageWidth: number;
  group: Grouping;
}

interface ExperienceTaskResult {
  cells: ExperienceCell[];
  truth: TrueBasis;
  basisHash: string;
  assumptionsHash: string;
  span: { from: string; to: string };
  ms: number;
}

export function startPooledExport(req: PooledExportRequest): Job {
  const id = newId('e');
  const { params, rejected } = applyPatch({}, req.base);
  if (req.mortality) params.mortalityOverride = req.mortality;
  if (req.shocks?.length) params.shocks = req.shocks;
  const job: Job = { id, kind: 'export', title: `Mortality experience · ${req.seeds} seeds × ${req.years} years`, status: 'running', done: 0, total: 0, startedAt: Date.now(), warnings: rejected };
  jobs.set(id, job);
  const seeds = Array.from({ length: req.seeds }, (_, i) => `pool-${i + 1}`);
  const tasks = seeds.map((seed) => () => pool.run<ExperienceTaskResult>({ kind: 'experience', params, years: req.years, seed, ageWidth: req.ageWidth, group: req.group }, id));
  void runAll(job, tasks).then((runs) => {
    if (!runs?.length) return;
    const first = runs[0];
    const exp = experienceExport(poolCells(runs.map((r) => r.cells)), {
      truth: first.truth,
      ageWidth: req.ageWidth,
      group: req.group === 'none' ? null : req.group,
      provenance: provenanceFor({
        span: first.span,
        seeds: req.seeds,
        assumptionsHash: first.assumptionsHash,
        scenario: 'Pooled Monte Carlo experience',
        changed: changedFromDefaults(params as Partial<ScenarioParams>),
        notes: [`Seeds pool-1 … pool-${req.seeds}, ${req.years} years each, one basis (assumptions ${first.assumptionsHash}).`, ...rejected.map((r) => `Left out: ${r}`)],
      }),
    });
    job.result = exp;
    job.status = 'done';
    saveExport(id, exp.title, exp);
  });
  return job;
}

// ─── the Monte Carlo tab's batches ──────────────────────────────────────

export function startBatch(params: Partial<ScenarioParams>, years: number, n: number, onDone: (id: string, s: BatchSummary) => void): Job {
  const id = newId('b');
  const job: Job = { id, kind: 'batch', title: `Monte Carlo · ${n} seeds × ${years} years`, status: 'running', done: 0, total: 0, startedAt: Date.now(), warnings: [] };
  jobs.set(id, job);
  const seeds = Array.from({ length: n }, (_, i) => `mc-${i + 1}`);
  const tasks = seeds.map((seed) => () => pool.run<{ row: BatchRow; basisHash: string }>({ kind: 'batch', params, years, seed }, id));
  void runAll(job, tasks).then((out) => {
    if (!out) return;
    // Rows in seed order, as the old sequential batch gave them.
    const rows = out.map((o) => o.row).sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
    const summary = aggregate(rows, years, out[out.length - 1]?.basisHash ?? '');
    job.result = summary;
    job.status = 'done';
    saveBatch(id, { params, years, seeds: n }, summary);
    onDone(id, summary);
  });
  return job;
}

export { APP_VERSION };
