import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { type ChromeDialog, askChrome, toChromeState } from './chrome-state';

const dialog: ChromeDialog = {
  allowed: true,
  subscriber: true,
  wsl: false,
  installed: true,
  connected: true,
  paired_browser: 'Chrome on Desk',
  enabled_by_default: true,
  urls: { install: 'https://clau.de/chrome', reconnect: 'https://clau.de/chrome/reconnect' },
};

describe('toChromeState', () => {
  it('says what Settings shows of the /chrome dialog', () => {
    const browsers = [
      { name: 'Chrome on Laptop', current: false },
      { name: 'Chrome on Desk', current: true },
    ];
    expect(toChromeState(dialog, browsers)).toEqual({
      on: true,
      unusable: null,
      installed: true,
      connected: true,
      browser: 'Chrome on Desk',
      installUrl: 'https://clau.de/chrome',
      reconnectUrl: 'https://clau.de/chrome/reconnect',
    });
  });

  it('isn’t connected while no browser is, though the server started', () => {
    expect(toChromeState(dialog, []).connected).toBe(false);
  });

  it('says why it can’t be used', () => {
    expect(toChromeState({ ...dialog, allowed: false }, []).unusable).toMatch(/organization/);
    expect(toChromeState({ ...dialog, subscriber: false }, []).unusable).toMatch(/claude\.ai plan/);
    expect(toChromeState({ ...dialog, wsl: true }, []).unusable).toMatch(/WSL/);
  });
});

describe('askChrome', () => {
  it('waits for the extension to connect, then asks the dialog', async () => {
    const statuses = ['pending', 'connected'];
    let asked = 0;
    const claude = {
      mcpServerStatus: async () => [{ name: 'claude-in-chrome', status: statuses[asked++] }],
      getChromeDialog: async () => dialog,
      getChromeBrowsers: async () => ({ browsers: [{ name: 'Chrome', current: true }] }),
    } as unknown as Query;
    expect((await askChrome(claude, () => 0)).connected).toBe(true);
    expect(asked).toBe(2);
  });

  it('stops waiting after a while', async () => {
    let at = 0;
    const claude = {
      mcpServerStatus: async () => [{ name: 'claude-in-chrome', status: 'pending' }],
      getChromeDialog: async () => ({ ...dialog, connected: false }),
    } as unknown as Query;
    const state = await askChrome(claude, () => (at += 3_000));
    expect(state.connected).toBe(false);
  });
});
