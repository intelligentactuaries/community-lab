// The application menu. Every item that acts on the page sends a command
// (src/client/workbench/commands.ts); the accelerators are the workbench's
// own, so a key works the same from the menu and from the editor.

import { Menu, type MenuItemConstructorOptions, app, shell } from 'electron';

export const LINKS = {
  site: 'https://intelligentactuaries.com/community-lab',
  repo: 'https://github.com/intelligentactuaries/community-lab',
  issues: 'https://github.com/intelligentactuaries/community-lab/issues/new',
  releases: 'https://github.com/intelligentactuaries/community-lab/releases',
  license: 'https://github.com/intelligentactuaries/community-lab/blob/main/LICENSE',
  odd: 'https://github.com/intelligentactuaries/community-lab/blob/main/docs/ODD.md',
  assumptions: 'https://github.com/intelligentactuaries/community-lab/blob/main/docs/ASSUMPTIONS.md',
  workbench: 'https://github.com/intelligentactuaries/community-lab/blob/main/docs/WORKBENCH.md',
};

/** The speeds the province offers (src/sim/params.ts SPEED_PRESETS), for the Simulation menu. */
const SPEEDS: Array<[string, string]> = [
  ['realtime', 'Real time'],
  ['x10', '10 seconds a second'],
  ['x60', 'A minute a second'],
  ['x600', 'Ten minutes a second'],
  ['hour', 'An hour a second'],
  ['day', 'A day a second'],
  ['week', 'A week a second'],
  ['month', 'A month a second'],
  ['year', 'A year a second'],
  ['lapse30', 'Thirty years a minute'],
];

const DRAWERS: Array<[string, string]> = [
  ['population', 'Population'],
  ['mortality', 'Mortality A/E'],
  ['fertility', 'Fertility'],
  ['health', 'Health'],
  ['economy', 'Economy'],
  ['finance', 'Finance and tax'],
  ['actuarial', 'Actuarial science'],
  ['insurance', 'The burial society'],
  ['social', 'Social and church'],
  ['safety', 'Safety and the court'],
  ['education', 'Education'],
  ['weather', 'Weather'],
];

export interface MenuHooks {
  command: (cmd: string, arg?: unknown) => void;
  recent: () => string[];
  about: () => void;
  checkForUpdates: () => void;
  openLogs: () => void;
  openData: () => void;
}

export function buildMenu(h: MenuHooks): Menu {
  const mac = process.platform === 'darwin';
  const c = (cmd: string, arg?: unknown) => () => h.command(cmd, arg);
  const recent = h.recent();
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? ([
          {
            label: 'Community Lab IDE',
            submenu: [
              { label: 'About Community Lab IDE', click: h.about },
              { label: 'Check for Updates…', click: h.checkForUpdates },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: c('settings:open') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide Community Lab IDE' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit Community Lab IDE' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          submenu: [
            { label: 'Province File', accelerator: 'CmdOrCtrl+N', click: c('file:new-province') },
            { label: 'Experiment File', click: c('file:new-experiment') },
            { label: 'Script', click: c('file:new-script') },
            { label: 'Note', click: c('file:new-note') },
            { type: 'separator' },
            { label: 'The Province on Screen, as a File', click: c('scenario:save-current') },
          ],
        },
        { label: 'New Workspace…', click: c('workspace:new') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: c('workspace:open') },
        {
          label: 'Open Recent',
          enabled: recent.length > 0,
          submenu: recent.length ? recent.map((p) => ({ label: p, click: c('workspace:recent', p) })) : [{ label: 'Nothing yet', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: c('file:save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: c('file:save-all') },
        { type: 'separator' },
        { label: 'Close File', accelerator: 'CmdOrCtrl+W', click: c('file:close') },
        { label: 'Close Workspace', click: c('workspace:close') },
        ...(mac
          ? []
          : ([
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Ctrl+,', click: c('settings:open') },
              { type: 'separator' },
              { role: 'quit', label: 'Quit', accelerator: 'Ctrl+Q' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Province', accelerator: 'CmdOrCtrl+1', click: c('view:province') },
        { label: 'Workbench', accelerator: 'CmdOrCtrl+2', click: c('view:workbench') },
        { type: 'separator' },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+B', click: c('explorer:toggle') },
        { label: 'Console and Problems', accelerator: 'CmdOrCtrl+J', click: c('panel:toggle') },
        { label: '3D Close-up', click: c('view:3d') },
        { type: 'separator' },
        { label: 'Analytics', submenu: DRAWERS.map(([id, label]) => ({ label, click: c('drawer:open', id) })) },
        { label: 'Exports', click: c('drawer:open', 'exports') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Simulation',
      submenu: [
        { label: 'Play or Pause', click: c('sim:toggle') },
        { label: 'Step an Hour', click: c('sim:step') },
        { label: 'Rewind to Day 0', click: c('sim:rewind') },
        { type: 'separator' },
        { label: 'Speed', submenu: SPEEDS.map(([id, label]) => ({ label, click: c('sim:speed', id) })) },
      ],
    },
    {
      label: 'Run',
      submenu: [
        { label: 'Run the File', accelerator: 'CmdOrCtrl+Enter', click: c('run:active') },
        { label: 'Stop', accelerator: 'CmdOrCtrl+Shift+Enter', click: c('run:stop') },
        { type: 'separator' },
        { label: 'Policy and Stress Lab', click: c('drawer:open', 'lab') },
        { label: 'Monte Carlo', click: c('drawer:open', 'montecarlo') },
        { label: 'Basis', click: c('drawer:open', 'basis') },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: c('help:open') },
        { label: 'The Workbench and Its Files', click: () => void shell.openExternal(LINKS.workbench) },
        { label: 'Model Description (ODD)', click: () => void shell.openExternal(LINKS.odd) },
        { label: 'Assumptions and Their Sources', click: () => void shell.openExternal(LINKS.assumptions) },
        { type: 'separator' },
        { label: 'Community Lab on the Web', click: () => void shell.openExternal(LINKS.site) },
        { label: 'Release Notes', click: () => void shell.openExternal(LINKS.releases) },
        { label: 'Report an Issue', click: () => void shell.openExternal(LINKS.issues) },
        { label: 'View the License', click: () => void shell.openExternal(LINKS.license) },
        { type: 'separator' },
        { label: 'Show Logs', click: h.openLogs },
        { label: 'Show Data Folder', click: h.openData },
        ...(mac
          ? []
          : ([
              { type: 'separator' },
              { label: 'Check for Updates…', click: h.checkForUpdates },
              { label: 'About Community Lab IDE', click: h.about },
            ] as MenuItemConstructorOptions[])),
      ],
    },
  ];
  void app;
  return Menu.buildFromTemplate(template);
}
