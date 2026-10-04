// Cloud providers, streaming. Keys live in memory only (pushed from the
// browser's localStorage each session, never written to disk or logged).
import type { ProviderCall } from './types';

async function* sseLines(r: Response): AsyncGenerator<string> {
  if (!r.body) return;
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
      nl = buf.indexOf('\n');
    }
  }
}

export async function* callClaudeStream(c: ProviderCall): AsyncGenerator<string> {
  if (!c.apiKey) throw new Error('anthropic key missing');
  const system = c.messages.find((m) => m.role === 'system')?.content;
  const messages = c.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const body: Record<string, unknown> = { model: c.model, max_tokens: c.maxTokens ?? 800, temperature: c.temperature ?? 0.8, messages, stream: true };
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: c.signal,
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
  for await (const data of sseLines(r)) {
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
      if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) yield j.delta.text;
    } catch {
      /* skip */
    }
  }
}

export async function* callOpenAIStream(c: ProviderCall, baseUrl = 'https://api.openai.com/v1'): AsyncGenerator<string> {
  if (!c.apiKey && baseUrl.startsWith('https://api.openai.com')) throw new Error('openai key missing');
  const body = { model: c.model, messages: c.messages, temperature: c.temperature ?? 0.8, max_tokens: c.maxTokens ?? 800, stream: true };
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: c.signal,
  });
  if (!r.ok) throw new Error(`openai-compatible ${r.status}: ${await r.text()}`);
  for await (const data of sseLines(r)) {
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    } catch {
      /* skip */
    }
  }
}

export async function* callGeminiStream(c: ProviderCall): AsyncGenerator<string> {
  if (!c.apiKey) throw new Error('gemini key missing');
  const sys = c.messages.find((m) => m.role === 'system')?.content;
  const contents = c.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = { contents, generationConfig: { temperature: c.temperature ?? 0.8, maxOutputTokens: c.maxTokens ?? 800 } };
  if (sys) body.systemInstruction = { role: 'system', parts: [{ text: sys }] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(c.apiKey)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: c.signal });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);
  for await (const data of sseLines(r)) {
    if (!data) continue;
    try {
      const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const t = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (t) yield t;
    } catch {
      /* skip */
    }
  }
}
