// The desktop app's menu items and accelerators (desktop/src/menu.ts), as
// actions on the page. Loaded with the workbench, so the menus work in both
// views.

import { builder } from '../builder/builderStore';
import { store } from '../lib/simStore';
import type { DesktopCommand } from './desktop';
import { runFile } from './run';
import { saveProvinceAsScenario, workspace } from './workspace';

const bench = () => store.setView('workbench');

/** While the Community Builder is open it is the whole window: Save keeps the world, Settings and Help open over
 *  it, and the rest wait until it is left (a command for a view or a file would act out of sight). */
function builderCommand(cmd: DesktopCommand): void {
  if (cmd === 'file:save' || cmd === 'file:save-all') void builder.save();
  else if (cmd === 'settings:open') store.set('settingsOpen', true);
  else if (cmd === 'help:open') store.set('helpOpen', true);
  else builder.say('Leave the builder (Back to the simulation) to use that.');
}

export function command(cmd: DesktopCommand, arg?: unknown): void {
  if (builder.active) return builderCommand(cmd);
  switch (cmd) {
    case 'view:province':
      store.setView('province');
      break;
    case 'view:workbench':
      bench();
      break;
    case 'workspace:open':
      bench();
      void workspace.pickAndOpen();
      break;
    case 'workspace:new':
      bench();
      void workspace.close().catch(() => {});
      break;
    case 'workspace:recent':
      bench();
      if (typeof arg === 'string') void workspace.open(arg);
      break;
    case 'workspace:close':
      void workspace.close();
      break;
    case 'file:new-province':
      bench();
      void workspace.newFile('province');
      break;
    case 'file:new-experiment':
      bench();
      void workspace.newFile('experiment');
      break;
    case 'file:new-script':
      bench();
      void workspace.newFile('script');
      break;
    case 'file:new-note':
      bench();
      void workspace.newFile('note');
      break;
    case 'file:save':
      void workspace.save();
      break;
    case 'file:save-all':
      void workspace.saveAll();
      break;
    case 'file:close':
      if (workspace.state.active) workspace.requestClose(workspace.state.active);
      break;
    case 'scenario:save-current':
      bench();
      void saveProvinceAsScenario().catch((e) => workspace.log('error', e instanceof Error ? e.message : String(e)));
      break;
    case 'run:active':
      if (store.view === 'workbench') void runFile();
      break;
    case 'run:stop':
      workspace.stop();
      break;
    case 'panel:toggle':
      bench();
      workspace.setPanel(workspace.state.panel ? null : 'console');
      break;
    case 'explorer:toggle':
      bench();
      workspace.setExplorer(!workspace.state.explorerOpen);
      break;
    case 'sim:toggle':
      store.toggle();
      break;
    case 'sim:step':
      store.step(60);
      break;
    case 'sim:rewind':
      store.rebuild(store.params);
      break;
    case 'sim:speed':
      if (typeof arg === 'string') store.setSpeed(arg);
      break;
    case 'drawer:open':
      store.setView('province');
      store.openDrawer(typeof arg === 'string' ? arg : null);
      break;
    case 'view:3d':
      store.set('view3d', !store.view3d);
      break;
    case 'settings:open':
      store.set('settingsOpen', true);
      break;
    case 'help:open':
      store.setView('province');
      store.set('helpOpen', true);
      break;
  }
}
