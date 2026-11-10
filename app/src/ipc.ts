import { BrowserWindow, type WebFrameMain, dialog, ipcMain, shell } from 'electron';
import type { Popout } from '@grimoire/contract';
import type { ServiceClient } from './service-client';
import { originOf } from './windows';

/**
 * What a window asks of the app through the preload script: commands for
 * the service, file pickers, its own frame, popouts and links. Anything
 * not from `origin`, where the UI comes from, is refused.
 */
export function registerIpc(
  origin: string,
  service: () => Promise<ServiceClient>,
  popOut: (popout: Popout) => void,
): void {
  const isTrusted = (frame: WebFrameMain | null): boolean =>
    frame !== null && originOf(frame.url) === origin;

  ipcMain.handle('grimoire:invoke', async (event, command: unknown, request: unknown) => {
    if (!isTrusted(event.senderFrame)) throw new Error('Untrusted sender');
    if (typeof command !== 'string') throw new Error('The command name must be a string');
    return (await service()).request(command, request);
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
    popOut({ chatId });
  });

  // A web page, such as a Jira issue, opens in the system's browser; nothing but https does.
  ipcMain.on('grimoire:openExternal', (event, url: unknown) => {
    if (!isTrusted(event.senderFrame) || typeof url !== 'string') return;
    if (originOf(url).startsWith('https://')) void shell.openExternal(url);
  });
}
