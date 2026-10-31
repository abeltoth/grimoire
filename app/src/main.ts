/**
 * The Electron app: windows only (ADR-010). All state lives in the
 * background service, which this process starts and relays to.
 */
import { app, BrowserWindow, ipcMain, net, protocol, type WebFrameMain } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServiceClient } from './service-client';
import { ensureService } from './service-launcher';
import { runSmokeTest } from './smoke';

const devUrl = process.env['GRIMOIRE_DEV_URL'];
const smoke = process.argv.includes('--smoke');
const APP_ORIGIN = 'app://grimoire';

// Dev and smoke runs keep their own data, and so their own service.
const profile = smoke ? 'Grimoire Smoke' : devUrl ? 'Grimoire Dev' : 'Grimoire';
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

function getService(): Promise<ServiceClient> {
  service ??= ensureService({
    dataDir: app.getPath('userData'),
    serviceEntry: paths.service,
    nodePath: process.execPath,
    log: (message) => console.log(`[service] ${message}`),
  }).then(
    (client) => {
      client.on('close', () => (service = undefined));
      client.on('event', (name, payload) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('grimoire:event', name, payload);
      });
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

ipcMain.on('grimoire:window', (event, action: unknown) => {
  if (!isTrusted(event.senderFrame)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

/** Serves the built UI on app://grimoire, falling back to index.html. */
function serveUi(request: Request): Promise<Response> {
  const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
  let file = path.resolve(paths.ui, relative || 'index.html');
  if (!file.startsWith(paths.ui + path.sep)) return Promise.resolve(new Response('Not found', { status: 404 }));
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(paths.ui, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 960,
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
  if (!smoke) win.once('ready-to-show', () => win.show());
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  void app.whenReady().then(() => {
    if (!devUrl) protocol.handle('app', serveUi);
    // Start or reach the service right away, so the first command is fast.
    getService().catch((error: unknown) => console.error(error));
    const win = createWindow();
    if (smoke) void runSmokeTest(win, stopService);
  });
}
