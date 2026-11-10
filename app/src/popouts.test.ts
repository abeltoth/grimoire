import type { Popout } from '@grimoire/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Popouts } from './popouts';
import type { ServiceClient } from './service-client';
import type { WindowSetup, WindowSize } from './windows';

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
  },
}));

/** A window that remembers what's done to it, and runs its close handlers when closed. */
class FakeWindow {
  readonly handlers: (() => void)[] = [];
  readonly sent: unknown[][] = [];
  readonly webContents = { send: (...args: unknown[]) => this.sent.push(args) };
  focused = false;
  destroyed = false;
  constructor(readonly size: WindowSize) {}
  on(_event: 'close', handler: () => void) {
    this.handlers.push(handler);
  }
  close() {
    for (const handler of this.handlers) handler();
  }
  destroy() {
    this.destroyed = true;
  }
  isMinimized = () => false;
  restore() {}
  focus() {
    this.focused = true;
  }
  getNormalBounds = () => ({ x: 1, y: 2, width: 3, height: 4 });
  getBounds = () => ({ x: 0, y: 0, width: 1600, height: 960 });
}

const setup: WindowSetup = { preload: '', devUrl: undefined, headless: false, capture: false };
const settle = () => new Promise((resolve) => setImmediate(resolve));

let saved: Popout[];
let layouts: Popout[][];
let opened: Map<string, FakeWindow>;
let main: FakeWindow;
let popouts: Popouts;
beforeEach(() => {
  saved = [];
  layouts = [];
  opened = new Map();
  main = new FakeWindow({ width: 1600, height: 960 });
  const client = {
    request: async (command: string, request: { popouts?: Popout[] }) => {
      if (command === 'layout.get') return { popouts: saved };
      layouts.push(request.popouts ?? []);
      return undefined;
    },
  } as unknown as ServiceClient;
  popouts = new Popouts(
    setup,
    async () => client,
    (_setup, size, popout) => {
      const win = new FakeWindow(size);
      opened.set(popout!.chatId, win);
      return win as never;
    },
    () => main as never,
  );
});

describe('Popouts', () => {
  it('opens a chat once, at the side of the screen, and keeps it in the layout', async () => {
    popouts.open({ chatId: 'a' });
    popouts.open({ chatId: 'a' });
    await settle();
    expect(opened.get('a')!.size).toEqual({ width: 860, height: 960, x: 1060, y: 40 });
    expect(opened.get('a')!.focused).toBe(true);
    expect(layouts).toEqual([[{ chatId: 'a' }]]);
  });

  it('puts a chat closed by itself back in the main window', async () => {
    popouts.mainOpens();
    popouts.open({ chatId: 'a' });
    opened.get('a')!.close();
    await settle();
    expect(main.sent).toEqual([['grimoire:popoutClosed', 'a']]);
    expect(layouts.at(-1)).toEqual([]);
  });

  it('keeps where each was when they close with the main window, or as the app quits', async () => {
    popouts.open({ chatId: 'a' });
    popouts.closeWithMain();
    popouts.appQuits();
    await settle();
    expect(main.sent).toEqual([]);
    expect(layouts.at(-1)).toEqual([{ chatId: 'a', bounds: { x: 1, y: 2, width: 3, height: 4 } }]);
  });

  it('opens again the chats saved, where they were, with any popped out meanwhile', async () => {
    saved = [{ chatId: 'a', bounds: { x: 1, y: 2, width: 3, height: 4 } }];
    popouts.open({ chatId: 'b' });
    popouts.reopen();
    await settle();
    expect(opened.get('a')!.size).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    popouts.closeWithMain();
    await settle();
    expect(layouts.at(-1)!.map((popout) => popout.chatId)).toEqual(['a', 'b']);
  });

  it('forgets every popout for another profile, without putting their chats back', () => {
    popouts.open({ chatId: 'a' });
    popouts.forget();
    expect(opened.get('a')!.destroyed).toBe(true);
    expect(main.sent).toEqual([]);
    popouts.open({ chatId: 'a' });
    expect(opened.get('a')!.destroyed).toBe(false);
  });
});
