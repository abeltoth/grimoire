import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainWindow, type WindowSetup, originOf, serveUi, uiOrigin } from './windows';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: async (url: string) => new Response(url) },
}));

describe('originOf', () => {
  it('builds the origin by hand, as URL.origin gives "null" for app://', () => {
    expect(originOf('app://grimoire/index.html')).toBe('app://grimoire');
    expect(originOf('http://localhost:4200/chats')).toBe('http://localhost:4200');
    expect(originOf('not a url')).toBe('');
  });
});

describe('uiOrigin', () => {
  it("is the dev server's under npm run dev, and app://grimoire otherwise", () => {
    expect(uiOrigin('http://localhost:4200/')).toBe('http://localhost:4200');
    expect(uiOrigin(undefined)).toBe('app://grimoire');
  });
});

describe('serveUi', () => {
  const uiDir = mkdtempSync(path.join(tmpdir(), 'grimoire-ui-'));
  mkdirSync(path.join(uiDir, 'media'));
  writeFileSync(path.join(uiDir, 'index.html'), '');
  writeFileSync(path.join(uiDir, 'main.js'), '');
  afterAll(() => rmSync(uiDir, { recursive: true, force: true }));
  const serve = async (url: string) => {
    const response = await serveUi(uiDir, new Request(url));
    return response.status === 404 ? 404 : await response.text();
  };
  const file = (name: string) => pathToFileURL(path.join(uiDir, name)).toString();

  it('serves the built files, and index.html for any other path', async () => {
    expect(await serve('app://grimoire/main.js')).toBe(file('main.js'));
    expect(await serve('app://grimoire/')).toBe(file('index.html'));
    expect(await serve('app://grimoire/chats/a')).toBe(file('index.html'));
    expect(await serve('app://grimoire/media')).toBe(file('index.html'));
  });

  it('serves nothing outside the built UI', async () => {
    expect(await serve('app://grimoire/..%2F..%2Fsecret')).toBe(404);
  });
});

/** A window that runs its handlers when told an event happened. */
class FakeWindow {
  readonly handlers = new Map<string, () => void>();
  reloads = 0;
  focused = 0;
  readonly webContents = { reload: () => this.reloads++ };
  isMinimized() {
    return false;
  }
  focus() {
    this.focused++;
  }
  constructor(readonly size: object) {}
  on(event: string, handler: () => void) {
    this.handlers.set(event, handler);
  }
  happen(event: string) {
    this.handlers.get(event)?.();
  }
}

describe('MainWindow', () => {
  let created: FakeWindow[];
  const main = (setup: Partial<WindowSetup> = {}) =>
    new MainWindow(
      { preload: '', devUrl: undefined, headless: false, capture: false, ...setup },
      (_setup, size) => {
        const win = new FakeWindow(size);
        created.push(win);
        return win as never;
      },
    );
  beforeEach(() => {
    created = [];
  });

  it('opens, and forgets the window once it has closed', () => {
    const window = main();
    window.open();
    expect(created[0]!.size).toEqual({ width: 1600, height: 960 });
    window.focus();
    created[0]!.happen('closed');
    window.focus();
    expect(created[0]!.focused).toBe(1);
  });

  it("opens a capture on the design's frame", () => {
    main({ headless: true, capture: true }).open();
    expect(created[0]!.size).toEqual({
      width: 1920,
      height: 1080,
      useContentSize: true,
      enableLargerThanScreen: true,
    });
  });

  it("keeps the window opened since, when an older one's closed", () => {
    const window = main();
    window.open();
    window.open();
    created[0]!.happen('closed');
    window.focus();
    expect(created[1]!.focused).toBe(1);
  });

  it("opens again on another profile's chats", () => {
    const window = main();
    window.openProfile();
    window.open();
    window.openProfile();
    expect(created[0]!.reloads).toBe(1);
  });
});
