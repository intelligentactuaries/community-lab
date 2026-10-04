export type Role = 'system' | 'user' | 'assistant';
export interface Message {
  role: Role;
  content: string;
}
export type CloudProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compat';
export type Provider = CloudProvider | 'ollama';

export interface ProviderCall {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  messages: Message[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderPrefs {
  /** Which provider serves dialogue. 'auto' = ollama if loaded, else the first cloud key. */
  provider: 'auto' | Provider;
  models: Partial<Record<Provider, string>>;
  /** OpenAI-compatible base URL (LM Studio, vLLM, Groq...). */
  compatBaseUrl?: string;
  /** gpt-oss reasoning effort. */
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
