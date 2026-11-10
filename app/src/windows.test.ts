import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Popouts } from './popouts';
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
  readonly webContents = { reload: () => this.reloads++ };
  constructor(readonly size: object) {}
  on(event: string, handler: () => void) {
    this.handlers.set(event, handler);
  }
  happen(event: string) {
    this.handlers.get(event)?.();
  }
}

describe('MainWindow', () => {
  let calls: string[];
  let created: FakeWindow[];
  const popouts = {
    mainOpens: () => calls.push('mainOpens'),
    closeWithMain: () => calls.push('closeWithMain'),
    reopen: () => calls.push('reopen'),
    forget: () => calls.push('forget'),
  } as unknown as Popouts;
  const main = (setup: Partial<WindowSetup> = {}) =>
    new MainWindow(
      { preload: '', devUrl: undefined, headless: false, capture: false, ...setup },
      popouts,
      (_setup, size) => {
        const win = new FakeWindow(size);
        created.push(win);
        return win as never;
      },
    );
  beforeEach(() => {
    calls = [];
    created = [];
  });

  it('opens with its popouts, and closes with them', () => {
    const window = main();
    window.open();
    expect(created[0]!.size).toEqual({ width: 1600, height: 960 });
    expect(calls).toEqual(['mainOpens', 'reopen']);
    created[0]!.happen('close');
    created[0]!.happen('closed');
    expect(calls.at(-1)).toBe('closeWithMain');
    expect(window.current).toBeUndefined();
  });

  it("opens a capture on the design's frame, without popouts", () => {
    main({ headless: true, capture: true }).open();
    expect(created[0]!.size).toEqual({
      width: 1920,
      height: 1080,
      useContentSize: true,
      enableLargerThanScreen: true,
    });
    expect(calls).toEqual(['mainOpens']);
  });

  it("keeps the window opened since, when an older one's closed", () => {
    const window = main();
    window.open();
    window.open();
    created[0]!.happen('closed');
    expect(window.current).toBe(created[1]);
  });

  it("opens again on another profile's chats and popouts", () => {
    const window = main();
    window.openProfile();
    expect(calls).toEqual(['forget']);
    window.open();
    calls = [];
    window.openProfile();
    expect(created[0]!.reloads).toBe(1);
    expect(calls).toEqual(['forget', 'reopen']);
  });
});
