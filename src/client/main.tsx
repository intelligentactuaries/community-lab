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
import('./lib/simStore').then((m) => {
  (window as unknown as { communityLab: unknown }).communityLab = { store: m.store };
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
