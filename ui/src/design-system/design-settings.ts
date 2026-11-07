import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import type { GrimoireSettings, ThemeName } from '@grimoire/contract';

/** The look "auto" takes by day, and after dark. */
export const AUTO_LIGHT: ThemeName = 'grimoire';
export const AUTO_DARK: ThemeName = 'night';

/**
 * Look-and-feel switches that apply to the whole window: drawings, the
 * ready-made theme, and the tokens of it you changed, set over the
 * theme's own on the root. The app's Settings keep them as the Colophon
 * sets them.
 */
@Injectable({ providedIn: 'root' })
export class DesignSettings {
  private readonly root = inject(DOCUMENT).documentElement;
  // A window without matchMedia, such as a test's, is simply light.
  private readonly dark = inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-color-scheme: dark)');

  readonly drawings = signal(true);
  /** The ready-made theme chosen; "auto" follows the system's light or dark. */
  readonly themeName = signal<GrimoireSettings['themeName']>('grimoire');
  /** Whether the system is dark; "auto" takes Night then. */
  private readonly systemDark = signal(this.dark?.matches ?? false);
  /** The theme in use: the one chosen, or for "auto" the one the system's light or dark calls for. */
  readonly theme = computed<ThemeName>(() => {
    const chosen = this.themeName();
    return chosen === 'auto' ? (this.systemDark() ? AUTO_DARK : AUTO_LIGHT) : chosen;
  });
  /** Tokens to set over the theme's, by name, such as "--gr-page": "#fffaf0". */
  readonly tokens = signal<Readonly<Record<string, string>>>({});
  private applied: string[] = [];

  constructor() {
    effect(() => {
      this.root.dataset['drawings'] = this.drawings() ? 'on' : 'off';
    });
    effect(() => {
      this.root.dataset['theme'] = this.theme();
    });
    effect(() => {
      const tokens = this.tokens();
      for (const name of this.applied) if (!(name in tokens)) this.root.style.removeProperty(name);
      for (const [name, value] of Object.entries(tokens)) this.root.style.setProperty(name, value);
      this.applied = Object.keys(tokens);
    });
    const follow = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.dark?.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => {
      this.dark?.removeEventListener('change', follow);
      for (const name of this.applied) this.root.style.removeProperty(name);
      delete this.root.dataset['theme'];
    });
  }
}
