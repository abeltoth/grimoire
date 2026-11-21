import type { KeyPress } from './shortcut';

/** Where a web page shows in the window, in the window's own pixels before its zoom. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a web page shows now, told each time it changes. */
export interface BrowserViewState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the page couldn't load, such as "ERR_INTERNET_DISCONNECTED"; null when it did. */
  error: string | null;
}

export type BrowserMove = 'back' | 'forward' | 'reload' | 'stop';

/** A key pressed inside a web page that belongs to the browser around it. */
export type BrowserAction = 'new-tab' | 'close-tab' | 'focus-address';

/**
 * Web pages the app shows over the window, each by an id the window
 * picks. Pages keep their logins per profile, apart from Grimoire's own.
 */
export interface BrowserViews {
  /** Starts a page at the address, kept hidden until it's placed. */
  open(id: string, url: string, profile: string): void;
  navigate(id: string, url: string): void;
  go(id: string, move: BrowserMove): void;
  /** Shows the page over that part of the window, hiding any other; null hides it. */
  place(id: string, rect: ViewRect | null): void;
  /** A picture of the page as it shows now, as a data URL; empty when it has none. */
  snapshot(id: string): Promise<string>;
  close(id: string): void;
  /** Deletes the profile's logins, cookies and everything else its pages kept. */
  forget(profile: string): void;
  /** Grimoire's shortcuts, such as 'Mod+K': pressed inside a page, they come back through `onKey`. */
  shortcuts(keys: string[]): void;
  /** Each of these returns a function that stops listening. */
  onChange(listener: (state: BrowserViewState) => void): () => void;
  /** A page opened a link in a new tab. */
  onOpen(listener: (opened: { id: string; url: string }) => void): () => void;
  /** One of Grimoire's shortcuts was pressed inside a page; the keyboard is back with the window. */
  onKey(listener: (press: KeyPress) => void): () => void;
  onAction(listener: (asked: { id: string; action: BrowserAction }) => void): () => void;
}
