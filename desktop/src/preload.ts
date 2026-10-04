// The bridge between the page and the desktop: a handful of things a browser
// page cannot do (a native folder picker, the system's trash and file
// manager, the menus), and nothing else. The page's side of the contract is
// src/client/workbench/desktop.ts; the main process checks that every call
// comes from the IDE's own origin (main.ts).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const platform = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';

contextBridge.exposeInMainWorld('communityLabDesktop', {
  version: String(ipcRenderer.sendSync('cl:version')),
  platform,
  pickFolder: (opts?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke('cl:pick-folder', opts ?? {}),
  showItemInFolder: (absPath: string) => ipcRenderer.send('cl:show-item', absPath),
  trashItem: (absPath: string) => ipcRenderer.invoke('cl:trash', absPath),
  openExternal: (url: string) => ipcRenderer.send('cl:open-external', url),
  setRecentWorkspaces: (paths: string[]) => ipcRenderer.send('cl:set-recent', paths),
  setDirty: (dirty: boolean) => ipcRenderer.send('cl:set-dirty', !!dirty),
  checkForUpdates: () => ipcRenderer.send('cl:check-updates'),
  onCommand: (fn: (cmd: string, arg?: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, cmd: string, arg?: unknown) => fn(cmd, arg);
    ipcRenderer.on('cl:command', listener);
    return () => ipcRenderer.removeListener('cl:command', listener);
  },
});
