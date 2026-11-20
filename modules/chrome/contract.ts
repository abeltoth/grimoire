/** Claude in Chrome, as Settings shows it: whether chats may use your Chrome, and whether they can. */
export interface ChromeState {
  /** Chats start connected to your Chrome, as Claude Code's /chrome "Enabled by default" says. */
  on: boolean;
  /** Why it can't be used at all, such as an account without a claude.ai plan; null when it can. */
  unusable: string | null;
  /** The Chrome extension was found on this computer. */
  installed: boolean;
  /** A chat started now connects to it. */
  connected: boolean;
  /** The browser it's paired with, when it says. */
  browser: string | null;
  /** The page that installs the extension. */
  installUrl: string;
  /** The page that connects the extension again. */
  reconnectUrl: string;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** Claude in Chrome's state, asked of a Claude Code process; null when it can't say. */
    'chrome.get': { request: Record<string, never>; response: ChromeState | null };
    /** Turns Claude in Chrome on or off for chats that start after, and says its state then. */
    'chrome.set': { request: { on: boolean }; response: ChromeState | null };
  }
  interface EventMap {
    /** Claude in Chrome was turned on or off, so what lists a process's tools reads them again. */
    'chrome.changed': { on: boolean };
  }
}
