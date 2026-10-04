import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
// SN Pro, the Scelo typeface, bundled rather than fetched: Community Lab ships inside Scelo IDE and must look itself
// offline. Same weights as the swarm.
import '@fontsource/sn-pro/300.css';
import '@fontsource/sn-pro/400.css';
import '@fontsource/sn-pro/500.css';
import '@fontsource/sn-pro/600.css';
import '@fontsource/sn-pro/700.css';
import './styles.css';

initTheme();
// The link to Scelo when this page runs inside it (a no-op on a page of its own).
import('./lib/sceloBridge').then((m) => m.initSceloBridge());
// Debug / automation hook (used by scripts/shot.ts and handy in the console).
import('./lib/simStore').then((m) => {
  (window as unknown as { communityLab: unknown }).communityLab = { store: m.store };
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
