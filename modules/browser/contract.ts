/** The browser's tabs, kept for each profile (Grimoire's own data). */

/** A browser tab as it's kept: its address, empty for a new tab, and the title it last showed. */
export interface BrowserTab {
  url: string;
  title: string;
}

/** The profile's browser tabs, in order, and which one shows. */
export interface BrowserTabs {
  tabs: BrowserTab[];
  /** The index of the tab that shows. */
  shown: number;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** The profile in use's browser tabs; none before the browser is first opened. */
    'browser.tabs': { request: Record<string, never>; response: BrowserTabs };
    /** Keeps the profile in use's browser tabs in place of those kept before. */
    'browser.save': { request: BrowserTabs; response: void };
  }
}
