import type { ChatMessage } from '../../shared/narrative';
import type { BatchSummary } from '../../sim/batch';
import type { ScenarioParams } from '../../sim/params';

export type CloudProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compat';
export type Provider = CloudProvider | 'ollama';
export interface ProviderPrefs {
  provider: 'auto' | Provider;
  models: Partial<Record<Provider, string>>;
  compatBaseUrl?: string;
  reasoning: 'low' | 'medium' | 'high';
}
export interface ProvidersInfo {
  configured: Record<CloudProvider, boolean>;
  ollamaModels: string[];
  ollamaSelected: string | null;
  ollamaReachable: boolean;
  prefs: ProviderPrefs;
  effective: { provider: Provider; model: string } | null;
}

const LS_KEYS = 'community-lab:keys:v1';
const LS_PREFS = 'community-lab:prefs:v1';
export type StoredKeys = Partial<Record<CloudProvider, string>>;

export function loadKeys(): StoredKeys {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS) ?? '{}') as StoredKeys;
  } catch {
    return {};
  }
}
export function saveKeys(k: StoredKeys): void {
  localStorage.setItem(LS_KEYS, JSON.stringify(k));
}
export function loadPrefs(): Partial<ProviderPrefs> | null {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    return raw ? (JSON.parse(raw) as Partial<ProviderPrefs>) : null;
  } catch {
    return null;
  }
}
export function savePrefs(p: Partial<ProviderPrefs>): void {
  localStorage.setItem(LS_PREFS, JSON.stringify(p));
}

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = `${path} ${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}
const post = <T,>(path: string, body: unknown) => jfetch<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => jfetch<{ ok: boolean }>('/api/health'),
  providers: () => jfetch<ProvidersInfo>('/api/providers'),
  setProviders: (body: { keys?: Partial<Record<CloudProvider, string | null>>; prefs?: Partial<ProviderPrefs>; refreshOllama?: boolean }) => post<ProvidersInfo>('/api/providers', body),
  clearCache: () => jfetch<{ cleared: number }>('/api/cache', { method: 'DELETE' }),
  startBatch: (body: { params: Partial<ScenarioParams>; years: number; seeds: number }) => post<{ id: string }>('/api/batch', body),
  batch: (id: string) => jfetch<{ id: string; status: 'running' | 'done' | 'error'; done: number; total: number; summary: BatchSummary | null; error?: string }>(`/api/batch/${id}`),
};

/** Push the browser-held keys + prefs to the (memory-only) server on load. */
export async function syncProvidersToServer(): Promise<ProvidersInfo> {
  const keys = loadKeys();
  const prefs = loadPrefs();
  const wire: Partial<Record<CloudProvider, string | null>> = {};
  for (const p of ['anthropic', 'openai', 'gemini', 'openai-compat'] as CloudProvider[]) wire[p] = keys[p] ?? null;
  return api.setProviders({ keys: wire, prefs: prefs ?? undefined });
}

export interface DialogueStream {
  onMeta?: (m: { provider: string; model: string; cached: boolean }) => void;
  onDelta: (t: string) => void;
  onDone: (text: string) => void;
  onError: (msg: string) => void;
}

/** Stream a dialogue from the server (SSE over POST). Returns an abort function. */
export function streamDialogue(messages: ChatMessage[], opts: { salt?: string | number; maxTokens?: number; temperature?: number; cache?: boolean }, cb: DialogueStream): () => void {
  const ac = new AbortController();
  (async () => {
    try {
      const r = await fetch('/api/dialogue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, ...opts }), signal: ac.signal });
      if (!r.ok || !r.body) {
        let msg = `dialogue ${r.status}`;
        try {
          msg = ((await r.json()) as { error?: string }).error ?? msg;
        } catch {
          /* ignore */
        }
        cb.onError(msg);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (line) {
            try {
              const j = JSON.parse(line.slice(5).trim()) as { provider?: string; model?: string; cached?: boolean; delta?: string; done?: boolean; text?: string; error?: string };
              if (j.provider && j.model) cb.onMeta?.({ provider: j.provider, model: j.model, cached: !!j.cached });
              if (j.delta) {
                text += j.delta;
                cb.onDelta(j.delta);
              }
              if (j.error) cb.onError(j.error);
              if (j.done) cb.onDone(j.text ?? text);
            } catch {
              /* skip */
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) cb.onError(e instanceof Error ? e.message : String(e));
    }
  })();
  return () => ac.abort();
}
