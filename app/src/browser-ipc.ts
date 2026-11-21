import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebFrameMain,
  ipcMain,
} from 'electron';
import type { BrowserMove, Platform, ViewRect } from '@grimoire/contract';
import { forgetProfile } from './browser-session';
import { Browsers } from './browser-views';

const platform: Platform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
const MOVES = new Set<unknown>(['back', 'forward', 'reload', 'stop']);

const isText = (value: unknown): value is string => typeof value === 'string';

/** A rect as the window sent it, in whole pixels, or null when it isn't one. */
export function rectOf(value: unknown): ViewRect | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const sides = [x, y, width, height];
  if (!sides.every((side) => typeof side === 'number' && Number.isFinite(side))) return null;
  const [left, top, wide, high] = (sides as number[]).map(Math.round) as [
    number,
    number,
    number,
    number,
  ];
  return { x: left, y: top, width: Math.max(0, wide), height: Math.max(0, high) };
}

/**
 * What a window asks of its web pages, through the preload script's
 * `browser`. Anything not from `isTrusted`, the UI's origin, is refused,
 * so a web page can't drive another.
 */
export function registerBrowserIpc(isTrusted: (frame: WebFrameMain | null) => boolean): void {
  const each = new WeakMap<BrowserWindow, Browsers>();
  const browsersOf = (event: IpcMainEvent | IpcMainInvokeEvent): Browsers | undefined => {
    if (!isTrusted(event.senderFrame)) return undefined;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return undefined;
    let browsers = each.get(win);
    if (!browsers) each.set(win, (browsers = new Browsers(win, platform)));
    return browsers;
  };

  ipcMain.on('grimoire:browser', (event, action: unknown, id: unknown, ...args: unknown[]) => {
    const browsers = browsersOf(event);
    if (!browsers) return;
    const [first, second] = args;
    if (action === 'shortcuts' && Array.isArray(id)) browsers.setShortcuts(id.filter(isText));
    else if (action === 'forget' && isText(id)) void forgetProfile(id);
    if (!isText(id)) return;
    if (action === 'open' && isText(first) && isText(second)) browsers.open(id, first, second);
    else if (action === 'navigate' && isText(first)) browsers.navigate(id, first);
    else if (action === 'go' && MOVES.has(first)) browsers.go(id, first as BrowserMove);
    else if (action === 'place') browsers.place(id, rectOf(first));
    else if (action === 'close') browsers.close(id);
  });

  ipcMain.handle('grimoire:browserSnapshot', async (event, id: unknown) => {
    const browsers = browsersOf(event);
    if (!browsers) throw new Error('Untrusted sender');
    return isText(id) ? browsers.snapshot(id) : '';
  });
}
