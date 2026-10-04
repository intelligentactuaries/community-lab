import { callClaudeStream, callGeminiStream, callOpenAIStream } from './cloud';
import { callOllamaStream, listOllamaModels, pickOllamaModel, warmOllama } from './ollama';
import type { CloudProvider, Message, Provider, ProviderPrefs, ProvidersInfo } from './types';

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  'openai-compat': 'local-model',
  ollama: 'gpt-oss:20b',
};

const CLOUD_ORDER: CloudProvider[] = ['anthropic', 'openai', 'gemini', 'openai-compat'];

export interface StreamOpts {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

class LLMRouter {
  private keys: Partial<Record<CloudProvider, string>> = {};
  private prefs: ProviderPrefs = { provider: 'auto', models: {}, reasoning: 'low' };
  private ollamaAvailable: string[] = [];
  private ollamaReachable = false;
  private ollamaSelected: string | null = null;
  private inflight = 0;
  readonly maxInflight = 2;

  async init(): Promise<void> {
    await this.refreshOllama();
    // Load the model into memory now, so the first conversation does not wait. The desktop IDE sets
    // COMMUNITY_WARM_OLLAMA=0: a local model can hold most of a laptop GPU's memory (gpt-oss:20b about 7 GB), and the
    // 3D view needs some of it, so there the model loads on the first conversation instead.
    if (this.ollamaSelected && process.env.COMMUNITY_WARM_OLLAMA !== '0') void warmOllama(this.ollamaSelected);
  }

  async refreshOllama(): Promise<void> {
    const { models, reachable } = await listOllamaModels();
    this.ollamaAvailable = models;
    this.ollamaReachable = reachable;
    const wanted = this.prefs.models.ollama;
    this.ollamaSelected = wanted && models.includes(wanted) ? wanted : pickOllamaModel(models);
  }

  setKeys(keys: Partial<Record<CloudProvider, string | null>>): void {
    for (const [p, k] of Object.entries(keys)) {
      if (!k) delete this.keys[p as CloudProvider];
      else this.keys[p as CloudProvider] = k;
    }
  }

  setPrefs(prefs: Partial<ProviderPrefs>): void {
    this.prefs = { ...this.prefs, ...prefs, models: prefs.models ?? this.prefs.models };
    const wanted = this.prefs.models.ollama;
    if (wanted && this.ollamaAvailable.includes(wanted)) this.ollamaSelected = wanted;
    else if (!wanted) this.ollamaSelected = pickOllamaModel(this.ollamaAvailable);
  }

  info(): ProvidersInfo {
    const eff = this.select();
    return {
      configured: { anthropic: !!this.keys.anthropic, openai: !!this.keys.openai, gemini: !!this.keys.gemini, 'openai-compat': !!this.prefs.compatBaseUrl },
      ollamaModels: this.ollamaAvailable,
      ollamaSelected: this.ollamaSelected,
      ollamaReachable: this.ollamaReachable,
      prefs: this.prefs,
      effective: eff ? { provider: eff, model: this.modelFor(eff) } : null,
    };
  }

  modelFor(p: Provider): string {
    if (p === 'ollama') return this.ollamaSelected ?? DEFAULT_MODELS.ollama;
    return this.prefs.models[p] ?? DEFAULT_MODELS[p];
  }

  select(): Provider | null {
    const pref = this.prefs.provider;
    if (pref !== 'auto') {
      if (pref === 'ollama') return this.ollamaSelected ? 'ollama' : null;
      if (pref === 'openai-compat') return this.prefs.compatBaseUrl ? 'openai-compat' : null;
      return this.keys[pref] ? pref : null;
    }
    if (this.ollamaSelected) return 'ollama';
    for (const p of CLOUD_ORDER) if (p === 'openai-compat' ? this.prefs.compatBaseUrl : this.keys[p]) return p;
    return null;
  }

  get busy(): boolean {
    return this.inflight >= this.maxInflight;
  }

  /** Stream text from the selected provider. */
  async *stream(messages: Message[], opts: StreamOpts = {}): AsyncGenerator<string> {
    const provider = this.select();
    if (!provider) throw new Error('no AI provider available: start Ollama (gpt-oss) or add a cloud key in Settings');
    const model = this.modelFor(provider);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 180_000);
    opts.signal?.addEventListener('abort', () => ac.abort());
    const call = { model, messages, signal: ac.signal, temperature: opts.temperature, maxTokens: opts.maxTokens };
    this.inflight++;
    try {
      let gen: AsyncGenerator<string>;
      switch (provider) {
        case 'ollama':
          gen = callOllamaStream({ ...call, reasoning: this.prefs.reasoning });
          break;
        case 'anthropic':
          gen = callClaudeStream({ ...call, apiKey: this.keys.anthropic });
          break;
        case 'openai':
          gen = callOpenAIStream({ ...call, apiKey: this.keys.openai });
          break;
        case 'gemini':
          gen = callGeminiStream({ ...call, apiKey: this.keys.gemini });
          break;
        case 'openai-compat':
          gen = callOpenAIStream({ ...call, apiKey: this.keys['openai-compat'] }, this.prefs.compatBaseUrl!);
          break;
      }
      for await (const t of gen) yield t;
    } finally {
      clearTimeout(timer);
      this.inflight--;
    }
  }
}

export const router = new LLMRouter();
