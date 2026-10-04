// The workspace: a folder on this machine that the workbench reads and
// writes. Scenarios (*.province.json), experiments (*.experiment.json),
// scripts (*.js), mortality tables (*.csv), results and notes live there as
// ordinary files, so they can be versioned, diffed and shared like any other
// project.
//
// Every path the client sends is relative to the workspace root and is
// resolved inside it: an absolute path, a `..` segment, or a symbolic link
// that leads outside the root is refused. Writes go to a temporary file that
// is then renamed over the target, so a crash never leaves half a file, and a
// write that names the modification time it read is refused if the file has
// changed on disk since (another editor, a sync), instead of silently
// overwriting it. Deleting moves the file into the IDE's own trash folder
// (the desktop app uses the system's), never unlinks it outright.
//
// The root survives restarts in <data>/workspace.json, with the recently
// opened folders. COMMUNITY_WORKSPACE opens a folder at start.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TreeEntry } from '../shared/files';
import { SAMPLE_FILES } from '../shared/sample';

type Handler = (req: Request, url: URL, params: Record<string, string>) => Promise<Response> | Response;

const DATA_DIR = process.env.COMMUNITY_DATA_DIR ?? join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'workspace.json');
const TRASH_DIR = join(DATA_DIR, 'trash');
/** Text files larger than this are not opened in the editor. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** The tree stops here; a workspace is a project, not a home folder. */
const MAX_ENTRIES = 4000;
const MAX_DEPTH = 8;
const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.DS_Store', '.trash']);

interface State {
  root: string | null;
  recent: string[];
}

function loadState(): State {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
    const recent = Array.isArray(s.recent) ? s.recent.filter((r): r is string => typeof r === 'string') : [];
    const root = typeof s.root === 'string' && isDir(s.root) ? s.root : null;
    return { root, recent };
  } catch {
    return { root: null, recent: [] };
  }
}

let state: State = loadState();
if (process.env.COMMUNITY_WORKSPACE && isDir(process.env.COMMUNITY_WORKSPACE)) state.root = resolve(process.env.COMMUNITY_WORKSPACE);

function saveState(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* the root still holds for this session */
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });

function requireRoot(): string {
  if (!state.root) throw new WorkspaceError('no workspace is open', 409);
  if (!isDir(state.root)) throw new WorkspaceError(`the workspace folder ${state.root} is gone`, 410);
  return state.root;
}

/** Resolve a client path inside the root, or refuse it. `mustExist` checks the target itself; otherwise its folder. */
export function resolveInRoot(root: string, rel: unknown, mustExist = true): string {
  if (typeof rel !== 'string' || !rel.length || rel.length > 1024) throw new WorkspaceError('a path relative to the workspace is required');
  if (rel.includes('\0')) throw new WorkspaceError('not a valid path');
  const norm = rel.replace(/\\/g, '/');
  if (isAbsolute(norm) || /^[a-zA-Z]:/.test(norm)) throw new WorkspaceError('paths are relative to the workspace');
  if (norm.split('/').some((seg) => seg === '..')) throw new WorkspaceError('a path may not leave the workspace');
  const abs = resolve(root, norm);
  const realRoot = realpathSync(root);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep);
  if (!(abs === root || abs.startsWith(resolve(root) + sep))) throw new WorkspaceError('a path may not leave the workspace');
  // Follow symbolic links: what the path really names must also be inside.
  const probe = mustExist ? abs : nearestExisting(abs);
  let real: string;
  try {
    real = realpathSync(probe);
  } catch {
    throw new WorkspaceError(`${norm} does not exist`, 404);
  }
  if (!inside(real)) throw new WorkspaceError('a path may not leave the workspace (it is a link to somewhere else)');
  return abs;
}

function nearestExisting(p: string): string {
  let cur = p;
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return cur;
}

const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/');

async function listTree(root: string): Promise<{ tree: TreeEntry[]; truncated: boolean }> {
  let count = 0;
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<TreeEntry[]> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: TreeEntry[] = [];
    for (const name of names) {
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.gitignore')) continue;
      if (count >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const abs = join(dir, name);
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue;
      }
      count++;
      const entry: TreeEntry = { path: toRel(root, abs), name, kind: st.isDirectory() ? 'dir' : 'file', size: st.isDirectory() ? 0 : st.size, mtime: Math.round(st.mtimeMs) };
      if (st.isDirectory()) entry.children = depth < MAX_DEPTH ? await walk(abs, depth + 1) : [];
      out.push(entry);
    }
    // Folders first, then files, each alphabetically, the way editors show a project.
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'en', { numeric: true }) : a.kind === 'dir' ? -1 : 1));
  };
  const tree = await walk(root, 0);
  return { tree, truncated };
}

async function payload(): Promise<unknown> {
  const root = state.root && isDir(state.root) ? state.root : null;
  const listing = root ? await listTree(root) : { tree: [], truncated: false };
  return { root, name: root ? basename(root) : null, sep, recent: state.recent.filter(isDir).slice(0, 10), home: homedir(), suggested: suggestedParent(), ...listing };
}

function setRoot(root: string): void {
  state.root = root;
  state.recent = [root, ...state.recent.filter((r) => r !== root)].slice(0, 12);
  saveState();
}

/** Where a new workspace goes when the caller does not say: Documents if there is one, else home. */
function suggestedParent(): string {
  const docs = join(homedir(), 'Documents');
  return isDir(docs) ? docs : homedir();
}

function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new WorkspaceError('the body must be JSON');
  }
}

function writeAtomic(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, abs);
}

/** A name that is free in `dir`: `name`, then `name 2`, `name 3`… */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const n = `${stem} ${i}${ext}`;
    if (!existsSync(join(dir, n))) return n;
  }
  throw new WorkspaceError(`no free name for ${name} in ${dir}`);
}

const wrap =
  (h: Handler): Handler =>
  async (req, url, params) => {
    try {
      return await h(req, url, params);
    } catch (e) {
      if (e instanceof WorkspaceError) return json({ error: e.message }, { status: e.status });
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') return json({ error: 'permission denied' }, { status: 403 });
      if (code === 'ENOENT') return json({ error: 'no such file or folder' }, { status: 404 });
      throw e;
    }
  };

export const workspaceRoutes: Array<{ method: string; path: string; handler: Handler }> = [
  { method: 'GET', path: '/api/workspace', handler: wrap(async () => json(await payload())) },
  {
    method: 'POST',
    path: '/api/workspace/open',
    handler: wrap(async (req) => {
      const { root } = await body<{ root?: unknown }>(req);
      if (typeof root !== 'string' || !root.trim()) throw new WorkspaceError('a folder is required');
      const expanded = root.trim().replace(/^~(?=$|[\\/])/, homedir());
      if (!isAbsolute(expanded)) throw new WorkspaceError('give the folder as a full path (it may start with ~)');
      const abs = resolve(expanded);
      if (!isDir(abs)) throw new WorkspaceError(`${abs} is not a folder`, 404);
      setRoot(abs);
      return json(await payload());
    }),
  },
  {
    method: 'POST',
    path: '/api/workspace/close',
    handler: wrap(async () => {
      state.root = null;
      saveState();
      return json(await payload());
    }),
  },
  {
    /** A new workspace with the sample files, in `parent` (default: Documents) as `name` (default: Community Lab). */
    method: 'POST',
    path: '/api/workspace/create',
    handler: wrap(async (req) => {
      const b = await body<{ parent?: unknown; name?: unknown; sample?: unknown }>(req);
      const parentRaw = typeof b.parent === 'string' && b.parent.trim() ? b.parent.trim().replace(/^~(?=$|[\\/])/, homedir()) : suggestedParent();
      if (!isAbsolute(parentRaw)) throw new WorkspaceError('give the parent folder as a full path');
      const parent = resolve(parentRaw);
      if (!isDir(parent)) throw new WorkspaceError(`${parent} is not a folder`, 404);
      const wanted = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'Community Lab';
      if (/[\\/:*?"<>|\0]/.test(wanted) || wanted === '.' || wanted === '..') throw new WorkspaceError('a folder name without slashes or special characters');
      const name = freeName(parent, wanted);
      const root = join(parent, name);
      mkdirSync(root, { recursive: true });
      if (b.sample !== false) for (const f of SAMPLE_FILES) writeAtomic(join(root, ...f.path.split('/')), f.text);
      setRoot(root);
      return json(await payload());
    }),
  },
  {
    method: 'GET',
    path: '/api/workspace/file',
    handler: wrap(async (_req, url) => {
      const root = requireRoot();
      const abs = resolveInRoot(root, url.searchParams.get('path'));
      const st = statSync(abs);
      if (st.isDirectory()) throw new WorkspaceError('that is a folder');
      if (st.size > MAX_TEXT_BYTES) throw new WorkspaceError(`${basename(abs)} is ${(st.size / 1e6).toFixed(1)} MB; the editor opens files up to ${MAX_TEXT_BYTES / 1e6} MB`, 413);
      const buf = new Uint8Array(await Bun.file(abs).arrayBuffer());
      if (looksBinary(buf)) throw new WorkspaceError(`${basename(abs)} is not a text file`, 415);
      return json({ path: toRel(root, abs), abs, text: new TextDecoder().decode(buf), mtime: Math.round(st.mtimeMs), size: st.size });
    }),
  },
  {
    /** Write a text file. `mtime`, when given, is the modification time the client read: a newer file on disk is a conflict. */
    method: 'PUT',
    path: '/api/workspace/file',
    handler: wrap(async (req) => {
      const root = requireRoot();
      const b = await body<{ path?: unknown; text?: unknown; mtime?: unknown; create?: unknown }>(req);
      if (typeof b.text !== 'string') throw new WorkspaceError('text is required');
      if (b.text.length > MAX_TEXT_BYTES) throw new WorkspaceError('too large to save from the editor', 413);
      const abs = resolveInRoot(root, b.path, false);
      const exists = existsSync(abs);
      if (exists && statSync(abs).isDirectory()) throw new WorkspaceError('that is a folder');
      if (exists && b.create === true) throw new WorkspaceError(`${toRel(root, abs)} already exists`, 409);
      if (exists && typeof b.mtime === 'number') {
        const now = Math.round(statSync(abs).mtimeMs);
        if (Math.abs(now - b.mtime) > 1) return json({ error: 'changed on disk since it was opened', conflict: true, mtime: now }, { status: 409 });
      }
      writeAtomic(abs, b.text);
      const st = statSync(abs);
      return json({ path: toRel(root, abs), abs, mtime: Math.round(st.mtimeMs), size: st.size });
    }),
  },
  {
    method: 'POST',
    path: '/api/workspace/mkdir',
    handler: wrap(async (req) => {
      const root = requireRoot();
      const b = await body<{ path?: unknown }>(req);
      const abs = resolveInRoot(root, b.path, false);
      mkdirSync(abs, { recursive: true });
      return json({ path: toRel(root, abs) });
    }),
  },
  {
    method: 'POST',
    path: '/api/workspace/rename',
    handler: wrap(async (req) => {
      const root = requireRoot();
      const b = await body<{ from?: unknown; to?: unknown }>(req);
      const from = resolveInRoot(root, b.from);
      const to = resolveInRoot(root, b.to, false);
      if (from === root) throw new WorkspaceError('the workspace itself cannot be renamed here');
      if (existsSync(to)) throw new WorkspaceError(`${toRel(root, to)} already exists`, 409);
      mkdirSync(dirname(to), { recursive: true });
      await rename(from, to);
      return json({ from: toRel(root, from), to: toRel(root, to) });
    }),
  },
  {
    /** Move into the IDE's trash (<data>/trash/<time>/name). The desktop app sends files to the system's trash instead. */
    method: 'POST',
    path: '/api/workspace/delete',
    handler: wrap(async (req) => {
      const root = requireRoot();
      const b = await body<{ path?: unknown }>(req);
      const abs = resolveInRoot(root, b.path);
      if (abs === root) throw new WorkspaceError('the workspace itself cannot be deleted here');
      const bin = join(TRASH_DIR, new Date().toISOString().replace(/[:.]/g, '-'));
      mkdirSync(bin, { recursive: true });
      const dest = join(bin, basename(abs));
      try {
        await rename(abs, dest);
      } catch (e) {
        // Another file system (rename cannot cross devices): copy, then remove.
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        const { cp, rm } = await import('node:fs/promises');
        await cp(abs, dest, { recursive: true });
        await rm(abs, { recursive: true, force: true });
      }
      return json({ path: toRel(root, abs), trashedTo: dest });
    }),
  },
];
