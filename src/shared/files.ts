// The workspace's file kinds and the two JSON formats the IDE runs:
//
//   *.province.json     a province: a seed, the basis (only what differs from
//                       the defaults), and optionally a mortality table and
//                       timed shocks. Running it rebuilds the province on it.
//   *.experiment.json   a paired experiment (the exchange's ExperimentSpec):
//                       the baseline and up to six arms, on the same seeds.
//                       Running it puts it on the worker pool.
//
// Scripts (*.js) run in a worker beside the editor, with the engine and the
// worker pool at hand (src/client/workbench/scriptWorker.ts). Everything else
// opens as text (CSV, Markdown, JSON) for reading and editing.

import { type ExperimentSpec, type MortalityOverride, type ParamPatch, type Shock, parseExperimentSpec } from './exchange';

export type FileKind = 'province' | 'experiment' | 'script' | 'csv' | 'markdown' | 'json' | 'text';

/** One entry of the workspace tree (GET /api/workspace). Paths are relative to the root, with forward slashes. */
export interface TreeEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  children?: TreeEntry[];
}

export function fileKind(path: string): FileKind {
  const p = path.toLowerCase();
  if (p.endsWith('.province.json')) return 'province';
  if (p.endsWith('.experiment.json')) return 'experiment';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'script';
  if (p.endsWith('.csv') || p.endsWith('.tsv')) return 'csv';
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'markdown';
  if (p.endsWith('.json')) return 'json';
  return 'text';
}

/** What running a file of this kind does, for the Run button's label. */
export function runVerb(kind: FileKind): string | null {
  if (kind === 'province') return 'Run the province';
  if (kind === 'experiment') return 'Run the experiment';
  if (kind === 'script') return 'Run the script';
  return null;
}

export const PROVINCE_SCHEMA_URI = 'https://intelligentactuaries.com/schemas/community-lab/province.json';
export const EXPERIMENT_SCHEMA_URI = 'https://intelligentactuaries.com/schemas/community-lab/experiment.json';

export interface ProvinceFile {
  $schema?: string;
  title?: string;
  notes?: string;
  /** Same seed, same province: the households, the weather and every draw the basis does not change. */
  seed?: string;
  /** Scenario parameters that differ from the defaults (Scenario & basis in the left panel). */
  basis?: ParamPatch;
  /** A mortality table to live on: a CSV in the workspace (age, qx_m, qx_f), or the table inline. */
  mortality?: string | MortalityOverride;
  /** Timed shocks: months from the start of the simulation. */
  shocks?: Shock[];
}

export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** JSON text → value, with the line and column of a syntax error. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /position (\d+)/.exec(msg);
    if (m) {
      const pos = Number(m[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      return { ok: false, error: `JSON: ${msg.replace(/ in JSON at position \d+.*/, '')} (line ${line}, column ${col})` };
    }
    return { ok: false, error: `JSON: ${msg}` };
  }
}

/** Shape checks for a province file (the ranges are checked when it is applied: sim/patch.ts, the exchange). */
export function parseProvinceFile(x: unknown): Parsed<ProvinceFile> {
  if (!isObj(x)) return { ok: false, errors: ['a province file is a JSON object'] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set(['$schema', 'title', 'notes', 'seed', 'basis', 'mortality', 'shocks']);
  for (const k of Object.keys(x)) if (!known.has(k)) warnings.push(`"${k}" is not a field of a province file (seed, basis, mortality, shocks, title, notes); it is ignored`);
  if (x.title !== undefined && typeof x.title !== 'string') errors.push('title: a string');
  if (x.notes !== undefined && typeof x.notes !== 'string') errors.push('notes: a string');
  if (x.seed !== undefined && (typeof x.seed !== 'string' || !x.seed.trim() || x.seed.length > 120)) errors.push('seed: a short string');
  if (x.basis !== undefined && !isObj(x.basis)) errors.push('basis: an object of parameter → value');
  if (isObj(x.basis) && 'seed' in x.basis) errors.push('basis.seed: the seed goes at the top level, beside basis');
  if (x.mortality !== undefined && x.mortality !== null && typeof x.mortality !== 'string' && !isObj(x.mortality)) errors.push('mortality: a CSV path in the workspace, or a table object');
  if (x.shocks !== undefined && !Array.isArray(x.shocks)) errors.push('shocks: a list');
  return errors.length ? { ok: false, errors } : { ok: true, value: x as ProvinceFile, warnings };
}

export function parseExperimentFile(x: unknown): Parsed<ExperimentSpec> {
  if (!isObj(x)) return { ok: false, errors: ['an experiment file is a JSON object'] };
  const { $schema: _s, notes: _n, ...spec } = x;
  const p = parseExperimentSpec(spec);
  return p.ok ? { ok: true, value: p.value, warnings: [] } : p;
}
