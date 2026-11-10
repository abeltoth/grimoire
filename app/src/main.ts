/**
 * The Electron app: windows only (ADR-010). All state lives in the
 * background service, which this process starts and relays to.
 */
import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { Popouts } from './popouts';
import { Service } from './service';
import { runCapture, runSmokeTest } from './smoke';
import { MainWindow, type WindowSetup, createWindow, serveUi, uiOrigin } from './windows';

const devUrl = process.env['GRIMOIRE_DEV_URL'];
const smoke = process.argv.includes('--smoke');
const captureAt = process.argv.indexOf('--capture');
const capturePath = captureAt === -1 ? undefined : process.argv[captureAt + 1];
/** Smoke tests and captures run hidden, with their own data. */
const headless = smoke || captureAt !== -1;

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

const setup: WindowSetup = {
  preload: paths.preload,
  devUrl,
  headless,
  capture: Boolean(capturePath),
};
const service = new Service(
  {
    dataDir: app.getPath('userData'),
    serviceEntry: paths.service,
    nodePath: process.execPath,
    ephemeral: headless,
    log: (message) => console.log(`[service] ${message}`),
  },
  () => mainWindow.openProfile(),
);
const popouts: Popouts = new Popouts(
  setup,
  () => service.get(),
  createWindow,
  () => mainWindow.current,
);
const mainWindow: MainWindow = new MainWindow(setup, popouts);

registerIpc(
  uiOrigin(devUrl),
  () => service.get(),
  (popout) => popouts.open(popout),
);
app.on('before-quit', () => popouts.appQuits());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => mainWindow.focus());

  app.on('window-all-closed', () => {
    // The service keeps running (ADR-010). The tray comes later.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow.open();
  });

  void app.whenReady().then(() => {
    if (!devUrl) protocol.handle('app', (request) => serveUi(paths.ui, request));
    // Start or reach the service right away, so the first command is fast.
    service.get().catch((error: unknown) => console.error(error));
    const win = mainWindow.open();
    const stop = () => service.stop();
    if (smoke) void runSmokeTest(win, stop);
    else if (captureAt !== -1) void runCapture(win, capturePath, stop);
  });
}
