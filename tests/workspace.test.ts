// The workbench's server side (src/server/workspace.ts): every path stays inside the workspace, writes are
// atomic and refuse to overwrite a file changed on disk since it was read, deletes go to a trash, and the sample
// workspace is written whole. And the sample itself: every province, experiment, table and script in it is one
// the engine accepts as written.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseExperimentFile, parseJsonText, parseProvinceFile } from '../src/shared/files';
import { mortalityFromCsv } from '../src/shared/mortalityCsv';
import { SAMPLE_FILES } from '../src/shared/sample';
import { applyPatch } from '../src/sim/patch';

const base = mkdtempSync(join(tmpdir(), 'clide-ws-'));
process.env.COMMUNITY_DATA_DIR = join(base, 'data');
let routes: Array<{ method: string; path: string; handler: (req: Request, url: URL, params: Record<string, string>) => Promise<Response> | Response }>;
let resolveInRoot: (root: string, rel: unknown, mustExist?: boolean) => string;

beforeAll(async () => {
  const m = await import('../src/server/workspace');
  routes = m.workspaceRoutes;
  resolveInRoot = m.resolveInRoot;
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function call(method: string, path: string, body?: unknown, query = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`no route ${method} ${path}`);
  const url = new URL(`http://127.0.0.1:3040${path}${query}`);
  const req = new Request(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await r.handler(req, url, {});
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('the workspace on disk', () => {
  test('a new workspace holds every sample file', async () => {
    mkdirSync(join(base, 'docs'), { recursive: true });
    const r = await call('POST', '/api/workspace/create', { parent: join(base, 'docs') });
    expect(r.status).toBe(200);
    const root = r.json.root as string;
    expect(root).toBe(join(base, 'docs', 'Community Lab'));
    for (const f of SAMPLE_FILES) expect(readFileSync(join(root, ...f.path.split('/')), 'utf8')).toBe(f.text);
    // A second one does not overwrite the first.
    const again = await call('POST', '/api/workspace/create', { parent: join(base, 'docs') });
    expect(again.json.root).toBe(join(base, 'docs', 'Community Lab 2'));
    await call('POST', '/api/workspace/open', { root });
  });

  test('paths cannot leave the workspace', async () => {
    const root = join(base, 'docs', 'Community Lab');
    expect(() => resolveInRoot(root, '../outside.txt', false)).toThrow();
    expect(() => resolveInRoot(root, 'scenarios/../../x', false)).toThrow();
    expect(() => resolveInRoot(root, '/etc/passwd')).toThrow();
    expect(() => resolveInRoot(root, 'C:\\Windows\\win.ini')).toThrow();
    expect(() => resolveInRoot(root, '')).toThrow();
    expect(resolveInRoot(root, 'scenarios/ageing.province.json')).toBe(join(root, 'scenarios', 'ageing.province.json'));
    // A link that points out of the workspace is refused, for reading and for writing through it.
    const outside = join(base, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'no');
    symlinkSync(outside, join(root, 'link'));
    expect(() => resolveInRoot(root, 'link/secret.txt')).toThrow();
    expect(() => resolveInRoot(root, 'link/new.txt', false)).toThrow();
    const read = await call('GET', '/api/workspace/file', undefined, '?path=link/secret.txt');
    expect(read.status).toBe(400);
    rmSync(join(root, 'link'));
  });

  test('a save names the version it read; a newer file on disk is a conflict, not an overwrite', async () => {
    const r1 = await call('PUT', '/api/workspace/file', { path: 'notes/a.md', text: 'one' });
    expect(r1.status).toBe(200);
    const mtime = r1.json.mtime as number;
    const r2 = await call('PUT', '/api/workspace/file', { path: 'notes/a.md', text: 'two', mtime });
    expect(r2.status).toBe(200);
    const stale = await call('PUT', '/api/workspace/file', { path: 'notes/a.md', text: 'three', mtime: mtime - 10_000 });
    expect(stale.status).toBe(409);
    expect(stale.json.conflict).toBe(true);
    const now = await call('GET', '/api/workspace/file', undefined, '?path=notes/a.md');
    expect(now.json.text).toBe('two');
    // create: true never replaces an existing file.
    const dup = await call('PUT', '/api/workspace/file', { path: 'notes/a.md', text: 'x', create: true });
    expect(dup.status).toBe(409);
  });

  test('renames follow, and deletes go to the trash rather than away', async () => {
    const root = join(base, 'docs', 'Community Lab');
    expect((await call('POST', '/api/workspace/rename', { from: 'notes/a.md', to: 'notes/b.md' })).status).toBe(200);
    expect(existsSync(join(root, 'notes', 'b.md'))).toBe(true);
    const del = await call('POST', '/api/workspace/delete', { path: 'notes/b.md' });
    expect(del.status).toBe(200);
    expect(existsSync(join(root, 'notes', 'b.md'))).toBe(false);
    expect(readFileSync(del.json.trashedTo as string, 'utf8')).toBe('two');
    expect((await call('POST', '/api/workspace/delete', { path: '.' })).status).toBe(400);
  });

  test('binary and oversized files are not opened as text', async () => {
    const root = join(base, 'docs', 'Community Lab');
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    expect((await call('GET', '/api/workspace/file', undefined, '?path=blob.bin')).status).toBe(415);
  });
});

describe('the sample workspace runs as written', () => {
  const byPath = new Map(SAMPLE_FILES.map((f) => [f.path, f.text]));

  test('every province file parses, and every basis value is one the engine takes', () => {
    const provinces = SAMPLE_FILES.filter((f) => f.path.endsWith('.province.json'));
    expect(provinces.length).toBeGreaterThanOrEqual(3);
    for (const f of provinces) {
      const j = parseJsonText(f.text);
      expect(j.ok).toBe(true);
      const p = parseProvinceFile(j.ok ? j.value : null);
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(p.warnings).toEqual([]);
      expect(applyPatch({}, p.value.basis).rejected).toEqual([]);
      if (typeof p.value.mortality === 'string') {
        const csv = byPath.get(p.value.mortality);
        expect(csv).toBeDefined();
        expect(mortalityFromCsv(csv as string, 'sample', 'test').ok).toBe(true);
      }
    }
  });

  test('every experiment file is a valid experiment', () => {
    const exps = SAMPLE_FILES.filter((f) => f.path.endsWith('.experiment.json'));
    expect(exps.length).toBeGreaterThanOrEqual(2);
    for (const f of exps) {
      const j = parseJsonText(f.text);
      const p = parseExperimentFile(j.ok ? j.value : null);
      expect(p.ok).toBe(true);
      if (p.ok) for (const a of p.value.arms) expect(applyPatch({}, a.params).rejected).toEqual([]);
    }
  });

  test('every script compiles as the body of an async function', () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => unknown;
    const names = ['province', 'experiment', 'template', 'monteCarlo', 'pooledExperience', 'print', 'table', 'plot', 'csv', 'readFile', 'writeFile', 'METRICS', 'DEFAULT_BASIS', 'TEMPLATES'];
    for (const f of SAMPLE_FILES.filter((x) => x.path.endsWith('.js'))) expect(() => new AsyncFunction(...names, f.text)).not.toThrow();
  });
});
