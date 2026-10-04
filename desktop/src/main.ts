// Community Lab IDE, the desktop app. The window is the Community Lab client
// served by its own engine (./server.ts) on a loopback port; this process
// starts and stops that engine, draws the menus, and lends the page the few
// things a browser page cannot do (./preload.ts). Nothing here simulates: the
// engine is the same TypeScript the repository's dev pair runs.
//
// Security: the page is sandboxed with context isolation and no Node; every
// IPC call is checked to come from the engine's own origin; navigation away
// from it opens in the system browser instead; permission requests are
// refused; downloads ask where to save.

import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { LINKS, buildMenu } from './menu';
import { EngineServer } from './server';

log.initialize();
log.transports.file.level = 'info';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const devUrl = process.env.COMMUNITY_LAB_DEV_URL || null;
const repoRoot = app.isPackaged ? null : resolve(__dirname, '..', '..');
const resourcesDir = app.isPackaged ? process.resourcesPath : resolve(__dirname, '..', 'resources');

let win: BrowserWindow | null = null;
let engine: EngineServer | null = null;
let origin: string | null = null;
let dirty = false;
/** The user has agreed to lose unsaved files (or there were none): close and quit without asking again. */
let discardConfirmed = false;
let recent: string[] = [];

/** Ask once before unsaved workbench files are lost; true to go ahead. */
function confirmDiscard(): boolean {
  if (discardConfirmed || !dirty || !win) return true;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Quit without saving', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Unsaved files',
    message: 'Some files in the workbench have unsaved changes.',
    detail: 'Quit anyway and lose them, or go back and save them (File › Save All).',
  });
  if (choice === 0) discardConfirmed = true;
  return choice === 0;
}

// ── one instance ──────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

// ── window state ──────────────────────────────────────────────────────

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}
const stateFile = () => join(app.getPath('userData'), 'window.json');
function loadWindowState(): WindowState {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState;
    if (s.width >= 800 && s.height >= 560) return s;
  } catch {
    /* first run */
  }
  return { width: 1480, height: 920, maximized: false };
}
function saveWindowState(): void {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } satisfies WindowState));
  } catch {
    /* not fatal */
  }
}

// ── the window ────────────────────────────────────────────────────────

function launchPage(): string {
  return join(__dirname, '..', 'static', 'launch.html');
}

async function createWindow(): Promise<void> {
  const st = loadWindowState();
  win = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    minWidth: 1024,
    minHeight: 640,
    title: 'Community Lab IDE',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1B1815' : '#E8E4D8',
    icon: isWin ? undefined : join(resourcesDir, 'icons', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // The province keeps time while the window is in the background.
      backgroundThrottling: false,
    },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win?.show());
  win.on('close', (e) => {
    saveWindowState();
    if (!confirmDiscard()) e.preventDefault();
  });
  win.on('closed', () => {
    win = null;
  });
  guardNavigation(win);
  await win.loadFile(launchPage());

  if (devUrl) {
    origin = new URL(devUrl).origin;
    log.info(`window: dev client at ${devUrl}`);
    await win.loadURL(devUrl);
    return;
  }
  await startEngine();
}

async function startEngine(): Promise<void> {
  if (!engine) {
    engine = new EngineServer({ resourcesDir, repoRoot, userDataDir: app.getPath('userData'), isWin, log });
    engine.watch((s) => {
      if (s.state === 'starting') say('Starting the engine');
    });
  }
  await engine.start();
  try {
    const url = await engine.ready();
    origin = new URL(url).origin;
    say('Building Unity Province');
    await win?.loadURL(`${url}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('engine: not ready', msg);
    void win?.webContents.executeJavaScript(`window.setError(${JSON.stringify(`${msg} The log below, and Help › Show Logs, say more.`)}, ${JSON.stringify(engine.logTail())})`).catch(() => {});
  }
}

function say(text: string): void {
  void win?.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

/** The page may go only to the engine's own origin (or the launch screen); links elsewhere open in the browser. */
function guardNavigation(w: BrowserWindow): void {
  const allowed = (url: string) => {
    if (url.startsWith('file:') && url.endsWith('launch.html')) return true;
    try {
      return !!origin && new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  w.webContents.on('will-navigate', (e, url) => {
    if (allowed(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

// ── the bridge ────────────────────────────────────────────────────────

/** Only the IDE's own page may use the bridge. */
function fromApp(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  try {
    return !!origin && new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function registerIpc(): void {
  ipcMain.on('cl:version', (e) => {
    e.returnValue = app.getVersion();
  });
  ipcMain.handle('cl:pick-folder', async (e, opts: { title?: string; defaultPath?: string }) => {
    if (!fromApp(e) || !win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: typeof opts?.title === 'string' ? opts.title : 'Open a folder',
      defaultPath: typeof opts?.defaultPath === 'string' && existsSync(opts.defaultPath) ? opts.defaultPath : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.on('cl:show-item', (e, p: unknown) => {
    if (!fromApp(e) || typeof p !== 'string' || !isAbsolute(p) || !existsSync(p)) return;
    if (statSync(p).isDirectory()) void shell.openPath(p);
    else shell.showItemInFolder(p);
  });
  ipcMain.handle('cl:trash', async (e, p: unknown) => {
    if (!fromApp(e) || typeof p !== 'string' || !isAbsolute(p) || !existsSync(p)) return false;
    try {
      await shell.trashItem(p);
      return true;
    } catch (err) {
      log.warn('trash failed', err);
      return false;
    }
  });
  ipcMain.on('cl:open-external', (e, url: unknown) => {
    if (fromApp(e) && typeof url === 'string') openExternal(url);
  });
  ipcMain.on('cl:set-recent', (e, paths: unknown) => {
    if (!fromApp(e) || !Array.isArray(paths)) return;
    recent = paths.filter((p): p is string => typeof p === 'string').slice(0, 10);
    setMenu();
  });
  ipcMain.on('cl:set-dirty', (e, d: unknown) => {
    if (fromApp(e)) dirty = d === true;
  });
  ipcMain.on('cl:check-updates', (e) => {
    if (fromApp(e)) void checkForUpdates(true);
  });
}

function command(cmd: string, arg?: unknown): void {
  win?.webContents.send('cl:command', cmd, arg);
}

function setMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      command,
      recent: () => recent,
      about,
      checkForUpdates: () => void checkForUpdates(true),
      openLogs: () => void shell.openPath(join(app.getPath('userData'), 'logs')),
      openData: () => void shell.openPath(join(app.getPath('userData'), 'data')),
    }),
  );
}

function about(): void {
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync(join(resourcesDir, 'server', 'manifest.json'), 'utf8')) as { commit?: string; bun_version?: string; built_at?: string };
    } catch {
      return null;
    }
  })();
  void dialog.showMessageBox(win as BrowserWindow, {
    type: 'none',
    icon: join(resourcesDir, 'icons', 'icon.png'),
    title: 'About Community Lab IDE',
    message: `Community Lab IDE ${app.getVersion()}`,
    detail: [
      'An IDE for actuarial agent-based simulation: Unity Province, its people, its books and its burial society, on published South African bases.',
      '',
      `Engine ${manifest?.commit ? `commit ${manifest.commit}, ` : ''}Bun ${manifest?.bun_version ?? process.versions.node}${manifest?.built_at ? `, built ${manifest.built_at.slice(0, 10)}` : ''}`,
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
      '',
      'Scelo IDE Source-Available License v1.1. Copyright © 2026 Intelligent Actuaries (Pty) Ltd and its contributors.',
      LINKS.repo,
    ].join('\n'),
    buttons: ['OK', 'View the license'],
    defaultId: 0,
  }).then((r) => {
    if (r.response === 1) void shell.openExternal(LINKS.license);
  });
}

// ── updates ───────────────────────────────────────────────────────────
// From GitHub Releases, for the AppImage only: the release carries the
// latest-linux.yml electron-updater reads. Windows and macOS releases ship no
// update manifest, so there the menu item opens the release list instead.
// Off in a checkout, and with COMMUNITY_LAB_DISABLE_UPDATER=1 (testing a
// packaged build that is not released yet). The channel is never assigned:
// that would allow a downgrade to the previous release.

async function checkForUpdates(interactive: boolean): Promise<void> {
  const supported = app.isPackaged && process.platform === 'linux' && !!process.env.APPIMAGE && process.env.COMMUNITY_LAB_DISABLE_UPDATER !== '1';
  if (!supported) {
    if (interactive) {
      const r = await dialog.showMessageBox(win as BrowserWindow, {
        type: 'info',
        title: 'Updates',
        message: `Community Lab IDE ${app.getVersion()}`,
        detail: app.isPackaged ? 'This build updates by installing the newest release. Open the release list?' : 'A development build does not update itself.',
        buttons: app.isPackaged ? ['Open releases', 'Close'] : ['Close'],
      });
      if (app.isPackaged && r.response === 0) void shell.openExternal(LINKS.releases);
    }
    return;
  }
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.once('update-downloaded', async (info) => {
      const r = await dialog.showMessageBox(win as BrowserWindow, {
        type: 'info',
        title: 'Update ready',
        message: `Community Lab IDE ${info.version} is ready.`,
        detail: 'Restart to use it. Save your work in the workbench first.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 0 && confirmDiscard()) {
        discardConfirmed = true;
        autoUpdater.quitAndInstall();
      }
    });
    const r = await autoUpdater.checkForUpdates();
    if (interactive && (!r || !r.isUpdateAvailable)) {
      void dialog.showMessageBox(win as BrowserWindow, { type: 'info', title: 'Updates', message: 'Community Lab IDE is up to date.', detail: `Version ${app.getVersion()}.` });
    }
  } catch (e) {
    log.warn('updater', e);
    if (interactive) void dialog.showMessageBox(win as BrowserWindow, { type: 'warning', title: 'Updates', message: 'Could not check for updates.', detail: e instanceof Error ? e.message : String(e) });
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────

app.setAppUserModelId('io.intelligentactuaries.communitylab');

app.whenReady().then(async () => {
  mkdirSync(app.getPath('userData'), { recursive: true });
  // Nothing the page asks for (camera, microphone, location, notifications) is needed; the clipboard is.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  registerIpc();
  setMenu();
  await createWindow();
  if (app.isPackaged) setTimeout(() => void checkForUpdates(false), 15_000);
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (!win) void createWindow();
});

let stopped = false;
app.on('before-quit', (e) => {
  if (!confirmDiscard()) {
    e.preventDefault();
    return;
  }
  if (stopped || !engine) return;
  e.preventDefault();
  void engine.stop().finally(() => {
    stopped = true;
    app.quit();
  });
});
