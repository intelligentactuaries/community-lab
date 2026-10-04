import type { ProviderCall } from './types';

const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

export async function listOllamaModels(): Promise<{ models: string[]; reachable: boolean }> {
  try {
    const r = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { models: [], reachable: false };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { models: (j.models ?? []).map((m) => m.name), reachable: true };
  } catch {
    return { models: [], reachable: false };
  }
}

// The lab's default is gpt-oss; the rest is a sensible fallback order for a
// machine that does not have it pulled.
const PREFERENCE = ['gpt-oss', 'gemma', 'qwen3', 'qwen2.5', 'llama3'];

export function pickOllamaModel(available: string[]): string | null {
  if (!available.length) return null;
  for (const pref of PREFERENCE) {
    const match = available.find((m) => m.toLowerCase().startsWith(pref));
    if (match) return match;
  }
  return available[0];
}

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-oss') || m.startsWith('qwen3') || m.startsWith('deepseek-r1') || m.startsWith('magistral');
}

/**
 * gpt-oss cannot switch its reasoning trace off; "low" keeps it to a few
 * dozen tokens. Other thinking models accept a boolean. Non-thinking models
 * must not receive the field at all (older Ollama versions reject it).
 */
function thinkField(model: string, reasoning: 'low' | 'medium' | 'high'): Record<string, unknown> {
  const m = model.toLowerCase();
  if (m.startsWith('gpt-oss')) return { think: reasoning };
  if (isReasoningModel(model)) return { think: false };
  return {};
}

export async function* callOllamaStream(c: ProviderCall & { reasoning?: 'low' | 'medium' | 'high' }): AsyncGenerator<string> {
  const body = {
    model: c.model,
    messages: c.messages,
    stream: true,
    keep_alive: '30m',
    ...thinkField(c.model, c.reasoning ?? 'low'),
    options: { temperature: c.temperature ?? 0.8, num_predict: c.maxTokens ?? 600 },
  };
  const r = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: c.signal,
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  if (!r.body) throw new Error('ollama: no response body');
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          const j = JSON.parse(line) as { message?: { content?: string; thinking?: string }; done?: boolean; error?: string };
          if (j.error) throw new Error(`ollama: ${j.error}`);
          // message.thinking chunks are the reasoning trace — never shown as dialogue.
          if (j.message?.content) yield j.message.content;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('ollama:')) throw e;
        }
      }
      nl = buf.indexOf('\n');
    }
  }
}

/** Warm the model into memory so the first conversation does not pay the load. */
export async function warmOllama(model: string): Promise<void> {
  try {
    await fetch(`${HOST}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: '', keep_alive: '30m' }), signal: AbortSignal.timeout(120_000) });
  } catch {
    /* best effort */
  }
}
