import type { Popout } from '@grimoire/contract';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpc } from './ipc';
import type { ServiceClient } from './service-client';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const electron = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  opened: [] as string[],
  win: { minimize: () => {}, isMaximized: () => false, maximize: () => {}, close: () => {} },
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: () => electron.win },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/picked'] }),
  },
  shell: {
    openExternal: async (url: string) => {
      electron.opened.push(url);
    },
  },
}));

const ORIGIN = 'app://grimoire';
const from = (url: string) => ({ senderFrame: { url }, sender: {} });
const trusted = from(`${ORIGIN}/index.html`);
const untrusted = from('https://elsewhere.example/page');
const send = (channel: string, event: unknown, ...args: unknown[]) =>
  electron.handlers.get(channel)!(event, ...args);

let requests: unknown[][];
let popouts: Popout[];
beforeAll(() => {
  const client = {
    request: async (...args: unknown[]) => {
      requests.push(args);
      return 'answer';
    },
  } as unknown as ServiceClient;
  registerIpc(
    ORIGIN,
    async () => client,
    (popout) => popouts.push(popout),
  );
});
beforeEach(() => {
  requests = [];
  popouts = [];
  electron.opened.length = 0;
});

describe('registerIpc', () => {
  it("passes the UI's commands to the service", async () => {
    expect(await send('grimoire:invoke', trusted, 'chats.list', {})).toBe('answer');
    expect(requests).toEqual([['chats.list', {}]]);
  });

  it('refuses anything asked from elsewhere', async () => {
    await expect(send('grimoire:invoke', untrusted, 'chats.list', {})).rejects.toThrow(
      'Untrusted sender',
    );
    await expect(send('grimoire:chooseFolder', untrusted)).rejects.toThrow('Untrusted sender');
    await expect(send('grimoire:chooseFiles', untrusted)).rejects.toThrow('Untrusted sender');
    await expect(
      send('grimoire:invoke', { senderFrame: null, sender: {} }, 'chats.list', {}),
    ).rejects.toThrow('Untrusted sender');
    send('grimoire:popOut', untrusted, 'chat');
    send('grimoire:openExternal', untrusted, 'https://example.com');
    expect(requests).toEqual([]);
    expect(popouts).toEqual([]);
    expect(electron.opened).toEqual([]);
  });

  it('refuses a command whose name is not a string', async () => {
    await expect(send('grimoire:invoke', trusted, 7, {})).rejects.toThrow('must be a string');
  });

  it('gives the folder or files picked', async () => {
    expect(await send('grimoire:chooseFolder', trusted)).toBe('/picked');
    expect(await send('grimoire:chooseFiles', trusted)).toEqual(['/picked']);
  });

  it('pops a chat out only by its id', () => {
    send('grimoire:popOut', trusted, '');
    send('grimoire:popOut', trusted, 7);
    send('grimoire:popOut', trusted, 'chat');
    expect(popouts).toEqual([{ chatId: 'chat' }]);
  });

  it('opens only https pages in the browser', () => {
    send('grimoire:openExternal', trusted, 'file:///etc/passwd');
    send('grimoire:openExternal', trusted, 'http://example.com');
    send('grimoire:openExternal', trusted, 'https://example.com/issue');
    expect(electron.opened).toEqual(['https://example.com/issue']);
  });
});
