// The workbench's state: the open workspace (a folder on this machine, served
// by src/server/workspace.ts), the files open in the editor, the Console and
// the Problems list. One small external store, like the lab's (lib/lab.ts),
// read by the workbench's components through useWorkspace().
//
// Saving names the modification time the file was read at, so a file that
// changed on disk in the meantime (another editor, a sync) is not silently
// overwritten: the tab says so and offers to reload or overwrite.

import { useSyncExternalStore } from 'react';
import { type CommunityExport, type ExperimentResult, exportReadme, tableCsv } from '../../shared/exchange';
import { experimentExport } from '../../shared/exports';
import { EXPERIMENT_SCHEMA_URI, type FileKind, PROVINCE_SCHEMA_URI, type TreeEntry, fileKind } from '../../shared/files';
import { TEMPLATES } from '../../shared/templates';
import { changedFromDefaults } from '../../sim/patch';
import { store } from '../lib/simStore';
import { desktop } from './desktop';

export interface Tab {
  path: string;
  kind: FileKind;
  /** The text in the editor. */
  text: string;
  /** The text as last read or saved. */
  saved: string;
  mtime: number | null;
  abs: string | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** Changed on disk since it was read: the editor offers to reload or overwrite. */
  conflict?: boolean;
}

export interface Problem {
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  col?: number;
  /** Where it came from: the editor's checks, or a run. */
  source: 'editor' | 'run';
}

export interface PlotSpec {
  x: Array<number | string>;
  series: Record<string, Array<number | null>>;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  log?: boolean;
}

export type Row = Record<string, unknown>;

export type ConsoleEntry =
  | { id: number; at: number; kind: 'run'; path: string; verb: string }
  | { id: number; at: number; kind: 'log'; level: 'log' | 'info' | 'warn' | 'error'; text: string }
  | { id: number; at: number; kind: 'table'; rows: Row[]; columns: string[] }
  | { id: number; at: number; kind: 'plot'; spec: PlotSpec }
  | { id: number; at: number; kind: 'progress'; key: string; label: string; done: number; total: number; finished?: boolean }
  | { id: number; at: number; kind: 'done'; path: string; ms: number; ok: boolean; text?: string }
  | { id: number; at: number; kind: 'action'; text: string; label: string; act: () => void };

type NewEntry = ConsoleEntry extends infer E ? (E extends { id: number; at: number } ? Omit<E, 'id' | 'at'> : never) : never;

export interface RunState {
  path: string;
  kind: FileKind;
  startedAt: number;
  /** Stops the run (terminates a script's worker, cancels a job on the pool). */
  stop: () => void;
}

export interface WsState {
  loaded: boolean;
  root: string | null;
  name: string | null;
  sep: string;
  home: string;
  suggested: string;
  recent: string[];
  tree: TreeEntry[];
  truncated: boolean;
  error: string | null;
  tabs: Tab[];
  active: string | null;
  expanded: Record<string, boolean>;
  explorerOpen: boolean;
  panel: 'console' | 'problems' | null;
  console: ConsoleEntry[];
  problems: Problem[];
  running: RunState | null;
  /** A tab waiting on "save changes?" before it closes. */
  closing: string | null;
}

const LS = 'community-lab:workbench:v1';
interface Persisted {
  tabs: string[];
  active: string | null;
  expanded: Record<string, boolean>;
  explorerOpen: boolean;
  panel: WsState['panel'];
}
function loadPersisted(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<Persisted>;
  } catch {
    return {};
  }
}
const persisted = loadPersisted();

let state: WsState = {
  loaded: false,
  root: null,
  name: null,
  sep: '/',
  home: '',
  suggested: '',
  recent: [],
  tree: [],
  truncated: false,
  error: null,
  tabs: [],
  active: persisted.active ?? null,
  expanded: persisted.expanded ?? { scenarios: true, experiments: true, scripts: true },
  explorerOpen: persisted.explorerOpen ?? true,
  panel: persisted.panel === undefined ? 'console' : persisted.panel,
  console: [],
  problems: [],
  running: null,
  closing: null,
};
const listeners = new Set<() => void>();
let lastDirty = false;
function set(patch: Partial<WsState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
  try {
    const p: Persisted = { tabs: state.tabs.map((t) => t.path), active: state.active, expanded: state.expanded, explorerOpen: state.explorerOpen, panel: state.panel };
    localStorage.setItem(LS, JSON.stringify(p));
  } catch {
    /* no storage */
  }
  const dirty = state.tabs.some((t) => t.text !== t.saved);
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    desktop()?.setDirty(dirty);
  }
}

// Leaving the page (a reload, closing the tab or the window) with unsaved files asks first: the browser's own
// prompt, or in the desktop app its dialog (desktop/src/main.ts, will-prevent-unload).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!lastDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(path, init?.body === undefined ? { method: init?.method ?? 'GET' } : { method: init.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) {
    const e = new Error(j.error ?? `${path}: ${r.status}`) as Error & { status?: number; body?: unknown };
    e.status = r.status;
    e.body = j;
    throw e;
  }
  return j;
}

interface Listing {
  root: string | null;
  name: string | null;
  sep: string;
  home: string;
  suggested: string;
  recent: string[];
  tree: TreeEntry[];
  truncated: boolean;
}

let nextId = 1;
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';

/** Every file path in the tree. */
export function allFiles(tree: TreeEntry[] = state.tree): string[] {
  const out: string[] = [];
  const walk = (es: TreeEntry[]) => {
    for (const e of es) {
      if (e.kind === 'file') out.push(e.path);
      else if (e.children) walk(e.children);
    }
  };
  walk(tree);
  return out;
}

function exists(path: string): boolean {
  const walk = (es: TreeEntry[]): boolean => es.some((e) => e.path === path || (e.kind === 'dir' && !!e.children && path.startsWith(`${e.path}/`) && walk(e.children)));
  return walk(state.tree);
}

/** `dir/name.ext`, or `dir/name 2.ext`… whichever is free. Double extensions (`.province.json`) stay whole. */
function freePath(dir: string, stem: string, ext: string): string {
  const base = dir ? `${dir}/` : '';
  if (!exists(`${base}${stem}${ext}`)) return `${base}${stem}${ext}`;
  for (let i = 2; i < 1000; i++) if (!exists(`${base}${stem} ${i}${ext}`)) return `${base}${stem} ${i}${ext}`;
  return `${base}${stem}-${Date.now().toString(36)}${ext}`;
}

const NEW_SCRIPT = `// A Community Lab script. Run it with Ctrl+Enter; its output lands in the Console.
// The API is in the workspace's README.md: province(), experiment(), monteCarlo(), print(), table(), plot().

const p = await province({ seed: 'my-script' });
p.run({ years: 1 });
print(\`\${p.date}: \${p.people().length} residents\`);
table(Object.entries(p.indicators()).map(([indicator, value]) => ({ indicator, value })));
`;

export const workspace = {
  get state(): WsState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ── the folder ──
  async refresh(): Promise<void> {
    try {
      const l = await api<Listing>('/api/workspace');
      const rootChanged = l.root !== state.root;
      set({ ...l, loaded: true, error: null });
      desktop()?.setRecentWorkspaces(l.recent);
      if (rootChanged && l.root) await workspace.restoreTabs();
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },
  /** Reopen the tabs that were open last time, where the files still exist. */
  async restoreTabs(): Promise<void> {
    const want = (persisted.tabs ?? []).filter((p) => exists(p));
    for (const p of want) if (!state.tabs.some((t) => t.path === p)) await workspace.openFile(p, false);
    if (state.active && !state.tabs.some((t) => t.path === state.active)) set({ active: state.tabs[0]?.path ?? null });
    if (!state.tabs.length && exists('README.md')) await workspace.openFile('README.md');
  },
  async open(root: string): Promise<void> {
    try {
      const l = await api<Listing>('/api/workspace/open', { body: { root } });
      set({ ...l, tabs: [], active: null, problems: [], error: null });
      persisted.tabs = [];
      desktop()?.setRecentWorkspaces(l.recent);
      if (exists('README.md')) await workspace.openFile('README.md');
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  /** The native folder picker in the desktop app; in a browser the welcome screen asks for a path instead. */
  async pickAndOpen(): Promise<boolean> {
    const d = desktop();
    if (!d) return false;
    const root = await d.pickFolder({ title: 'Open a folder as the workspace', defaultPath: state.root ?? state.suggested });
    if (root) await workspace.open(root);
    return true;
  },
  async create(parent?: string, name?: string): Promise<void> {
    try {
      const l = await api<Listing>('/api/workspace/create', { body: { parent, name } });
      set({ ...l, tabs: [], active: null, problems: [], error: null, expanded: { scenarios: true, experiments: true, scripts: true, bases: false } });
      persisted.tabs = [];
      desktop()?.setRecentWorkspaces(l.recent);
      await workspace.openFile('README.md');
      workspace.log('info', `Created the sample workspace at ${l.root}.`);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  async close(): Promise<void> {
    if (state.tabs.some((t) => t.text !== t.saved) && !(await workspace.confirmDiscard())) return;
    const l = await api<Listing>('/api/workspace/close', { body: {} });
    set({ ...l, tabs: [], active: null, problems: [] });
  },
  /** Ask before discarding unsaved changes (the desktop app's own dialog when there is one). */
  async confirmDiscard(): Promise<boolean> {
    return window.confirm('Some files have unsaved changes. Discard them?');
  },

  // ── files ──
  async openFile(path: string, activate = true): Promise<void> {
    const open = state.tabs.find((t) => t.path === path);
    if (open) {
      if (activate) set({ active: path });
      return;
    }
    const tab: Tab = { path, kind: fileKind(path), text: '', saved: '', mtime: null, abs: null, status: 'loading' };
    set({ tabs: [...state.tabs, tab], active: activate ? path : (state.active ?? path) });
    try {
      const f = await api<{ text: string; mtime: number; abs: string }>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
      workspace.patchTab(path, { text: f.text, saved: f.text, mtime: f.mtime, abs: f.abs, status: 'ready' });
    } catch (e) {
      workspace.patchTab(path, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
  patchTab(path: string, patch: Partial<Tab>): void {
    set({ tabs: state.tabs.map((t) => (t.path === path ? { ...t, ...patch } : t)) });
  },
  setText(path: string, text: string): void {
    const t = state.tabs.find((x) => x.path === path);
    if (t && t.text !== text) workspace.patchTab(path, { text });
  },
  activate(path: string): void {
    set({ active: path });
  },
  activeTab(): Tab | null {
    return state.tabs.find((t) => t.path === state.active) ?? null;
  },
  async save(path = state.active ?? '', force = false): Promise<boolean> {
    const t = state.tabs.find((x) => x.path === path);
    if (!t || t.status !== 'ready') return false;
    try {
      const r = await api<{ mtime: number; abs: string }>('/api/workspace/file', { method: 'PUT', body: { path, text: t.text, mtime: force ? undefined : (t.mtime ?? undefined) } });
      workspace.patchTab(path, { saved: t.text, mtime: r.mtime, abs: r.abs, conflict: false });
      void workspace.refresh();
      return true;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) workspace.patchTab(path, { conflict: true });
      else workspace.log('error', `Could not save ${path}: ${err.message}`);
      return false;
    }
  },
  async saveAll(): Promise<void> {
    for (const t of state.tabs) if (t.text !== t.saved) await workspace.save(t.path);
  },
  /** Throw away the editor's text and read the file again (after a conflict). */
  async reload(path: string): Promise<void> {
    try {
      const f = await api<{ text: string; mtime: number; abs: string }>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
      workspace.patchTab(path, { text: f.text, saved: f.text, mtime: f.mtime, abs: f.abs, conflict: false, status: 'ready' });
    } catch (e) {
      workspace.log('error', `Could not reload ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  requestClose(path: string): void {
    const t = state.tabs.find((x) => x.path === path);
    if (t && t.text !== t.saved) set({ closing: path });
    else workspace.closeTab(path);
  },
  closeTab(path: string): void {
    const i = state.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    const tabs = state.tabs.filter((t) => t.path !== path);
    const active = state.active === path ? (tabs[Math.min(i, tabs.length - 1)]?.path ?? null) : state.active;
    set({ tabs, active, closing: state.closing === path ? null : state.closing, problems: state.problems.filter((p) => p.path !== path || p.source === 'run') });
  },
  cancelClose(): void {
    set({ closing: null });
  },
  async write(path: string, text: string): Promise<void> {
    await api('/api/workspace/file', { method: 'PUT', body: { path, text } });
    const open = state.tabs.find((t) => t.path === path);
    if (open && open.text === open.saved) await workspace.reload(path);
  },
  async read(path: string): Promise<string> {
    return (await api<{ text: string }>(`/api/workspace/file?path=${encodeURIComponent(path)}`)).text;
  },
  /** A new file of a kind, in its kind's folder (or `dir`), opened in the editor. */
  async newFile(kind: 'province' | 'experiment' | 'script' | 'note', dir?: string): Promise<void> {
    if (!state.root) return;
    const spec = {
      province: { dir: 'scenarios', stem: 'untitled', ext: '.province.json', text: `${JSON.stringify({ $schema: PROVINCE_SCHEMA_URI, title: 'A new province', notes: '', seed: `province-${Date.now().toString(36)}`, basis: {}, shocks: [] }, null, 2)}\n` },
      experiment: (() => {
        const t = TEMPLATES[0];
        return { dir: 'experiments', stem: 'untitled', ext: '.experiment.json', text: `${JSON.stringify({ $schema: EXPERIMENT_SCHEMA_URI, notes: '', ...t.build(10), seeds: 8, years: 10 }, null, 2)}\n` };
      })(),
      script: { dir: 'scripts', stem: 'untitled', ext: '.js', text: NEW_SCRIPT },
      note: { dir: 'notes', stem: 'note', ext: '.md', text: `# Notes\n\n${today()}\n` },
    }[kind];
    const path = freePath(dir ?? spec.dir, spec.stem, spec.ext);
    try {
      await api('/api/workspace/file', { method: 'PUT', body: { path, text: spec.text, create: true } });
      await workspace.refresh();
      set({ expanded: { ...state.expanded, [path.split('/').slice(0, -1).join('/')]: true } });
      await workspace.openFile(path);
    } catch (e) {
      workspace.log('error', `Could not create ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  async newFolder(dir: string, name: string): Promise<void> {
    const path = dir ? `${dir}/${name}` : name;
    try {
      await api('/api/workspace/mkdir', { body: { path } });
      await workspace.refresh();
      set({ expanded: { ...state.expanded, [path]: true } });
    } catch (e) {
      workspace.log('error', `Could not create ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  async rename(from: string, toName: string): Promise<void> {
    const dir = from.split('/').slice(0, -1).join('/');
    const to = dir ? `${dir}/${toName}` : toName;
    if (to === from) return;
    try {
      await api('/api/workspace/rename', { body: { from, to } });
      // Open tabs follow the file (and everything under a renamed folder).
      set({
        tabs: state.tabs.map((t) => (t.path === from || t.path.startsWith(`${from}/`) ? { ...t, path: to + t.path.slice(from.length), kind: fileKind(to + t.path.slice(from.length)) } : t)),
        active: state.active && (state.active === from || state.active.startsWith(`${from}/`)) ? to + state.active.slice(from.length) : state.active,
      });
      await workspace.refresh();
    } catch (e) {
      workspace.log('error', `Could not rename ${from}: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  /** To the system's trash in the desktop app; to the IDE's own trash folder in a browser. */
  async remove(path: string): Promise<void> {
    try {
      const d = desktop();
      const abs = state.root ? `${state.root}${state.sep}${path.split('/').join(state.sep)}` : null;
      if (d && abs) {
        const ok = await d.trashItem(abs);
        if (!ok) throw new Error('the system would not move it to the trash');
      } else {
        const r = await api<{ trashedTo: string }>('/api/workspace/delete', { body: { path } });
        workspace.log('info', `Moved ${path} to ${r.trashedTo}.`);
      }
      for (const t of state.tabs) if (t.path === path || t.path.startsWith(`${path}/`)) workspace.closeTab(t.path);
      await workspace.refresh();
    } catch (e) {
      workspace.log('error', `Could not delete ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  reveal(path: string): void {
    const d = desktop();
    if (!d || !state.root) return;
    d.showItemInFolder(path ? `${state.root}${state.sep}${path.split('/').join(state.sep)}` : state.root);
  },
  toggleFolder(path: string): void {
    set({ expanded: { ...state.expanded, [path]: !state.expanded[path] } });
  },
  collapseAll(): void {
    set({ expanded: {} });
  },
  setExplorer(open: boolean): void {
    set({ explorerOpen: open });
  },
  setPanel(panel: WsState['panel']): void {
    set({ panel });
  },

  // ── the Console and Problems ──
  push(e: NewEntry): ConsoleEntry {
    const entry = { ...e, id: nextId++, at: Date.now() } as ConsoleEntry;
    set({ console: [...state.console, entry].slice(-600), panel: state.panel ?? 'console' });
    return entry;
  },
  log(level: 'log' | 'info' | 'warn' | 'error', text: string): void {
    workspace.push({ kind: 'log', level, text });
  },
  /** Update a progress line in place (one line per key). */
  progress(key: string, label: string, done: number, total: number, finished = false): void {
    const i = state.console.findIndex((c) => c.kind === 'progress' && c.key === key);
    if (i < 0) {
      workspace.push({ kind: 'progress', key, label, done, total, finished });
      return;
    }
    const next = state.console.slice();
    next[i] = { ...(next[i] as Extract<ConsoleEntry, { kind: 'progress' }>), label, done, total, finished };
    set({ console: next });
  },
  clearConsole(): void {
    set({ console: [] });
  },
  setProblems(path: string, source: Problem['source'], problems: Omit<Problem, 'path' | 'source'>[]): void {
    const rest = state.problems.filter((p) => !(p.path === path && p.source === source));
    set({ problems: [...rest, ...problems.map((p) => ({ ...p, path, source }))] });
  },
  setRunning(r: RunState | null): void {
    set({ running: r });
  },
  stop(): void {
    state.running?.stop();
  },
};

export function useWorkspace(): WsState {
  return useSyncExternalStore(workspace.subscribe, () => state, () => state);
}

// ── keeping results and exports ───────────────────────────────────────

/** A folder for something new under `dir`: `dir/<slug>-<date>`, numbered if taken. */
function freeDir(dir: string, title: string): string {
  return freePath(dir, `${slug(title)}-${today()}`, '');
}

/** An export as a folder of the workspace: every table as CSV, a README, the whole export as JSON, the true basis. */
export async function saveExportToWorkspace(e: CommunityExport): Promise<string> {
  if (!state.root) throw new Error('No workspace is open.');
  const dir = freeDir('exports', e.tables[0]?.name ?? e.exportKind);
  for (const t of e.tables) await workspace.write(`${dir}/${t.name}.csv`, tableCsv(t));
  await workspace.write(`${dir}/README.md`, exportReadme(e));
  await workspace.write(`${dir}/export.json`, `${JSON.stringify(e, null, 2)}\n`);
  if (e.truth) await workspace.write(`${dir}/truth.json`, `${JSON.stringify(e.truth, null, 2)}\n`);
  await workspace.refresh();
  set({ expanded: { ...state.expanded, exports: true, [dir]: true } });
  return dir;
}

/** An experiment's result as a folder: the runs and the effects as CSV, the result as JSON, and the spec it was run
 *  from as an experiment file, so it can be run again. */
export async function saveExperimentToWorkspace(r: ExperimentResult, from: string | null): Promise<string> {
  if (!state.root) throw new Error('No workspace is open.');
  const dir = freeDir('results', r.spec.title);
  const e = experimentExport(r);
  for (const t of e.tables) await workspace.write(`${dir}/${t.name}.csv`, tableCsv(t));
  await workspace.write(`${dir}/README.md`, `${exportReadme(e)}${from ? `\nRun from \`${from}\`.\n` : ''}`);
  await workspace.write(`${dir}/result.json`, `${JSON.stringify(r, null, 2)}\n`);
  await workspace.write(`${dir}/${slug(r.spec.title)}.experiment.json`, `${JSON.stringify({ $schema: EXPERIMENT_SCHEMA_URI, ...r.spec }, null, 2)}\n`);
  await workspace.refresh();
  set({ expanded: { ...state.expanded, results: true, [dir]: true } });
  return dir;
}

/** The province on screen as a scenario file: its seed, what its basis changes, its supplied table and shocks. */
export async function saveProvinceAsScenario(): Promise<string> {
  if (!state.root) throw new Error('No workspace is open.');
  const P = store.params;
  const { mortalityOverride, shocks, ...changed } = changedFromDefaults(P) as Record<string, unknown> & { mortalityOverride?: unknown; shocks?: unknown };
  const title = `${P.regionName} Province as on screen`;
  const path = freePath('scenarios', slug(`${P.regionName}-${P.seed}`), '.province.json');
  const file = {
    $schema: PROVINCE_SCHEMA_URI,
    title,
    notes: `Saved from the province on ${today()} (basis ${store.sim.world.basisHash}).`,
    seed: P.seed,
    basis: changed,
    ...(mortalityOverride ? { mortality: P.mortalityOverride } : {}),
    ...(shocks ? { shocks: P.shocks } : {}),
  };
  await workspace.write(path, `${JSON.stringify(file, null, 2)}\n`);
  await workspace.refresh();
  set({ expanded: { ...state.expanded, scenarios: true } });
  await workspace.openFile(path);
  return path;
}
