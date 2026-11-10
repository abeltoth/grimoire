import { BrowserWindow, net } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Popout } from '@grimoire/contract';
import type { Popouts } from './popouts';

export const APP_ORIGIN = 'app://grimoire';

/** How the app's windows open, the same for every one. */
export interface WindowSetup {
  preload: string;
  /** The dev server's URL under npm run dev; the built UI on app://grimoire otherwise. */
  devUrl: string | undefined;
  /** Smoke tests and captures run hidden. */
  headless: boolean;
  /** A capture's main window is the design's 1920×1080 frame. */
  capture: boolean;
}

/** A window's size, and where it goes when that's known. */
export interface WindowSize {
  width: number;
  height: number;
  x?: number;
  y?: number;
  useContentSize?: boolean;
  enableLargerThanScreen?: boolean;
}

/** URL.origin is "null" for custom schemes such as app://, so build it by hand. */
export function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

/** Where the UI comes from: the only origin a window may show or call the app from. */
export function uiOrigin(devUrl: string | undefined): string {
  return devUrl ? originOf(devUrl) : APP_ORIGIN;
}

/** Serves the built UI in `uiDir` on app://grimoire, falling back to index.html. */
export function serveUi(uiDir: string, request: Request): Promise<Response> {
  const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
  let file = path.resolve(uiDir, relative || 'index.html');
  if (!file.startsWith(uiDir + path.sep))
    return Promise.resolve(new Response('Not found', { status: 404 }));
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(uiDir, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

/** The main window, or a popout's: a window on one chat. */
export function createWindow(setup: WindowSetup, size: WindowSize, popout?: Popout): BrowserWindow {
  const isMac = process.platform === 'darwin';
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
      preload: setup.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.webContents.on('will-navigate', (event) => {
    if (originOf(event.url) !== uiOrigin(setup.devUrl)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (!setup.headless) win.once('ready-to-show', () => win.show());
  const page = setup.devUrl ?? `${APP_ORIGIN}/index.html`;
  void win.loadURL(popout ? `${page}?popout=${encodeURIComponent(popout.chatId)}` : page);
  return win;
}

/** The main window: the one that holds every chat not popped out. Its popouts open again with it, and close with it. */
export class MainWindow {
  private win: BrowserWindow | undefined;

  constructor(
    private readonly setup: WindowSetup,
    private readonly popouts: Popouts,
    private readonly create: typeof createWindow = createWindow,
  ) {}

  get current(): BrowserWindow | undefined {
    return this.win;
  }

  open(): BrowserWindow {
    this.popouts.mainOpens();
    // Captures use the design's 1920×1080 frame.
    const size = this.setup.capture
      ? { width: 1920, height: 1080, useContentSize: true, enableLargerThanScreen: true }
      : { width: 1600, height: 960 };
    const win = this.create(this.setup, size);
    this.win = win;
    win.on('close', () => this.popouts.closeWithMain());
    win.on('closed', () => {
      if (this.win === win) this.win = undefined;
    });
    if (!this.setup.headless) this.popouts.reopen();
    return win;
  }

  /** Another instance was started: this one's window comes to the front instead. */
  focus(): void {
    const win = this.win ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }

  /**
   * Another profile is in use: the last one's popouts close, kept in its
   * layout as they were, and the main window opens again on the new one's
   * chats, with the popouts it had.
   */
  openProfile(): void {
    this.popouts.forget();
    if (!this.win) return;
    this.win.webContents.reload();
    if (!this.setup.headless) this.popouts.reopen();
  }
}
