import { Suspense, lazy, useEffect, useState } from 'react';
import { SPEED_PRESETS } from '../sim/params';
import { AnalyticsDrawer } from './components/AnalyticsDrawer';
import { HelpOverlay } from './components/HelpOverlay';
import { Inspector } from './components/Inspector';
import { MapCanvas } from './components/MapCanvas';
import { SceneControls } from './components/SceneControls';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { StatsStrip } from './components/StatsStrip';
import { PanelLeft, PanelRight } from './components/Icons';
import { TopBar } from './components/TopBar';
import { api, syncProvidersToServer, type ProvidersInfo } from './lib/api';
import { navState } from './lib/controls';
import { aiStatus } from './lib/dialogue';
import { store, useStore } from './lib/simStore';
import { desktop } from './workbench/desktop';

// The workbench (Monaco, the script runtime) loads the first time it is opened.
const Workbench = lazy(() => import('./workbench/Workbench'));
const workbenchCommands = () => import('./workbench/commands');

export function App() {
  const st = useStore();
  const [info, setInfo] = useState<ProvidersInfo | null>(null);
  useEffect(() => {
    let alive = true;
    syncProvidersToServer()
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null));
    const t = setInterval(() => api.providers().then((i) => alive && setInfo(i)).catch(() => alive && setInfo(null)), 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  // The desktop app's menus and accelerators arrive as commands.
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    return d.onCommand((cmd, arg) => void workbenchCommands().then((m) => m.command(cmd, arg)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+1 and +2 switch the views from anywhere.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        store.setView(e.key === '1' ? 'province' : 'workbench');
        return;
      }
      // The province's own keys belong to the province view; the workbench has an editor's.
      if (store.view !== 'province') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // While a mouse button flies the 3D view its keys are the viewport's (F is "down", as in Unreal), not these.
      if (navState.flying && e.key !== 'Escape') return;
      if (e.key === ' ') {
        e.preventDefault();
        store.toggle();
      } else if (e.key === 'Escape') {
        if (st.sceneOpen) store.setScene(false);
        else if (st.settingsOpen || st.helpOpen) {
          store.set('settingsOpen', false);
          store.set('helpOpen', false);
        } else if (st.drawerTab) store.openDrawer(null);
        else if (st.followId || st.drill !== 'province') store.drillOut();
        else store.select(null);
      } else if (e.key >= '0' && e.key <= '9') {
        const idx = e.key === '0' ? 9 : Number(e.key) - 1;
        if (SPEED_PRESETS[idx]) store.setSpeed(SPEED_PRESETS[idx].id);
      } else if (e.key === 'f' || e.key === 'F') {
        if (st.selection?.kind === 'person') store.select(st.selection, { follow: !st.followId, focus: true });
      } else if (e.key === '[') store.set('sidebarOpen', !st.sidebarOpen);
      else if (e.key === ']') store.set('inspectorOpen', !st.inspectorOpen);
      else if (e.key === 'l' || e.key === 'L') store.set('legendOpen', !st.legendOpen);
      else if (e.key === '?') store.set('helpOpen', !st.helpOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.settingsOpen, st.helpOpen, st.sceneOpen, st.drawerTab, st.followId, st.drill, st.selection, st.sidebarOpen, st.inspectorOpen, st.legendOpen]);
  const bench = st.view === 'workbench';
  return (
    <div className={`app ${bench ? 'in-workbench' : ''}`}>
      <TopBar info={info} aiBusy={aiStatus.inflight > 0} />
      {!bench && <SceneControls />}
      {/* The province stays mounted under the workbench: its clock keeps time and its 3D scene keeps its state. */}
      <div className={`body ${st.sidebarOpen ? '' : 'no-side'} ${st.inspectorOpen ? '' : 'no-insp'} ${bench ? 'behind' : ''}`} aria-hidden={bench}>
        {/* Panel toggles live under the header, pinned to the top corner of the
            panel each one controls (and staying put when that panel closes). */}
        <button className="icon panel-toggle left" title={`${st.sidebarOpen ? 'Hide' : 'Show'} the scenario & lists panel ([)`} aria-label="Toggle the left panel" aria-expanded={st.sidebarOpen} onClick={() => store.set('sidebarOpen', !st.sidebarOpen)}>
          <PanelLeft />
        </button>
        <button className="icon panel-toggle right" title={`${st.inspectorOpen ? 'Hide' : 'Show'} the inspector (])`} aria-label="Toggle the right panel" aria-expanded={st.inspectorOpen} onClick={() => store.set('inspectorOpen', !st.inspectorOpen)}>
          <PanelRight />
        </button>
        <Sidebar />
        <div className="stage-wrap">
          <MapCanvas />
          <AnalyticsDrawer />
          <StatsStrip />
        </div>
        <Inspector />
      </div>
      {bench && (
        <Suspense fallback={<div className="workbench wb-loading muted">Opening the workbench…</div>}>
          <Workbench />
        </Suspense>
      )}
      <SettingsModal info={info} onInfo={setInfo} />
      <HelpOverlay />
    </div>
  );
}
