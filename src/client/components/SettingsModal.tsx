import { useEffect, useState } from 'react';
import { api, loadKeys, saveKeys, savePrefs, type CloudProvider, type ProviderPrefs, type ProvidersInfo, type StoredKeys } from '../lib/api';
import { NAV_DEFAULTS, UE, fmtSpeed, navPrefs, resetNavPrefs, setNavPref, type FlightControl, type NavPrefs } from '../lib/controls';
import { store, useStore, type AiMode } from '../lib/simStore';
import { useTheme, type ThemeChoice } from '../lib/theme';

const CLOUD: { id: CloudProvider; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…' },
  { id: 'openai-compat', label: 'OpenAI-compatible', placeholder: 'key (optional)' },
];

export function SettingsModal({ info, onInfo }: { info: ProvidersInfo | null; onInfo: (i: ProvidersInfo) => void }) {
  const st = useStore();
  const theme = useTheme();
  const [keys, setKeys] = useState<StoredKeys>({});
  const [prefs, setPrefs] = useState<ProviderPrefs | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [, navTick] = useState(0);
  const nav = <K extends keyof NavPrefs>(k: K, v: NavPrefs[K]) => {
    setNavPref(k, v);
    navTick((t) => t + 1);
  };
  useEffect(() => {
    if (!st.settingsOpen) return;
    setKeys(loadKeys());
    setMsg(null);
    setDirty(false);
  }, [st.settingsOpen]);
  useEffect(() => {
    if (info && !dirty) setPrefs(info.prefs);
  }, [info, dirty]);
  if (!st.settingsOpen) return null;
  const close = () => store.set('settingsOpen', false);
  const edit = (fn: (p: ProviderPrefs) => ProviderPrefs) => {
    setPrefs((p) => (p ? fn(p) : p));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      const cleaned: StoredKeys = {};
      const wire: Partial<Record<CloudProvider, string | null>> = {};
      for (const c of CLOUD) {
        const v = (keys[c.id] ?? '').trim();
        if (v) cleaned[c.id] = v;
        wire[c.id] = v || null;
      }
      saveKeys(cleaned);
      if (prefs) savePrefs(prefs);
      const next = await api.setProviders({ keys: wire, prefs: prefs ?? undefined, refreshOllama: true });
      setDirty(false);
      onInfo(next);
      setMsg('saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      onInfo(await api.setProviders({ refreshOllama: true }));
      setMsg('ollama refreshed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="panel-label">settings — AI model &amp; dialogue</div>
          <button className="ghost" onClick={close}>close</button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <div className="panel-label">Theme</div>
            <div className="row wrap">
              {([
                ['sim', 'Follow the sim’s daylight'],
                ['light', 'Always light'],
                ['dark', 'Always dark'],
                ['system', 'Follow this device'],
              ] as Array<[ThemeChoice, string]>).map(([id, label]) => (
                <button key={id} className={theme.choice === id ? 'primary' : ''} onClick={() => theme.setChoice(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="muted small">The default blends light and dark with the community’s own sunrise and sunset — dusk and dawn sit in between. Pick a static theme if you prefer a steady view.</div>
          </section>
          <section className="modal-section">
            <div className="panel-label">Navigation — Unreal Engine’s viewport controls</div>
            <div className="key-row">
              <span>Camera speed</span>
              <input type="range" min={UE.SLIDER_MIN} max={UE.SLIDER_MAX} step={0.01} value={Math.max(UE.SLIDER_MIN, Math.min(UE.SLIDER_MAX, navPrefs.cameraSpeed))} onChange={(e) => nav('cameraSpeed', Number(e.target.value))} />
              <span className="muted small">×{fmtSpeed(navPrefs.cameraSpeed)} · the wheel with a mouse button held changes it too</span>
            </div>
            <div className="key-row">
              <span>Scroll speed</span>
              <input type="range" min={1} max={8} step={1} value={navPrefs.scrollSpeed} onChange={(e) => nav('scrollSpeed', Number(e.target.value))} />
              <span className="muted small">{navPrefs.scrollSpeed} · a wheel notch dollies {(UE.SCROLL_TABLE[navPrefs.scrollSpeed - 1] * UE.SCROLL_CM).toFixed(0)} cm</span>
            </div>
            <div className="key-row">
              <span>Mouse sensitivity</span>
              <input type="range" min={0.01} max={1} step={0.01} value={navPrefs.mouseSensitivity} onChange={(e) => nav('mouseSensitivity', Number(e.target.value))} />
              <span className="muted small">{navPrefs.mouseSensitivity.toFixed(2)}° a pixel</span>
            </div>
            <div className="key-row">
              <span>Fly with W A S D</span>
              <select value={navPrefs.flight} onChange={(e) => nav('flight', e.target.value as FlightControl)}>
                <option value="rmb">only with a mouse button held (Unreal’s default)</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
              <span />
            </div>
            <div className="row wrap">
              {([
                ['distanceScaled', 'Distance-scaled speed'],
                ['invertMouseY', 'Invert mouse look'],
                ['invertOrbitY', 'Invert orbit'],
                ['invertMiddlePan', 'Invert middle-mouse pan'],
                ['invertDollyY', 'Invert right-mouse dolly'],
                ['invertStickY', 'Invert the right stick'],
              ] as Array<[keyof NavPrefs, string]>).map(([k, label]) => (
                <button key={k} className={navPrefs[k] ? 'primary' : ''} onClick={() => nav(k, !navPrefs[k] as never)}>
                  {label}
                </button>
              ))}
              <button className="ghost" onClick={() => { resetNavPrefs(); navTick((t) => t + 1); }}>Unreal defaults</button>
            </div>
            <div className="muted small">
              In the 3D view the mouse and keys work as in Unreal’s editor viewport (right button looks, left moves and turns, middle pans, Alt orbits, the wheel dollies; W A S D, E Q, C Z with a button held). Unreal’s own defaults throughout, except distance-scaled speed, which is on here because the scene runs from a face to a province ({NAV_DEFAULTS.distanceScaled ? 'on' : 'off'} by default).
            </div>
          </section>
          <section className="modal-section">
            <div className="panel-label">Dialogue</div>
            <div className="row wrap">
              {(['off', 'on-demand', 'auto'] as AiMode[]).map((m) => (
                <button key={m} className={st.aiMode === m ? 'primary' : ''} onClick={() => store.setAiMode(m)}>
                  {m === 'off' ? 'Off (procedural chatter)' : m === 'on-demand' ? 'On demand' : 'Automatic when zoomed in'}
                </button>
              ))}
            </div>
            <div className="muted small">On demand: press "Script with AI" on a conversation. Automatic: every conversation that comes into view at person-level zoom is scripted (one at a time, so a local model keeps up). Transcripts are cached per seed so replays are free.</div>
          </section>
          {prefs && (
            <section className="modal-section">
              <div className="panel-label">Provider</div>
              <div className="key-row">
                <span>Serve dialogue with</span>
                <select value={prefs.provider} onChange={(e) => edit((p) => ({ ...p, provider: e.target.value as ProviderPrefs['provider'] }))}>
                  <option value="auto">auto (Ollama if running, else first key)</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai-compat">OpenAI-compatible endpoint</option>
                </select>
                <span className="muted small">{info?.effective ? `now: ${info.effective.provider} / ${info.effective.model}` : 'no provider available'}</span>
              </div>
              <div className="key-row">
                <span>Ollama model</span>
                <select value={prefs.models.ollama ?? info?.ollamaSelected ?? ''} onChange={(e) => edit((p) => ({ ...p, models: { ...p.models, ollama: e.target.value } }))}>
                  {(info?.ollamaModels ?? []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {!info?.ollamaModels.length && <option value="">(none found — is Ollama running?)</option>}
                </select>
                <button className="ghost" onClick={refresh} disabled={busy}>
                  <span className={`led ${info?.ollamaReachable ? 'live' : 'down'}`} /> refresh
                </button>
              </div>
              <div className="key-row">
                <span>gpt-oss reasoning</span>
                <select value={prefs.reasoning} onChange={(e) => edit((p) => ({ ...p, reasoning: e.target.value as ProviderPrefs['reasoning'] }))}>
                  <option value="low">low (fastest, recommended for dialogue)</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
                <span className="muted small">gpt-oss cannot switch its reasoning off</span>
              </div>
              <div className="key-row">
                <span>Compatible base URL</span>
                <input type="text" placeholder="http://localhost:1234/v1" value={prefs.compatBaseUrl ?? ''} onChange={(e) => edit((p) => ({ ...p, compatBaseUrl: e.target.value }))} />
                <span className="muted small">LM Studio, vLLM, Groq…</span>
              </div>
              {(['anthropic', 'openai', 'gemini', 'openai-compat'] as const).map((id) => (
                <div className="key-row" key={id}>
                  <span>{CLOUD.find((c) => c.id === id)!.label} model</span>
                  <input type="text" placeholder={id === 'anthropic' ? 'claude-sonnet-4-6' : id === 'openai' ? 'gpt-4o-mini' : id === 'gemini' ? 'gemini-2.0-flash' : 'model id'} value={prefs.models[id] ?? ''} onChange={(e) => edit((p) => ({ ...p, models: { ...p.models, [id]: e.target.value || undefined } }))} />
                  <span />
                </div>
              ))}
            </section>
          )}
          <section className="modal-section">
            <div className="panel-label">Keys (kept in this browser; sent to the local server in memory only)</div>
            {CLOUD.map((c) => (
              <div className="key-row" key={c.id}>
                <span>{c.label}</span>
                <input type="password" placeholder={c.placeholder} value={keys[c.id] ?? ''} onChange={(e) => { setKeys((k) => ({ ...k, [c.id]: e.target.value })); setDirty(true); }} />
                <span className={`small ${info?.configured[c.id] ? 'ok' : 'muted'}`}>{info?.configured[c.id] ? 'configured' : '—'}</span>
              </div>
            ))}
          </section>
        </div>
        <div className="modal-footer">
          <span className="muted small">{msg ?? ''}</span>
          <button className="ghost" onClick={() => api.clearCache().then((r) => setMsg(`cache cleared (${r.cleared})`))}>clear dialogue cache</button>
          <button className="primary" onClick={save} disabled={busy}>save</button>
        </div>
      </div>
    </div>
  );
}
