/// <reference lib="webworker" />
// Where a workbench script runs: a Web Worker beside the editor, with the
// engine in it (a province of the script's own, built and lived here) and the
// server's worker pool a fetch away (experiments, Monte Carlo, pooled
// experience). A script is the body of an async function whose parameters
// are the API below, so its globals are exactly the documented ones
// (scriptApi.ts) and nothing of the page's. Stop terminates the worker.

import { type ExperimentSpec, MAX_EXPERIMENT_SEEDS, parseExperimentSpec, type Shock, type MortalityOverride } from '../../shared/exchange';
import { mortalityFromCsv } from '../../shared/mortalityCsv';
import { TEMPLATES, TEMPLATE_BY_ID } from '../../shared/templates';
import { alivePeople } from '../../sim/ctx';
import { Simulation } from '../../sim/engine';
import { experienceCells, type Grouping } from '../../sim/experience';
import { METRICS, indicators } from '../../sim/experiment';
import { DEFAULT_PARAMS, type ScenarioParams } from '../../sim/params';
import { applyPatch } from '../../sim/patch';
import { communityOfPerson } from '../../sim/population';
import { DAYS_PER_YEAR, calendarForDay } from '../../sim/time';
import { CITY, COMMUNITY, cityOf, tierOf } from '../../sim/world';
import { type FromScript, SCRIPT_PRELUDE, type ToScript } from './scriptApi';
import type { PlotSpec, Row } from './workspace';

declare const self: DedicatedWorkerGlobalScope;

const post = (m: FromScript) => self.postMessage(m);

// ── output ──────────────────────────────────────────────────────────────

/** A value as the Console shows it: strings as they are, numbers rounded sensibly, objects as indented JSON. */
function show(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return fmtNum(v);
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
  const seen = new WeakSet<object>();
  try {
    const s = JSON.stringify(
      v,
      (_k, x) => {
        if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
        if (typeof x === 'bigint') return `${x}n`;
        if (x && typeof x === 'object') {
          if (seen.has(x)) return '[circular]';
          seen.add(x);
        }
        return x;
      },
      2,
    );
    return s.length > 20_000 ? `${s.slice(0, 20_000)}\n… (${(s.length / 1000).toFixed(0)}k characters; print a part of it)` : s;
  } catch {
    return String(v);
  }
}

function fmtNum(v: number): string {
  if (Number.isNaN(v)) return 'NaN (no estimate)';
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-GB');
  const a = Math.abs(v);
  return a >= 1000 ? v.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : a >= 1 ? v.toFixed(3).replace(/\.?0+$/, '') : v.toPrecision(4);
}

const MAX_ROWS = 2000;

function tableOf(rows: unknown, columns?: string[]): { rows: Row[]; columns: string[] } {
  if (!Array.isArray(rows)) throw new TypeError('table() takes a list of rows (objects)');
  const objs: Row[] = rows.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Row) : { value: r }));
  const cols = columns?.length ? columns : [...new Set(objs.slice(0, 200).flatMap((r) => Object.keys(r)))];
  const clean = objs.slice(0, MAX_ROWS).map((r) => {
    const o: Row = {};
    for (const c of cols) {
      const x = r[c];
      o[c] = x === null || x === undefined || typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean' ? x : show(x);
    }
    return o;
  });
  return { rows: clean, columns: cols };
}

function csvOf(rows: unknown, columns?: string[]): string {
  const t = tableOf(Array.isArray(rows) ? rows : [], columns);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // csv() writes every row, not the table's first MAX_ROWS.
  const all = (Array.isArray(rows) ? rows : []) as Row[];
  return `${[t.columns.map(cell).join(','), ...all.map((r) => t.columns.map((c) => cell(r?.[c])).join(','))].join('\n')}\n`;
}

function plotOf(o: unknown): PlotSpec {
  if (!o || typeof o !== 'object') throw new TypeError('plot() takes { x, series }');
  const p = o as Partial<PlotSpec> & { series?: Record<string, unknown> };
  if (!Array.isArray(p.x)) throw new TypeError('plot(): x must be a list');
  if (!p.series || typeof p.series !== 'object') throw new TypeError('plot(): series must be { name: [values] }');
  const series: PlotSpec['series'] = {};
  for (const [name, ys] of Object.entries(p.series)) {
    if (!Array.isArray(ys)) throw new TypeError(`plot(): series "${name}" must be a list`);
    series[name] = ys.map((y) => (typeof y === 'number' && Number.isFinite(y) ? y : null));
  }
  return { x: p.x.map((x) => (typeof x === 'number' || typeof x === 'string' ? x : String(x))), series, title: p.title, xLabel: p.xLabel, yLabel: p.yLabel, log: !!p.log };
}

// ── the server ──────────────────────────────────────────────────────────

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, body === undefined ? { method: method ?? 'GET' } : { method: method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; details?: string[] };
  if (!r.ok) throw new Error([j.error ?? `${path}: HTTP ${r.status}`, ...(j.details ?? [])].join(': '));
  return j;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a job until it finishes, reporting its progress on one Console line. */
async function follow<T>(kind: 'experiment' | 'export' | 'batch', id: string, label: string, path: string, pick: (j: Record<string, unknown>) => T | null): Promise<T> {
  post({ type: 'job', id, kind });
  for (;;) {
    await sleep(1200);
    const j = await call<Record<string, unknown>>(path);
    const done = Number(j.done ?? 0);
    const total = Number(j.total ?? 0);
    if (j.status === 'running') {
      post({ type: 'progress', key: id, label, done, total });
      continue;
    }
    if (j.status === 'done') {
      post({ type: 'progress', key: id, label, done: total || done, total: total || done, finished: true });
      const v = pick(j);
      if (v === null) throw new Error(`${label}: finished without a result`);
      return v;
    }
    throw new Error(`${label}: ${j.error ?? j.status}`);
  }
}

// ── the API ─────────────────────────────────────────────────────────────

async function readFile(path: string): Promise<string> {
  const j = await call<{ text: string }>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
  return j.text;
}

async function writeFile(path: string, text: string): Promise<void> {
  if (typeof text !== 'string') throw new TypeError('writeFile(path, text): text must be a string (csv() makes one of rows)');
  await call('/api/workspace/file', { path, text }, 'PUT');
  post({ type: 'wrote', path });
}

let provinces = 0;

async function province(o: { seed?: string; basis?: Record<string, unknown>; mortality?: string | MortalityOverride; shocks?: Shock[] } = {}) {
  const { params, rejected } = applyPatch({}, (o.basis ?? {}) as never);
  for (const r of rejected) post({ type: 'log', level: 'warn', text: `province(): basis ${r}; left out` });
  // Nothing else is set: the same seed and basis as the IDE's province give the same province and the same hash.
  const P: Partial<ScenarioParams> = { ...params };
  if (o.seed !== undefined) P.seed = String(o.seed);
  if (typeof o.mortality === 'string') {
    const parsed = mortalityFromCsv(await readFile(o.mortality), o.mortality.split('/').pop()?.replace(/\.csv$/i, '') ?? o.mortality, `workspace: ${o.mortality}`);
    if (!parsed.ok) throw new Error(`province(): ${o.mortality}: ${parsed.errors.join('; ')}`);
    P.mortalityOverride = parsed.value;
  } else if (o.mortality) P.mortalityOverride = o.mortality;
  if (o.shocks?.length) P.shocks = o.shocks;
  const sim = new Simulation(P);
  const key = `province-${++provinces}`;
  const date = () => calendarForDay(sim.ctx.startMs, sim.world.day).isoDate;
  const w = sim.world;
  const placeOf = (pid: string) => {
    const person = w.people[pid];
    const com = person ? communityOfPerson(w, person) : null;
    return { city: com ? CITY[cityOf(com)]?.name ?? cityOf(com) : '', settlement: com ? COMMUNITY[com]?.name ?? com : '', tier: com ? tierOf(com) : '' };
  };
  const api = {
    run(r: { years?: number; days?: number } = {}) {
      const days = Math.max(0, Math.round(r.days ?? (r.years ?? 1) * DAYS_PER_YEAR));
      const from = sim.world.day;
      const label = `${key}: living ${days.toLocaleString('en-GB')} days from ${date()}`;
      let last = 0;
      sim.runDays(days, (d) => {
        const done = d - from;
        if (done - last >= 30 || done === days) {
          last = done;
          post({ type: 'progress', key, label, done, total: days, finished: done === days });
        }
      });
      return api;
    },
    get date() {
      return date();
    },
    get years() {
      return Math.round((sim.world.day / DAYS_PER_YEAR) * 1000) / 1000;
    },
    get basis() {
      return sim.params;
    },
    get basisHash() {
      return sim.world.basisHash;
    },
    get world() {
      return sim.world;
    },
    indicators() {
      return indicators(sim);
    },
    people() {
      return alivePeople(w).map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.surname}`,
        sex: p.sex,
        age: p.age,
        ...placeOf(p.id),
        household: w.households[p.householdId]?.name ?? '',
        education: p.education,
        job: p.job,
        income: Math.round(p.income),
        marital: p.marital,
        health: p.health.state,
        conditions: [...p.health.conditions],
        heritage: p.heritage ?? null,
        born_here: p.bornHere,
      }));
    },
    households() {
      return Object.values(w.households)
        .filter((h) => h.dissolvedDay === null && h.memberIds.length)
        .map((h) => {
          const head = h.headId ?? h.memberIds[0];
          return {
            id: h.id,
            name: h.name,
            ...placeOf(head),
            members: h.memberIds.length,
            income: Math.round(h.monthlyIncome),
            expenses: Math.round(h.monthlyExpenses),
            savings: Math.round(h.savings),
            debt: Math.round(h.debt),
            poor: h.poor,
            funeral_cover: h.insurance.funeral,
            life_cover: h.insurance.life,
            medical_aid: h.insurance.medical,
          };
        });
    },
    experience(e: { ageWidth?: number; group?: Grouping } = {}) {
      return experienceCells(sim, { ageWidth: e.ageWidth ?? 1, group: e.group ?? 'none' }).map((c) => ({
        year: c.year,
        age: c.age,
        age_width: c.ageWidth,
        sex: c.sex,
        group: c.group,
        person_years: Math.round(c.personYears * 1e6) / 1e6,
        deaths: c.deaths,
        expected_deaths: Math.round(c.expected * 1e6) / 1e6,
        qx_basis: Math.round(c.qxBasis * 1e8) / 1e8,
      }));
    },
    events(kind?: string) {
      return w.events.filter((e) => !kind || e.kind === kind).map((e) => ({ day: e.day, date: calendarForDay(sim.ctx.startMs, e.day).isoDate, kind: e.kind, severity: e.severity, text: e.text }));
    },
  };
  return api;
}

function template(id: string, years = 10): ExperimentSpec {
  const t = TEMPLATE_BY_ID.get(id);
  if (!t) throw new Error(`template(): no template "${id}"; one of ${TEMPLATES.map((x) => x.id).join(', ')}`);
  return { ...t.build(years), seeds: 8, years };
}

async function experiment(spec: ExperimentSpec) {
  const p = parseExperimentSpec(spec);
  if (!p.ok) throw new Error(`experiment(): ${p.errors.join('; ')}`);
  const job = await call<{ id: string }>('/api/experiments', p.value);
  return follow('experiment', job.id, `${spec.title}: ${spec.seeds} seeds × ${spec.years} years × ${spec.arms.length + 1} runs on the worker pool`, `/api/experiments/${job.id}`, (j) => (j.result as unknown) ?? null);
}

async function monteCarlo(o: { basis?: Record<string, unknown>; seeds?: number; years?: number } = {}) {
  const seeds = Math.max(1, Math.min(200, Math.round(o.seeds ?? 20)));
  const years = Math.max(1, Math.min(60, Math.round(o.years ?? 10)));
  const { params, rejected } = applyPatch({}, (o.basis ?? {}) as never);
  for (const r of rejected) post({ type: 'log', level: 'warn', text: `monteCarlo(): basis ${r}; left out` });
  const job = await call<{ id: string }>('/api/batch', { params, seeds, years });
  return follow('batch', job.id, `Monte Carlo: ${seeds} seeds × ${years} years on the worker pool`, `/api/batch/${job.id}`, (j) => (j.summary as unknown) ?? null);
}

async function pooledExperience(o: { basis?: Record<string, unknown>; seeds?: number; years?: number; ageWidth?: number; group?: Grouping } = {}) {
  const seeds = Math.max(1, Math.min(MAX_EXPERIMENT_SEEDS, Math.round(o.seeds ?? 16)));
  const years = Math.max(1, Math.min(40, Math.round(o.years ?? 10)));
  const job = await call<{ id: string }>('/api/exports', { kind: 'experience', base: o.basis ?? {}, seeds, years, ageWidth: o.ageWidth === 1 ? 1 : 5, group: o.group ?? 'none' });
  const e = await follow('export', job.id, `Pooled experience: ${seeds} seeds × ${years} years on the worker pool`, `/api/exports/${job.id}`, (j) => (j.export as { tables: Array<{ rows: Row[] }>; headline?: unknown[]; truth?: unknown; provenance: unknown } | null) ?? null);
  return { rows: e.tables[0]?.rows ?? [], headline: e.headline ?? [], truth: e.truth, provenance: e.provenance };
}

// ── running a script ────────────────────────────────────────────────────

/** How many lines the Function constructor puts before the body, measured once in this engine. */
let offset: number | null = null;
function lineOffset(): number {
  if (offset !== null) return offset;
  try {
    // biome-ignore lint/complexity/useArrowFunction: the constructor of async functions
    const AF = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => () => Promise<void>;
    new AF(`${SCRIPT_PRELUDE}throw new Error('probe')\n//# sourceURL=probe.js`)().catch((e: Error) => {
      const m = /probe\.js:(\d+)/.exec(e.stack ?? '');
      offset = m ? Number(m[1]) - 1 : 2;
    });
  } catch {
    offset = 2;
  }
  return offset ?? 2;
}
lineOffset();

function where(e: unknown, path: string): { line: number | null; col: number | null } {
  const stack = e instanceof Error ? (e.stack ?? '') : '';
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${esc}:(\\d+):(\\d+)`).exec(stack);
  if (!m) return { line: null, col: null };
  return { line: Math.max(1, Number(m[1]) - (offset ?? 2)), col: Number(m[2]) };
}

self.onmessage = async (e: MessageEvent<ToScript>) => {
  if (e.data?.type !== 'run') return;
  const { code, path } = e.data;
  const t0 = performance.now();
  const api: Record<string, unknown> = {
    province,
    experiment,
    template,
    monteCarlo,
    pooledExperience,
    print: (...v: unknown[]) => post({ type: 'log', level: 'log', text: v.map(show).join(' ') }),
    table: (rows: unknown, columns?: string[]) => {
      const t = tableOf(rows, columns);
      post({ type: 'table', ...t });
      if (Array.isArray(rows) && rows.length > MAX_ROWS) post({ type: 'log', level: 'info', text: `(${MAX_ROWS.toLocaleString('en-GB')} of ${rows.length.toLocaleString('en-GB')} rows shown; csv() and writeFile() keep them all)` });
    },
    plot: (o: unknown) => post({ type: 'plot', spec: plotOf(o) }),
    csv: csvOf,
    readFile,
    writeFile,
    METRICS,
    DEFAULT_BASIS: DEFAULT_PARAMS,
    TEMPLATES: TEMPLATES.map((t) => ({ id: t.id, audience: t.audience, title: t.title, question: t.question })),
  };
  // A script's own console reaches the Console too.
  const forward = (level: 'log' | 'info' | 'warn' | 'error') => (...v: unknown[]) => post({ type: 'log', level, text: v.map(show).join(' ') });
  console.log = forward('log');
  console.info = forward('info');
  console.warn = forward('warn');
  console.error = forward('error');
  try {
    // biome-ignore lint/complexity/useArrowFunction: the constructor of async functions
    const AF = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>;
    const fn = new AF(...Object.keys(api), `${SCRIPT_PRELUDE}${code}\n//# sourceURL=${path}`);
    await fn(...Object.values(api));
    post({ type: 'done', ms: Math.round(performance.now() - t0) });
  } catch (err) {
    const { line, col } = where(err, path);
    const msg = err instanceof Error ? `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}` : String(err);
    post({ type: 'failed', error: msg, line, col, stack: err instanceof Error ? (err.stack ?? null) : null });
  }
};
