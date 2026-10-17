import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
// SN Pro, the typeface of the Intelligent Actuaries apps, bundled rather than fetched: the desktop IDE runs offline
// and must look itself without a network.
import '@fontsource/sn-pro/300.css';
import '@fontsource/sn-pro/400.css';
import '@fontsource/sn-pro/500.css';
import '@fontsource/sn-pro/600.css';
import '@fontsource/sn-pro/700.css';
import './styles.css';

initTheme();
// Debug / automation hook (used by scripts/shot.ts and handy in the console).
Promise.all([import('./lib/simStore'), import('./builder/builderStore'), import('./builder/BuilderCanvas'), import('../sim/plan/edit')]).then(([m, b, c, edit]) => {
  (window as unknown as { communityLab: unknown }).communityLab = { store: m.store, builder: b.builder, builderOps: { ...c, ...edit } };
});
/** A crash says what happened and offers a reload, instead of leaving a blank window (the desktop app's console is
 *  out of sight). */
class Crash extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Community Lab stopped', error, info.componentStack);
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div role="alert" style={{ padding: 24, font: '14px/1.5 system-ui, sans-serif', color: '#e8e6e1', background: '#181715', minHeight: '100vh' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Community Lab stopped</h2>
        <p style={{ margin: '0 0 12px', opacity: 0.85 }}>{e.message}</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.6, margin: '0 0 16px' }}>{(e.stack ?? '').split('\n').slice(0, 6).join('\n')}</pre>
        <button type="button" onClick={() => location.reload()} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #555', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
          Reload Community Lab
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Crash>
      <App />
    </Crash>
  </React.StrictMode>,
);
