// Bun API server: AI providers and streaming dialogue, the worker pool's long
// jobs (experiments, pooled exports, Monte Carlo batches), the workspace the
// workbench edits, and (in production) the built client on the same origin.
import { join } from 'node:path';
import { EXCHANGE_SCHEMA, type ExperimentResult, MAX_EXPERIMENT_SEEDS, MAX_EXPERIMENT_YEARS, MAX_SEED_YEARS, type ParamPatch, parseDirective, parseExperimentSpec, seedYears } from '../shared/exchange';
import { batchCsv, type BatchSummary } from '../sim/batch';
import { METRICS } from '../sim/experiment';
import type { Grouping } from '../sim/experience';
import type { ScenarioParams } from '../sim/params';
import { hash32 } from '../sim/rng';
import { experimentExport } from '../shared/exports';
import { TEMPLATES, TEMPLATE_BY_ID } from '../shared/templates';
import { cacheClear, cacheGet, cachePut, getExperiment, getExport, listBatches, listExperiments } from './db';
import { APP_VERSION, type Job, cancelJob, getJob, listJobs, startBatch, startExperiment, startPooledExport } from './jobs';
import { router } from './llm/router';
import type { CloudProvider, Message, ProviderPrefs } from './llm/types';
import { pool } from './pool';
import { workspaceRoutes } from './workspace';

/** 3040 by default: Scelo IDE's bundled copy of Community Lab keeps 3020, so the two never meet on one port. */
const PORT = Number(process.env.PORT ?? 3040);
const HOST = process.env.HOST ?? '127.0.0.1';
const STATIC_DIR = process.env.COMMUNITY_STATIC_DIR ?? '';
/** The version of the data contract (src/shared/exchange.ts) this server speaks. */
const EXCHANGE_VERSION = 1;

// Who may call the API from a browser: pages on this machine's loopback (the IDE's own window, which is served from
// this origin, and the dev pair's Vite page). Anything else gets no CORS headers, so its scripts cannot read a
// response, and POSTs must be JSON, so a plain cross-site form cannot send one without a preflight that fails.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return LOCAL_ORIGIN.test(origin) ? origin : null;
}
// And the name the request was addressed to must be this machine's loopback: a page on another site that has
// pointed its own domain at 127.0.0.1 (DNS rebinding) is same-origin with itself and would pass a CORS check, but it
// cannot make the browser send a loopback Host header.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function loopbackHost(req: Request): boolean {
  return LOCAL_HOST.test(req.headers.get('host') ?? '');
}
function withCors(req: Request, res: Response): Response {
  const origin = allowedOrigin(req.headers.get('origin'));
  if (!origin) return res;
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

type Handler = (req: Request, url: URL, params: Record<string, string>) => Promise<Response> | Response;
const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, keys, handler });
}
const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
const redact = (s: string) => s.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…').replace(/AIza[A-Za-z0-9_-]{6,}/g, 'AIza…');

route('GET', '/api/health', () => json({ ok: true, app: 'community-lab', edition: 'ide', exchange: EXCHANGE_VERSION, time: Date.now(), version: APP_VERSION }));
route('GET', '/api/providers', () => json(router.info()));
route('POST', '/api/providers', async (req) => {
  const body = (await req.json()) as { keys?: Partial<Record<CloudProvider, string | null>>; prefs?: Partial<ProviderPrefs>; refreshOllama?: boolean };
  if (body.keys) router.setKeys(body.keys);
  if (body.prefs) router.setPrefs(body.prefs);
  if (body.refreshOllama) await router.refreshOllama();
  return json(router.info());
});
route('DELETE', '/api/cache', () => json({ cleared: cacheClear() }));

/** Server-sent stream of model text. Body: { messages, salt?, maxTokens?, temperature?, cache? } */
route('POST', '/api/dialogue', async (req) => {
  const body = (await req.json()) as { messages: Message[]; salt?: string | number; maxTokens?: number; temperature?: number; cache?: boolean };
  if (!body.messages?.length) return json({ error: 'messages required' }, { status: 400 });
  const info = router.info();
  if (!info.effective) return json({ error: 'no AI provider available — start Ollama with gpt-oss, or add a key in Settings' }, { status: 503 });
  const key = `${hash32(JSON.stringify(body.messages))}-${hash32(String(body.salt ?? ''))}-${info.effective.model}`;
  const cached = body.cache === false ? null : cacheGet(key);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ provider: info.effective!.provider, model: info.effective!.model, cached: !!cached });
      if (cached) {
        send({ delta: cached });
        send({ done: true, text: cached });
        controller.close();
        return;
      }
      if (router.busy) {
        send({ error: 'AI is busy with other conversations; try again in a moment' });
        controller.close();
        return;
      }
      let text = '';
      try {
        for await (const t of router.stream(body.messages, { maxTokens: body.maxTokens, temperature: body.temperature, signal: req.signal })) {
          text += t;
          send({ delta: t });
        }
        if (text.trim()) cachePut(key, info.effective!.model, text);
        send({ done: true, text });
      } catch (e) {
        send({ error: redact(e instanceof Error ? e.message : String(e)) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
});

// ── Monte Carlo batches (run on the worker pool so neither the browser nor this server waits on them) ──
route('POST', '/api/batch', async (req) => {
  const body = (await req.json()) as { params?: Partial<ScenarioParams>; years?: number; seeds?: number };
  const years = Math.max(1, Math.min(60, Number(body.years ?? 30)));
  const n = Math.max(1, Math.min(200, Number(body.seeds ?? 20)));
  const job = startBatch(body.params ?? {}, years, n, () => {});
  return json({ id: job.id, status: 'running', total: n });
});
route('GET', '/api/batch', () => json({ recent: listBatches().map((b) => ({ id: b.id, created_at: b.created_at, params: b.params })) }));
route('GET', '/api/batch/:id', (_req, _url, p) => {
  const j = getJob(p.id);
  if (!j) {
    const saved = listBatches().find((x) => x.id === p.id);
    return saved ? json({ id: p.id, status: 'done', done: 0, total: 0, summary: saved.summary }) : json({ error: 'not found' }, { status: 404 });
  }
  return json({ id: p.id, status: j.status === 'cancelled' ? 'error' : j.status, done: j.done, total: j.total, summary: j.status === 'done' ? j.result : null, error: j.error });
});
route('GET', '/api/batch/:id/csv', (_req, _url, p) => {
  const j = getJob(p.id);
  const summary = (j?.status === 'done' ? (j.result as BatchSummary) : null) ?? (listBatches().find((x) => x.id === p.id)?.summary as BatchSummary | undefined) ?? null;
  if (!summary) return json({ error: 'not ready' }, { status: 404 });
  return new Response(batchCsv(summary), { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="community-batch-${p.id}.csv"` } });
});

// ── The lab: experiments, pooled exports and templates (the data contract: src/shared/exchange.ts) ──
const jobView = (j: Job) => ({ id: j.id, kind: j.kind, title: j.title, status: j.status, done: j.done, total: j.total, startedAt: j.startedAt, error: j.error, warnings: j.warnings });

route('GET', '/api/exchange', () =>
  json({ schema: EXCHANGE_SCHEMA, app: 'community-lab', version: APP_VERSION, metrics: METRICS, templates: TEMPLATES.map((t) => ({ id: t.id, audience: t.audience, title: t.title, question: t.question, focus: t.focus })), workers: pool.stats }),
);
route('GET', '/api/templates/:id', (_req, url, p) => {
  const t = TEMPLATE_BY_ID.get(p.id);
  if (!t) return json({ error: 'no such template' }, { status: 404 });
  const years = Math.max(1, Math.min(40, Number(url.searchParams.get('years') ?? 10)));
  return json({ ...t.build(years), focus: t.focus, years });
});

route('POST', '/api/experiments', async (req) => {
  const parsed = parseExperimentSpec(await req.json());
  if (!parsed.ok) return json({ error: 'invalid experiment', details: parsed.errors }, { status: 400 });
  return json(jobView(startExperiment(parsed.value)));
});
route('GET', '/api/experiments', () => json({ running: listJobs('experiment').filter((j) => j.status === 'running').map(jobView), saved: listExperiments() }));
route('GET', '/api/experiments/:id', (_req, _url, p) => {
  const j = getJob(p.id);
  if (j) return json({ ...jobView(j), result: j.status === 'done' ? j.result : null });
  const saved = getExperiment(p.id);
  return saved ? json({ id: p.id, kind: 'experiment', title: saved.title, status: 'done', done: 0, total: 0, warnings: [], result: saved.result }) : json({ error: 'not found' }, { status: 404 });
});
route('DELETE', '/api/experiments/:id', (_req, _url, p) => json({ cancelled: cancelJob(p.id) }));
/** The experiment as an export (the runs, and the effects beside them). */
route('GET', '/api/experiments/:id/export', (_req, _url, p) => {
  const j = getJob(p.id);
  const result = (j?.status === 'done' ? j.result : getExperiment(p.id)?.result) as ExperimentResult | undefined;
  return result ? json(experimentExport(result)) : json({ error: 'not ready' }, { status: 404 });
});

route('POST', '/api/exports', async (req) => {
  const body = (await req.json()) as { kind?: string; base?: ParamPatch; mortality?: unknown; shocks?: unknown; seeds?: number; years?: number; ageWidth?: number; group?: Grouping };
  if (body.kind !== 'experience') return json({ error: 'kind must be experience (the other exports come from the province on screen)' }, { status: 400 });
  const seeds = Math.round(Number(body.seeds ?? 16));
  const years = Math.round(Number(body.years ?? 10));
  if (!(seeds >= 1 && seeds <= MAX_EXPERIMENT_SEEDS) || !(years >= 1 && years <= MAX_EXPERIMENT_YEARS)) return json({ error: `seeds 1–${MAX_EXPERIMENT_SEEDS}, years 1–${MAX_EXPERIMENT_YEARS}` }, { status: 400 });
  if (seedYears(seeds, years) > MAX_SEED_YEARS) return json({ error: `${seedYears(seeds, years)} province-years (seeds × years); at most ${MAX_SEED_YEARS}` }, { status: 400 });
  const ageWidth = body.ageWidth === 1 ? 1 : 5;
  const group: Grouping = body.group === 'city' || body.group === 'settlement' || body.group === 'tier' ? body.group : 'none';
  // The base, its basis and its shocks are checked as a directive's would be.
  const outside = body.base !== undefined || body.mortality !== undefined || body.shocks !== undefined;
  const check = outside ? parseDirective({ schema: EXCHANGE_SCHEMA, kind: 'community.directive', id: 'check', label: 'check', from: { app: 'community-lab', appVersion: APP_VERSION, createdAt: '' }, params: body.base, mortality: body.mortality, shocks: body.shocks }) : null;
  if (check && !check.ok) return json({ error: 'invalid base', details: check.errors }, { status: 400 });
  const d = check?.ok ? check.value : null;
  return json(jobView(startPooledExport({ base: d?.params, mortality: d?.mortality, shocks: d?.shocks, seeds, years, ageWidth, group })));
});
route('GET', '/api/exports/:id', (_req, _url, p) => {
  const j = getJob(p.id);
  if (j) return json({ ...jobView(j), export: j.status === 'done' ? j.result : null });
  const saved = getExport(p.id);
  return saved ? json({ id: p.id, kind: 'export', status: 'done', done: 0, total: 0, warnings: [], export: saved }) : json({ error: 'not found' }, { status: 404 });
});
route('DELETE', '/api/exports/:id', (_req, _url, p) => json({ cancelled: cancelJob(p.id) }));

// ── The workspace the workbench edits (a folder on this machine) ──
for (const r of workspaceRoutes) route(r.method, r.path, r.handler);

async function serveStatic(url: URL): Promise<Response | null> {
  if (!STATIC_DIR) return null;
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  let file = Bun.file(join(STATIC_DIR, path));
  if (!(await file.exists())) {
    path = '/index.html';
    file = Bun.file(join(STATIC_DIR, path));
    if (!(await file.exists())) return null;
  }
  return new Response(file);
}

await router.init();
const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') && !loopbackHost(req)) return json({ error: 'requests must be addressed to this machine (localhost)' }, { status: 421 });
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      const origin = allowedOrigin(req.headers.get('origin'));
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          vary: 'origin',
        },
      });
    }
    if ((req.method === 'POST' || req.method === 'PUT') && url.pathname.startsWith('/api/') && !(req.headers.get('content-type') ?? '').includes('application/json')) {
      return withCors(req, json({ error: 'POST and PUT bodies must be application/json' }, { status: 415 }));
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return withCors(req, await r.handler(req, url, params));
      } catch (e) {
        return withCors(req, json({ error: redact(e instanceof Error ? e.message : String(e)) }, { status: 500 }));
      }
    }
    if (url.pathname.startsWith('/api/')) return withCors(req, json({ error: 'not found' }, { status: 404 }));
    return (await serveStatic(url)) ?? new Response('Community Lab API. Start the client with `bun run dev`.', { status: 404 });
  },
});
const info = router.info();
console.log(`community-lab api on http://${HOST}:${server.port}  ollama:${info.ollamaReachable ? info.ollamaSelected ?? 'no model' : 'unreachable'}  provider:${info.effective ? `${info.effective.provider}/${info.effective.model}` : 'none'}${STATIC_DIR ? `  static:${STATIC_DIR}` : ''}`);
