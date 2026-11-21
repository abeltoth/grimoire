import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Browsers } from './browser-views';

/** A web page's contents, which runs its handlers when told an event happened. */
class FakeContents extends EventEmitter {
  url = '';
  focused = false;
  closed = false;
  zoom = 0;
  back = 0;
  openHandler?: (details: { url: string; disposition: string }) => { action: string };
  readonly navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: () => this.back++,
    goForward: () => {},
  };
  readonly session = {};
  loadURL = vi.fn(async (url: string) => {
    this.url = url;
  });
  getURL = () => this.url;
  getTitle = () => 'Gemini';
  isLoading = () => false;
  isFocused = () => this.focused;
  close = () => (this.closed = true);
  reload = vi.fn();
  stop = vi.fn();
  getZoomLevel = () => this.zoom;
  setZoomLevel = (level: number) => (this.zoom = level);
  setWindowOpenHandler(handler: FakeContents['openHandler']) {
    this.openHandler = handler;
  }
  /** Presses a key in the page; true when the page doesn't get it. */
  press(key: string, held: Partial<{ control: boolean; alt: boolean }> = {}): boolean {
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    this.emit('before-input-event', event, {
      type: 'keyDown',
      key,
      control: false,
      meta: false,
      shift: false,
      alt: false,
      ...held,
    });
    return event.prevented;
  }
}

const electron = vi.hoisted(() => ({ views: [] as unknown[] }));
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  clipboard: { writeText: () => {} },
  session: {
    fromPartition: () => ({
      setUserAgent() {},
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
    }),
  },
  app: { userAgentFallback: 'Chrome/1 Electron/45' },
  WebContentsView: class {
    readonly webContents = new FakeContents();
    visible = true;
    bounds: unknown;
    constructor() {
      electron.views.push(this);
    }
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    setBounds(bounds: unknown) {
      this.bounds = bounds;
    }
  },
}));

interface FakeView {
  webContents: FakeContents;
  visible: boolean;
  bounds: unknown;
}

class FakeWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), {
    sent: [] as unknown[][],
    focused: 0,
    send: (...args: unknown[]) => this.webContents.sent.push(args),
    focus: () => this.webContents.focused++,
  });
  readonly contentView = {
    children: [] as unknown[],
    addChildView: (view: unknown) => this.contentView.children.push(view),
    removeChildView: (view: unknown) =>
      this.contentView.children.splice(this.contentView.children.indexOf(view), 1),
  };
  isDestroyed = () => false;
  getContentSize = () => [1600, 960];
}

let win: FakeWindow;
let browsers: Browsers;
const view = (index: number) => electron.views[index] as FakeView;
const sent = (kind: string) =>
  win.webContents.sent.filter(([, name]) => name === kind).map(([, , payload]) => payload);

beforeEach(() => {
  electron.views.length = 0;
  win = new FakeWindow();
  browsers = new Browsers(win as never, 'windows');
});

const rect = { x: 800, y: 100, width: 700, height: 800 };

describe('Browsers', () => {
  it('opens a page hidden, and shows one at a time where it’s placed', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    browsers.open('b', 'https://www.pinterest.com', 'personal');
    expect(view(0).webContents.url).toBe('https://gemini.google.com');
    expect(view(0).visible).toBe(false);

    browsers.place('a', rect);
    expect(view(0)).toMatchObject({ visible: true, bounds: rect });
    browsers.place('b', rect);
    expect([view(0).visible, view(1).visible]).toEqual([false, true]);
    browsers.place('b', null);
    expect(view(1).visible).toBe(false);
  });

  it('loads only web addresses', () => {
    browsers.open('a', 'file:///C:/secret.txt', 'personal');
    browsers.navigate('a', 'javascript:alert(1)');
    expect(view(0).webContents.loadURL).not.toHaveBeenCalled();
  });

  it('tells the window what the page shows, with why it failed to load', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    const contents = view(0).webContents;
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', '', true);
    contents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', '', true);
    expect(sent('change')).toEqual([
      expect.objectContaining({
        id: 'a',
        url: 'https://gemini.google.com',
        error: 'ERR_INTERNET_DISCONNECTED',
      }),
    ]);
    contents.emit('did-start-loading');
    expect(sent('change').at(-1)).toMatchObject({ error: null });
  });

  it('opens sign-in popups as windows, and other new tabs as the window’s tabs', () => {
    browsers.open('a', 'https://www.pinterest.com', 'personal');
    const open = view(0).webContents.openHandler!;
    expect(
      open({ url: 'https://accounts.google.com/o/oauth2', disposition: 'new-window' }).action,
    ).toBe('allow');
    expect(
      open({ url: 'https://www.pinterest.com/pin/1', disposition: 'foreground-tab' }).action,
    ).toBe('deny');
    expect(sent('open')).toEqual([{ id: 'a', url: 'https://www.pinterest.com/pin/1' }]);
  });

  it('keeps the browser’s keys, gives Grimoire its shortcuts back with the keyboard, and the rest to the page', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    browsers.setShortcuts(['Mod+K', 'Mod+W']);
    const contents = view(0).webContents;

    expect(contents.press('ArrowLeft', { alt: true })).toBe(true);
    expect(contents.back).toBe(1);
    expect(contents.press('=', { control: true })).toBe(true);
    expect(contents.zoom).toBe(0.5);
    expect(contents.press('w', { control: true })).toBe(true);
    expect(sent('action')).toEqual([{ id: 'a', action: 'close-tab' }]);
    expect(contents.press('k', { control: true })).toBe(true);
    expect(sent('key')).toEqual([expect.objectContaining({ key: 'k', ctrl: true })]);
    expect(win.webContents.focused).toBe(2);
    expect(contents.press('c', { control: true })).toBe(false);
  });

  it('gives the keyboard back to the window when the page it’s in hides', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    browsers.place('a', rect);
    view(0).webContents.focused = true;
    browsers.place('a', null);
    expect(win.webContents.focused).toBe(1);
  });

  it('fills the window while a video is full screen, and goes back to its place after', () => {
    browsers.open('a', 'https://www.youtube.com', 'personal');
    browsers.place('a', rect);
    view(0).webContents.emit('enter-html-full-screen');
    expect(view(0).bounds).toEqual({ x: 0, y: 0, width: 1600, height: 960 });
    browsers.place('a', { ...rect, x: 10 });
    expect(view(0).bounds).toEqual({ x: 0, y: 0, width: 1600, height: 960 });
    view(0).webContents.emit('leave-html-full-screen');
    expect(view(0).bounds).toEqual({ ...rect, x: 10 });
  });

  it('closes every page when the window loads its page again, but not when it changes route', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(view(0).webContents.closed).toBe(false);
    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(view(0).webContents.closed).toBe(true);
    expect(win.contentView.children).toEqual([]);
  });

  it('closes every page when the window closes', () => {
    browsers.open('a', 'https://gemini.google.com', 'personal');
    win.emit('closed');
    expect(view(0).webContents.closed).toBe(true);
  });
});
