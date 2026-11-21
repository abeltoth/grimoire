import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { BrowserMove, BrowserViewState } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Profiles } from '@ui/app/core/profiles';
import { ShellRegistry } from '@ui/app/shell/shell-registry';

/** The page the browser first opens on. */
export const HOME = 'https://gemini.google.com';
/** Tabs are kept a moment after they last change, so a page's redirects are kept once. */
const SAVE_AFTER_MS = 500;

/** A browser tab: what its page shows, as the app last told it; an empty address waits for one. */
export type WebTab = BrowserViewState;

/**
 * The browser's tabs. Their pages live in the app, started when a tab
 * first shows and kept while the window's page lasts; the tabs
 * themselves are kept by the service for each profile.
 */
@Injectable({ providedIn: 'root' })
export class WebTabs {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly profiles = inject(Profiles);
  private readonly registry = inject(ShellRegistry);

  readonly tabs = signal<readonly WebTab[]>([]);
  private readonly shownId = signal<string | null>(null);
  /** The tab shown; the first when unset, and none before the kept tabs are read. */
  readonly shown = computed<WebTab | undefined>(
    () => this.tabs().find((tab) => tab.id === this.shownId()) ?? this.tabs()[0],
  );
  /** Whether the kept tabs have been read. */
  readonly read = signal(false);
  /** Goes up each time the keyboard should go to the address field. */
  readonly addressWanted = signal(0);
  /** The tabs whose page the app has started. */
  private readonly started = new Set<string>();
  private loaded: Promise<void> | undefined;
  private saving: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const views = this.bridge.browser;
    views.onChange((state) => this.changed(state));
    views.onOpen(({ id, url }) => this.add(url, id));
    views.onAction(({ id, action }) => {
      if (action === 'new-tab') this.add('');
      else if (action === 'close-tab') this.close(id);
      else this.addressWanted.update((asked) => asked + 1);
    });
    // A shortcut pressed inside a page runs as if pressed in the window.
    views.onKey(({ key, ctrl, meta, shift, alt }) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          ctrlKey: ctrl,
          metaKey: meta,
          shiftKey: shift,
          altKey: alt,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    effect(() =>
      views.shortcuts(
        this.registry.commands
          .all()
          .flatMap(({ run, shortcut }) => (run && shortcut ? [shortcut] : [])),
      ),
    );
    // The shown tab's page starts once the profile whose logins it uses is known.
    effect(() => {
      const tab = this.shown();
      const profile = this.profiles.list().active;
      if (!tab?.url || !profile || this.started.has(tab.id)) return;
      this.started.add(tab.id);
      views.open(tab.id, tab.url, profile);
    });
  }

  /** Reads the kept tabs, once; with none, one tab on Gemini. */
  load(): Promise<void> {
    return (this.loaded ??= this.readKept());
  }

  show(id: string): void {
    this.shownId.set(id);
    this.save();
  }

  /** Opens a tab after the one given, or the shown one, and shows it; an empty one asks for an address. */
  add(url: string, after?: string): void {
    const tab = blank(url);
    const tabs = this.tabs();
    const at = tabs.findIndex(({ id }) => id === (after ?? this.shown()?.id));
    const before = at === -1 ? tabs.length : at + 1;
    this.tabs.set([...tabs.slice(0, before), tab, ...tabs.slice(before)]);
    this.shownId.set(tab.id);
    if (!url) this.addressWanted.update((asked) => asked + 1);
    this.save();
  }

  /** Loads the address in the shown tab. */
  navigate(url: string): void {
    const tab = this.shown();
    if (!tab) return;
    this.update(tab.id, { url, error: null });
    if (this.started.has(tab.id)) this.bridge.browser.navigate(tab.id, url);
    this.save();
  }

  go(move: BrowserMove): void {
    const tab = this.shown();
    if (tab && this.started.has(tab.id)) this.bridge.browser.go(tab.id, move);
  }

  /** Closes the tab and its page, showing the one after it; closing the last leaves an empty one. */
  close(id: string): void {
    const tabs = this.tabs();
    const at = tabs.findIndex((tab) => tab.id === id);
    if (at === -1) return;
    if (this.started.delete(id)) this.bridge.browser.close(id);
    let left = tabs.filter((tab) => tab.id !== id);
    if (!left.length) {
      left = [blank('')];
      this.addressWanted.update((asked) => asked + 1);
    }
    if (this.shown()?.id === id) this.shownId.set(left[Math.min(at, left.length - 1)]!.id);
    this.tabs.set(left);
    this.save();
  }

  private async readKept(): Promise<void> {
    const kept = await this.bridge.invoke('browser.tabs', {}).catch(() => null);
    const tabs = kept?.tabs.length ? kept.tabs : [{ url: HOME, title: '' }];
    this.tabs.set(tabs.map(({ url, title }) => ({ ...blank(url), title })));
    this.shownId.set(this.tabs()[Math.min(kept?.shown ?? 0, tabs.length - 1)]!.id);
    this.read.set(true);
  }

  private changed(state: BrowserViewState): void {
    const tab = this.tabs().find(({ id }) => id === state.id);
    if (!tab) return;
    // A page that hasn't committed yet has no address of its own; it keeps the one asked for.
    const url = state.url || tab.url;
    this.update(state.id, { ...state, url });
    if (url !== tab.url || state.title !== tab.title) this.save();
  }

  private update(id: string, change: Partial<WebTab>): void {
    this.tabs.update((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, ...change } : tab)));
  }

  private save(): void {
    clearTimeout(this.saving);
    this.saving = setTimeout(() => {
      const tabs = this.tabs();
      const shown = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === this.shown()?.id),
      );
      const kept = tabs.map(({ url, title }) => ({ url, title }));
      this.bridge.invoke('browser.save', { tabs: kept, shown }).catch(() => {});
    }, SAVE_AFTER_MS);
  }
}

function blank(url: string): WebTab {
  return {
    id: crypto.randomUUID(),
    url,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  };
}
