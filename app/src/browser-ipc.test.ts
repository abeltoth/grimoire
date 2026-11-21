import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rectOf, registerBrowserIpc } from './browser-ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const electron = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  calls: [] as unknown[][],
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: () => ({}) },
}));
vi.mock('./browser-views', () => ({
  Browsers: class {
    open = (...args: unknown[]) => electron.calls.push(['open', ...args]);
    place = (...args: unknown[]) => electron.calls.push(['place', ...args]);
    go = (...args: unknown[]) => electron.calls.push(['go', ...args]);
    setShortcuts = (...args: unknown[]) => electron.calls.push(['shortcuts', ...args]);
    snapshot = async () => 'data:image/png;base64,';
  },
}));
vi.mock('./browser-session', () => ({ forgetProfile: async () => {} }));

const ORIGIN = 'app://grimoire';
const from = (url: string) => ({ senderFrame: { url }, sender: {} });
const trusted = from(`${ORIGIN}/index.html`);
const untrusted = from('https://elsewhere.example/page');
const send = (event: unknown, ...args: unknown[]) =>
  electron.handlers.get('grimoire:browser')!(event, ...args);

beforeAll(() => registerBrowserIpc((frame) => frame?.url.startsWith(ORIGIN) ?? false));
beforeEach(() => (electron.calls.length = 0));

describe('registerBrowserIpc', () => {
  it('passes the window’s asks to its web pages', () => {
    send(trusted, 'open', 'a', 'https://gemini.google.com', 'personal');
    send(trusted, 'go', 'a', 'back');
    send(trusted, 'shortcuts', ['Mod+K', 7]);
    expect(electron.calls).toEqual([
      ['open', 'a', 'https://gemini.google.com', 'personal'],
      ['go', 'a', 'back'],
      ['shortcuts', ['Mod+K']],
    ]);
  });

  it('refuses asks from elsewhere, and ones that aren’t what they should be', async () => {
    send(untrusted, 'open', 'a', 'https://gemini.google.com', 'personal');
    send(trusted, 'go', 'a', 'explode');
    send(trusted, 'open', 'a', 42, 'personal');
    expect(electron.calls).toEqual([]);
    await expect(
      electron.handlers.get('grimoire:browserSnapshot')!(untrusted, 'a'),
    ).rejects.toThrow('Untrusted sender');
  });

  it('places a page in whole pixels, and hides it for anything that isn’t a rect', () => {
    send(trusted, 'place', 'a', { x: 10.4, y: 20.6, width: 300.5, height: -1 });
    send(trusted, 'place', 'a', null);
    expect(electron.calls).toEqual([
      ['place', 'a', { x: 10, y: 21, width: 301, height: 0 }],
      ['place', 'a', null],
    ]);
  });
});

describe('rectOf', () => {
  it('takes only finite numbers', () => {
    expect(rectOf({ x: 1, y: 2, width: Infinity, height: 4 })).toBeNull();
    expect(rectOf('rect')).toBeNull();
  });
});
