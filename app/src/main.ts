/**
 * The Electron app: windows only (ADR-010). All state lives in the
 * background service, which this process starts and relays to.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, shell, type WebFrameMain } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EventPayload, Layout, LooseLeaf, Profiles } from '@grimoire/contract';
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
/** The profile in use: when another is put in use, the windows open on its chapters. */
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
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('grimoire:event', name, payload);
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
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('grimoire:chooseFiles', async (event) => {
  if (!isTrusted(event.senderFrame)) throw new Error('Untrusted sender');
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openFile' as const, 'multiSelections' as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.on('grimoire:window', (event, action: unknown) => {
  if (!isTrusted(event.senderFrame)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

ipcMain.on('grimoire:popOut', (event, chatId: unknown) => {
  if (!isTrusted(event.senderFrame) || typeof chatId !== 'string' || !chatId) return;
  openLeaf({ chatId });
});

// A web page, such as a Jira issue, opens in the system's browser; nothing but https does.
ipcMain.on('grimoire:openExternal', (event, url: unknown) => {
  if (!isTrusted(event.senderFrame) || typeof url !== 'string') return;
  if (originOf(url).startsWith('https://')) void shell.openExternal(url);
});

/** The book's window: the one that holds every chapter not popped out. */
let book: BrowserWindow | undefined;
/** The loose leaves' windows, by the chapter each holds. */
const leaves = new Map<string, BrowserWindow>();
/** The chapters popped out, as the layout keeps them so they open again with the book. */
let loose: LooseLeaf[] = [];
/** While the book closes or the app quits: the leaves close with it, and open again next time. */
let keepLeaves = false;

app.on('before-quit', () => (keepLeaves = true));

function saveLoose(): void {
  getService()
    .then((client) => client.request('layout.set', { loose } satisfies Partial<Layout>))
    .catch((error: unknown) => console.error(error));
}

/** Opens the chapters that were popped out when the book last closed, each where it was. */
function reopenLeaves(): void {
  getService()
    .then((client) => client.request('layout.get', {}))
    .then((layout) => {
      const saved = (layout as Partial<Layout> | undefined)?.loose ?? [];
      // Any popped out meanwhile stay out too.
      loose = [...saved, ...loose.filter((kept) => !saved.some((leaf) => leaf.chatId === kept.chatId))];
      for (const leaf of saved) openLeaf(leaf);
    })
    .catch((error: unknown) => console.error(error));
}

/**
 * Another profile is in use: the last one's leaves close, kept in its
 * layout as they were, and the book opens again on the new one's
 * chapters, with the leaves it had popped out.
 */
function openProfile(): void {
  // Destroyed, not closed: a leaf closing would put its chapter back, in the new profile's layout.
  for (const leaf of leaves.values()) leaf.destroy();
  leaves.clear();
  loose = [];
  if (!book) return;
  book.webContents.reload();
  if (!headless) reopenLeaves();
}

/** A popped-out chapter's window; one per chapter. */
function openLeaf(leaf: LooseLeaf): void {
  const open = leaves.get(leaf.chatId);
  if (open) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return;
  }
  const win = createWindow(leaf);
  leaves.set(leaf.chatId, win);
  if (!loose.some((kept) => kept.chatId === leaf.chatId)) {
    loose = [...loose, { chatId: leaf.chatId }];
    saveLoose();
  }
  win.on('close', () => {
    leaves.delete(leaf.chatId);
    if (keepLeaves) {
      // Closing with the book: it opens again where it is.
      const bounds = win.getNormalBounds();
      loose = loose.map((kept) => (kept.chatId === leaf.chatId ? { ...kept, bounds } : kept));
    } else {
      // Closed by itself: its chapter goes back into the book.
      loose = loose.filter((kept) => kept.chatId !== leaf.chatId);
      book?.webContents.send('grimoire:leafClosed', leaf.chatId);
    }
    saveLoose();
  });
}

/** Where a new leaf goes: one page wide, at the side of the screen the book is on. */
function leafPlace(): { width: number; height: number; x?: number; y?: number } {
  const area = screen.getDisplayMatching(book?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea;
  const width = Math.min(860, area.width);
  const height = Math.min(960, area.height);
  return { width, height, x: area.x + area.width - width, y: area.y + Math.round((area.height - height) / 2) };
}

/** Serves the built UI on app://grimoire, falling back to index.html. */
function serveUi(request: Request): Promise<Response> {
  const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
  let file = path.resolve(paths.ui, relative || 'index.html');
  if (!file.startsWith(paths.ui + path.sep)) return Promise.resolve(new Response('Not found', { status: 404 }));
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(paths.ui, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

/** The book's window, or a loose leaf's: a window on one chapter. */
function createWindow(leaf?: LooseLeaf): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const size = leaf
    ? (leaf.bounds ?? leafPlace())
    : // Captures use the design's 1920×1080 frame.
      capturePath
      ? { width: 1920, height: 1080, useContentSize: true, enableLargerThanScreen: true }
      : { width: 1600, height: 960 };
  const win = new BrowserWindow({
    ...size,
    minWidth: leaf ? 560 : 960,
    minHeight: 600,
    show: false,
    title: 'Grimoire',
    // Matches --gr-desk, so there's no white flash before the first paint.
    backgroundColor: '#15110e',
    // Grimoire draws its own title strip: native traffic lights on Mac,
    // drawn window controls elsewhere.
    ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 12 } } : { frame: false }),
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
  void win.loadURL(leaf ? `${page}?leaf=${encodeURIComponent(leaf.chatId)}` : page);
  return win;
}

/** The book's window; its leaves open again with it, and close with it. */
function openBook(): BrowserWindow {
  keepLeaves = false;
  const win = createWindow();
  book = win;
  win.on('close', () => {
    keepLeaves = true;
    for (const leaf of leaves.values()) leaf.close();
  });
  win.on('closed', () => {
    if (book === win) book = undefined;
  });
  if (!headless) reopenLeaves();
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = book ?? BrowserWindow.getAllWindows()[0];
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
    if (BrowserWindow.getAllWindows().length === 0) openBook();
  });

  void app.whenReady().then(() => {
    if (!devUrl) protocol.handle('app', serveUi);
    // Start or reach the service right away, so the first command is fast.
    getService().catch((error: unknown) => console.error(error));
    const win = openBook();
    if (smoke) void runSmokeTest(win, stopService);
    else if (captureAt !== -1) void runCapture(win, capturePath, stopService);
  });
}
