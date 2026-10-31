/**
 * Runs in each window before the page, with context isolation and the
 * sandbox on. It exposes only the typed bridge; the page can't reach Node,
 * Electron or the file system.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { GrimoireBridge, Platform } from '@grimoire/contract';

const platform: Platform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';

const bridge: GrimoireBridge = {
  platform,
  invoke: (command, request) => ipcRenderer.invoke('grimoire:invoke', command, request),
  on: (event, listener) => {
    const handler = (_: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) listener(payload as never);
    };
    ipcRenderer.on('grimoire:event', handler);
    return () => ipcRenderer.removeListener('grimoire:event', handler);
  },
  window: {
    minimize: () => ipcRenderer.send('grimoire:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('grimoire:window', 'toggleMaximize'),
    close: () => ipcRenderer.send('grimoire:window', 'close'),
  },
};

contextBridge.exposeInMainWorld('grimoire', bridge);
