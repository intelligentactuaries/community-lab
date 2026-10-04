// The desktop app's bridge (desktop/src/preload.ts), when the page runs in
// Community Lab IDE rather than a browser. Everything here degrades: in a
// browser (the dev pair, `bun run dev`) there is no bridge, and the
// workbench falls back to typing a folder's path and to the server's own
// trash.

export type DesktopCommand =
  | 'view:province'
  | 'view:workbench'
  | 'workspace:open'
  | 'workspace:new'
  | 'workspace:recent'
  | 'workspace:close'
  | 'file:new-province'
  | 'file:new-experiment'
  | 'file:new-script'
  | 'file:new-note'
  | 'file:save'
  | 'file:save-all'
  | 'file:close'
  | 'scenario:save-current'
  | 'run:active'
  | 'run:stop'
  | 'panel:toggle'
  | 'explorer:toggle'
  | 'sim:toggle'
  | 'sim:step'
  | 'sim:rewind'
  | 'sim:speed'
  | 'drawer:open'
  | 'view:3d'
  | 'settings:open'
  | 'help:open';

export interface DesktopBridge {
  readonly version: string;
  readonly platform: 'linux' | 'win32' | 'darwin';
  /** A native folder picker; null when cancelled. */
  pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>;
  /** Show a file or folder in the system's file manager. */
  showItemInFolder(absPath: string): void;
  /** Move to the system's trash. */
  trashItem(absPath: string): Promise<boolean>;
  /** Open a link in the default browser. */
  openExternal(url: string): void;
  /** The File menu's recent workspaces follow the workbench's. */
  setRecentWorkspaces(paths: string[]): void;
  /** Whether the workbench has unsaved files (the app asks before quitting). */
  setDirty(dirty: boolean): void;
  /** Menu items and accelerators, sent to the page. Returns the unsubscribe. */
  onCommand(fn: (cmd: DesktopCommand, arg?: unknown) => void): () => void;
  checkForUpdates(): void;
}

export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { communityLabDesktop?: DesktopBridge }).communityLabDesktop ?? null;
}

/** "Ctrl" or "⌘", for the shortcut hints. */
export function modKey(): string {
  const d = desktop();
  const mac = d ? d.platform === 'darwin' : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return mac ? '⌘' : 'Ctrl';
}
