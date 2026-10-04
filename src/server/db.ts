// bun:sqlite — a cache of generated dialogue keyed by prompt hash + salt, and
// the lab's kept runs (batches, experiments, pooled exports). Lives under
// ./data, or COMMUNITY_DATA_DIR (the desktop IDE points it at the user's data
// folder).
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.COMMUNITY_DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(dir, { recursive: true });
export const db = new Database(join(dir, 'community.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS llm_cache (key TEXT PRIMARY KEY, model TEXT, text TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS batch_runs (id TEXT PRIMARY KEY, created_at INTEGER, params TEXT, summary TEXT);
  CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, created_at INTEGER, title TEXT, spec TEXT, result TEXT);
  CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, created_at INTEGER, title TEXT, payload TEXT);
`);

export function cacheGet(key: string): string | null {
  const row = db.query('SELECT text FROM llm_cache WHERE key = ?').get(key) as { text: string } | null;
  return row?.text ?? null;
}

export function cachePut(key: string, model: string, text: string): void {
  db.query('INSERT OR REPLACE INTO llm_cache (key, model, text, created_at) VALUES (?, ?, ?, ?)').run(key, model, text, Date.now());
}

export function cacheClear(): number {
  const n = (db.query('SELECT COUNT(*) AS n FROM llm_cache').get() as { n: number }).n;
  db.exec('DELETE FROM llm_cache');
  return n;
}

export function saveBatch(id: string, params: unknown, summary: unknown): void {
  db.query('INSERT OR REPLACE INTO batch_runs (id, created_at, params, summary) VALUES (?, ?, ?, ?)').run(id, Date.now(), JSON.stringify(params), JSON.stringify(summary));
}

export function listBatches(): Array<{ id: string; created_at: number; params: unknown; summary: unknown }> {
  const rows = db.query('SELECT id, created_at, params, summary FROM batch_runs ORDER BY created_at DESC LIMIT 50').all() as Array<{ id: string; created_at: number; params: string; summary: string }>;
  return rows.map((r) => ({ id: r.id, created_at: r.created_at, params: JSON.parse(r.params), summary: JSON.parse(r.summary) }));
}

// ── Experiments and pooled exports (jobs.ts) ──

export function saveExperiment(id: string, title: string, spec: unknown, result: unknown): void {
  db.query('INSERT OR REPLACE INTO experiments (id, created_at, title, spec, result) VALUES (?, ?, ?, ?, ?)').run(id, Date.now(), title, JSON.stringify(spec), JSON.stringify(result));
}

export function getExperiment(id: string): { id: string; created_at: number; title: string; spec: unknown; result: unknown } | null {
  const r = db.query('SELECT id, created_at, title, spec, result FROM experiments WHERE id = ?').get(id) as { id: string; created_at: number; title: string; spec: string; result: string } | null;
  return r ? { ...r, spec: JSON.parse(r.spec), result: JSON.parse(r.result) } : null;
}

export function listExperiments(): Array<{ id: string; created_at: number; title: string }> {
  return db.query('SELECT id, created_at, title FROM experiments ORDER BY created_at DESC LIMIT 50').all() as Array<{ id: string; created_at: number; title: string }>;
}

export function saveExport(id: string, title: string, payload: unknown): void {
  db.query('INSERT OR REPLACE INTO exports (id, created_at, title, payload) VALUES (?, ?, ?, ?)').run(id, Date.now(), title, JSON.stringify(payload));
}

export function getExport(id: string): unknown | null {
  const r = db.query('SELECT payload FROM exports WHERE id = ?').get(id) as { payload: string } | null;
  return r ? JSON.parse(r.payload) : null;
}
