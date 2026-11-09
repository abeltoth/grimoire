/**
 * Runs in each window before the page, with context isolation and the
 * sandbox on. It exposes only the typed bridge; the page can't reach Node,
 * Electron or the file system.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { GrimoireBridge, Platform } from '@grimoire/contract';

const platform: Platform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';

/** Electron starts each failure's message with "Error invoking remote method '…': Error: "; this keeps only the reason. */
function withoutIpcPrefix<T>(request: Promise<T>): Promise<T> {
  return request.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''));
  });
}

const bridge: GrimoireBridge = {
  platform,
  invoke: (command, request) => withoutIpcPrefix(ipcRenderer.invoke('grimoire:invoke', command, request)),
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
  popOut: (chatId) => ipcRenderer.send('grimoire:popOut', chatId),
  onPopoutClosed: (listener) => {
    const handler = (_: IpcRendererEvent, chatId: string) => listener(chatId);
    ipcRenderer.on('grimoire:popoutClosed', handler);
    return () => ipcRenderer.removeListener('grimoire:popoutClosed', handler);
  },
  openExternal: (url) => ipcRenderer.send('grimoire:openExternal', url),
};

contextBridge.exposeInMainWorld('grimoire', bridge);
