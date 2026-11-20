import { homedir } from 'node:os';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ChromeState } from '@grimoire/contract';
import { probe } from '@grimoire/service/claude/probe';

/** What the CLI's /chrome dialog shows, as its undocumented `get_chrome_dialog` answers. */
export interface ChromeDialog {
  allowed: boolean;
  subscriber: boolean;
  wsl: boolean;
  installed: boolean;
  connected: boolean;
  paired_browser?: string;
  enabled_by_default: boolean;
  urls: { install: string; reconnect: string };
}

/** A browser the extension connected, as the undocumented `get_chrome_browsers` answers. */
export interface ChromeBrowser {
  name: string;
  /** The one Chrome actions use now. */
  current: boolean;
}

/** The name Claude Code gives the Claude in Chrome server. */
const SERVER = 'claude-in-chrome';
/** How long to wait for the extension to connect before saying whether it has. */
const CONNECT_MS = 5_000;

/**
 * What Settings shows: the dialog's `connected` means only that the
 * process's server started, so a browser has to be listed as well.
 */
export function toChromeState(dialog: ChromeDialog, browsers: ChromeBrowser[]): ChromeState {
  const browser = browsers.find((one) => one.current) ?? browsers[0];
  return {
    on: dialog.enabled_by_default,
    unusable: !dialog.allowed
      ? 'Your organization doesn’t allow it.'
      : !dialog.subscriber
        ? 'It needs a claude.ai plan, and this account signs in another way.'
        : dialog.wsl
          ? 'It doesn’t work under WSL.'
          : null,
    installed: dialog.installed,
    connected: dialog.connected && browsers.length > 0,
    browser: browser?.name || dialog.paired_browser || null,
    installUrl: dialog.urls.install,
    reconnectUrl: dialog.urls.reconnect,
  };
}

/** Asks a process started as a chat's would be, once the extension had its moment to connect. */
export async function askChrome(claude: Query, now: () => number = Date.now): Promise<ChromeState> {
  const since = now();
  const pending = async () =>
    (await claude.mcpServerStatus()).some(
      (server) => server.name === SERVER && server.status === 'pending',
    );
  while ((await pending()) && now() - since < CONNECT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const control = claude as unknown as {
    getChromeDialog(): Promise<ChromeDialog>;
    getChromeBrowsers(): Promise<{ browsers: ChromeBrowser[] }>;
  };
  const dialog = await control.getChromeDialog();
  // It fails when the server didn't start, as when Claude in Chrome is off.
  const browsers = dialog.connected
    ? await control.getChromeBrowsers().then(
        (answer) => answer.browsers,
        () => [],
      )
    : [];
  return toChromeState(dialog, browsers);
}

/** Claude in Chrome's state, as a chat started now in your home folder would find it. */
export const readChrome = (): Promise<ChromeState> =>
  probe((claude) => askChrome(claude), homedir());
