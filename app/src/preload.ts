/**
 * Runs in each window before the page, with context isolation and the
 * sandbox on. It exposes only the typed bridge; the page can't reach Node,
 * Electron or the file system.
 */
import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron';
import type { BrowserViews, GrimoireBridge, Platform, ViewRect } from '@grimoire/contract';

const platform: Platform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';

/** Electron starts each failure's message with "Error invoking remote method '…': Error: "; this keeps only the reason. */
function withoutIpcPrefix<T>(request: Promise<T>): Promise<T> {
  return request.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''));
  });
}

/** Tells the app what to do with a web page. */
const toBrowser = (action: string, ...args: unknown[]) =>
  ipcRenderer.send('grimoire:browser', action, ...args);

/** Listens for one kind of what the app tells of the window's web pages. */
function onBrowser<T>(kind: string, listener: (payload: T) => void): () => void {
  const handler = (_: IpcRendererEvent, name: string, payload: unknown) => {
    if (name === kind) listener(payload as T);
  };
  ipcRenderer.on('grimoire:browserEvent', handler);
  return () => ipcRenderer.removeListener('grimoire:browserEvent', handler);
}

/** A rect in the page's pixels, as the window's pixels: the page may be zoomed. */
function inWindow(rect: ViewRect): ViewRect {
  const zoom = webFrame.getZoomFactor();
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

const browser: BrowserViews = {
  open: (id, url, profile) => toBrowser('open', id, url, profile),
  navigate: (id, url) => toBrowser('navigate', id, url),
  go: (id, move) => toBrowser('go', id, move),
  place: (id, rect) => toBrowser('place', id, rect && inWindow(rect)),
  snapshot: (id) => withoutIpcPrefix(ipcRenderer.invoke('grimoire:browserSnapshot', id)),
  close: (id) => toBrowser('close', id),
  forget: (profile) => toBrowser('forget', profile),
  shortcuts: (keys) => toBrowser('shortcuts', keys),
  onChange: (listener) => onBrowser('change', listener),
  onOpen: (listener) => onBrowser('open', listener),
  onKey: (listener) => onBrowser('key', listener),
  onAction: (listener) => onBrowser('action', listener),
};

const bridge: GrimoireBridge = {
  platform,
  invoke: (command, request) =>
    withoutIpcPrefix(ipcRenderer.invoke('grimoire:invoke', command, request)),
  on: (event, listener) => {
    const handler = (_: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) listener(payload as never);
    };
    ipcRenderer.on('grimoire:event', handler);
    return () => ipcRenderer.removeListener('grimoire:event', handler);
  },
  chooseFolder: () => withoutIpcPrefix(ipcRenderer.invoke('grimoire:chooseFolder')),
  chooseFiles: () => withoutIpcPrefix(ipcRenderer.invoke('grimoire:chooseFiles')),
  pathOf: (file) => webUtils.getPathForFile(file),
  window: {
    minimize: () => ipcRenderer.send('grimoire:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('grimoire:window', 'toggleMaximize'),
    close: () => ipcRenderer.send('grimoire:window', 'close'),
  },
  openExternal: (url) => ipcRenderer.send('grimoire:openExternal', url),
  zoom: (factor) => webFrame.setZoomFactor(factor),
  browser,
};

contextBridge.exposeInMainWorld('grimoire', bridge);
