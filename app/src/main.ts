/**
 * The Electron app: windows only (ADR-010). All state lives in the
 * background service, which this process starts and relays to.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  screen,
  shell,
  type WebFrameMain,
} from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EventPayload, Layout, Popout, Profiles } from '@grimoire/contract';
import { ActiveProfile } from './active-profile';
import type { ServiceClient } from './service-client';
import { ensureService } from './service-launcher';
import { runCapture, runSmokeTest } from './smoke';

const devUrl = process.env['GRIMOIRE_DEV_URL'];
const smoke = process.argv.includes('--smoke');
const captureAt = process.argv.indexOf('--capture');
const capturePath = captureAt === -1 ? undefined : process.argv[captureAt + 1];
/** Smoke tests and captures run hidden, with their own data. */
const headless = smoke || captureAt !== -1;
const APP_ORIGIN = 'app://grimoire';

// Captures are pixel-for-pixel 1920×1080, whatever the screen's scaling.
if (captureAt !== -1) app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Dev and headless runs keep their own data, and so their own service.
const profile = headless ? 'Grimoire Smoke' : devUrl ? 'Grimoire Dev' : 'Grimoire';
app.setName('Grimoire');
app.setPath('userData', path.join(app.getPath('appData'), profile));

const root = path.resolve(__dirname, '..', '..');
const paths = {
  preload: path.join(__dirname, 'preload.cjs'),
  service: path.join(root, 'service', 'dist', 'service.mjs'),
  ui: path.join(root, 'ui', 'dist', 'ui', 'browser'),
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let service: Promise<ServiceClient> | undefined;
/** The profile in use: when another is put in use, the windows open on its chats. */
const activeProfile = new ActiveProfile();

function getService(): Promise<ServiceClient> {
  service ??= ensureService({
    dataDir: app.getPath('userData'),
    serviceEntry: paths.service,
    nodePath: process.execPath,
    ephemeral: headless,
    log: (message) => console.log(`[service] ${message}`),
  }).then(
    (client) => {
      client.on('close', () => (service = undefined));
      client.on('event', (name, payload) => {
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send('grimoire:event', name, payload);
        if (name !== 'profiles.changed') return;
        const { profiles } = payload as EventPayload<'profiles.changed'>;
        if (activeProfile.changedTo(profiles.active)) openProfile();
      });
      client
        .request('profiles.list', {})
        .then((profiles) => {
          if (activeProfile.changedTo((profiles as Profiles).active)) openProfile();
        })
        .catch((error: unknown) => console.error(error));
      return client;
    },
    (error: unknown) => {
      service = undefined;
      throw error;
    },
  );
  return service;
}

async function stopService(): Promise<void> {
  const client = await getService();
  const closed = new Promise<void>((resolve) => client.once('close', resolve));
  client.shutdown();
  await closed;
}

function uiOrigin(): string {
  return devUrl ? originOf(devUrl) : APP_ORIGIN;
}

/** URL.origin is "null" for custom schemes such as app://, so build it by hand. */
function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function isTrusted(frame: WebFrameMain | null): boolean {
  return frame !== null && originOf(frame.url) === uiOrigin();
}

ipcMain.handle('grimoire:invoke', async (event, command: unknown, request: unknown) => {
  if (!isTrusted(event.senderFrame)) throw new Error('Untrusted sender');
  if (typeof command !== 'string') throw new Error('The command name must be a string');
  return (await getService()).request(command, request);
});

ipcMain.handle('grimoire:chooseFolder', async (event) => {
  if (!isTrusted(event.senderFrame)) throw new Error('Untrusted sender');
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openDirectory' as const] };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('grimoire:chooseFiles', async (event) => {
  if (!isTrusted(event.senderFrame)) throw new Error('Untrusted sender');
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openFile' as const, 'multiSelections' as const] };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.on('grimoire:window', (event, action: unknown) => {
  if (!isTrusted(event.senderFrame)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize' && win.isMaximized()) win.unmaximize();
  else if (action === 'toggleMaximize') win.maximize();
  else if (action === 'close') win.close();
});

ipcMain.on('grimoire:popOut', (event, chatId: unknown) => {
  if (!isTrusted(event.senderFrame) || typeof chatId !== 'string' || !chatId) return;
  openPopout({ chatId });
});

// A web page, such as a Jira issue, opens in the system's browser; nothing but https does.
ipcMain.on('grimoire:openExternal', (event, url: unknown) => {
  if (!isTrusted(event.senderFrame) || typeof url !== 'string') return;
  if (originOf(url).startsWith('https://')) void shell.openExternal(url);
});

/** The main window: the one that holds every chat not popped out. */
let mainWindow: BrowserWindow | undefined;
/** The popouts' windows, by the chat each holds. */
const popoutWindows = new Map<string, BrowserWindow>();
/** The chats popped out, as the layout keeps them so they open again with the main window. */
let popouts: Popout[] = [];
/** While the main window closes or the app quits: the popouts close with it, and open again next time. */
let keepPopouts = false;

app.on('before-quit', () => (keepPopouts = true));

function savePopouts(): void {
  getService()
    .then((client) => client.request('layout.set', { popouts } satisfies Partial<Layout>))
    .catch((error: unknown) => console.error(error));
}

/** Opens the chats that were popped out when the main window last closed, each where it was. */
function reopenPopouts(): void {
  getService()
    .then((client) => client.request('layout.get', {}))
    .then((layout) => {
      const saved = (layout as Partial<Layout> | undefined)?.popouts ?? [];
      // Any popped out meanwhile stay out too.
      popouts = [
        ...saved,
        ...popouts.filter((kept) => !saved.some((popout) => popout.chatId === kept.chatId)),
      ];
      for (const popout of saved) openPopout(popout);
    })
    .catch((error: unknown) => console.error(error));
}

/**
 * Another profile is in use: the last one's popouts close, kept in its
 * layout as they were, and the main window opens again on the new one's
 * chats, with the popouts it had.
 */
function openProfile(): void {
  // Destroyed, not closed: a popout closing would put its chat back, in the new profile's layout.
  for (const popout of popoutWindows.values()) popout.destroy();
  popoutWindows.clear();
  popouts = [];
  if (!mainWindow) return;
  mainWindow.webContents.reload();
  if (!headless) reopenPopouts();
}

/** A popped-out chat's window; one per chat. */
function openPopout(popout: Popout): void {
  const open = popoutWindows.get(popout.chatId);
  if (open) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return;
  }
  const win = createWindow(popout);
  popoutWindows.set(popout.chatId, win);
  if (!popouts.some((kept) => kept.chatId === popout.chatId)) {
    popouts = [...popouts, { chatId: popout.chatId }];
    savePopouts();
  }
  win.on('close', () => {
    popoutWindows.delete(popout.chatId);
    if (keepPopouts) {
      // Closing with the main window: it opens again where it is.
      const bounds = win.getNormalBounds();
      popouts = popouts.map((kept) => (kept.chatId === popout.chatId ? { ...kept, bounds } : kept));
    } else {
      // Closed by itself: its chat goes back into the main window.
      popouts = popouts.filter((kept) => kept.chatId !== popout.chatId);
      mainWindow?.webContents.send('grimoire:popoutClosed', popout.chatId);
    }
    savePopouts();
  });
}

/** Where a new popout goes: one page wide, at the side of the screen the main window is on. */
function popoutPlace(): { width: number; height: number; x?: number; y?: number } {
  const area = screen.getDisplayMatching(
    mainWindow?.getBounds() ?? screen.getPrimaryDisplay().bounds,
  ).workArea;
  const width = Math.min(860, area.width);
  const height = Math.min(960, area.height);
  return {
    width,
    height,
    x: area.x + area.width - width,
    y: area.y + Math.round((area.height - height) / 2),
  };
}

/** Serves the built UI on app://grimoire, falling back to index.html. */
function serveUi(request: Request): Promise<Response> {
  const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
  let file = path.resolve(paths.ui, relative || 'index.html');
  if (!file.startsWith(paths.ui + path.sep))
    return Promise.resolve(new Response('Not found', { status: 404 }));
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(paths.ui, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

/** The main window, or a popout's: a window on one chat. */
function createWindow(popout?: Popout): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const size = popout
    ? (popout.bounds ?? popoutPlace())
    : // Captures use the design's 1920×1080 frame.
      capturePath
      ? { width: 1920, height: 1080, useContentSize: true, enableLargerThanScreen: true }
      : { width: 1600, height: 960 };
  const win = new BrowserWindow({
    ...size,
    minWidth: popout ? 560 : 960,
    minHeight: 600,
    show: false,
    title: 'Grimoire',
    // Matches --gr-desk, so there's no white flash before the first paint.
    backgroundColor: '#15110e',
    // Grimoire draws its own title bar: native traffic lights on Mac,
    // drawn window controls elsewhere.
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 12 } }
      : { frame: false }),
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.webContents.on('will-navigate', (event) => {
    if (originOf(event.url) !== uiOrigin()) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (!headless) win.once('ready-to-show', () => win.show());
  const page = devUrl ?? `${APP_ORIGIN}/index.html`;
  void win.loadURL(popout ? `${page}?popout=${encodeURIComponent(popout.chatId)}` : page);
  return win;
}

/** The main window; its popouts open again with it, and close with it. */
function openMainWindow(): BrowserWindow {
  keepPopouts = false;
  const win = createWindow();
  mainWindow = win;
  win.on('close', () => {
    keepPopouts = true;
    for (const popout of popoutWindows.values()) popout.close();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  if (!headless) reopenPopouts();
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    // The service keeps running (ADR-010). The tray comes later.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });

  void app.whenReady().then(() => {
    if (!devUrl) protocol.handle('app', serveUi);
    // Start or reach the service right away, so the first command is fast.
    getService().catch((error: unknown) => console.error(error));
    const win = openMainWindow();
    if (smoke) void runSmokeTest(win, stopService);
    else if (captureAt !== -1) void runCapture(win, capturePath, stopService);
  });
}
