import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal } from '@angular/core';

/**
 * Look-and-feel switches that apply to the whole window: drawings, and
 * the theme's tokens you changed, set over the theme's own on the root.
 * The app's Settings keep them as the Colophon sets them.
 */
@Injectable({ providedIn: 'root' })
export class DesignSettings {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly drawings = signal(true);
  /** Tokens to set over the theme's, by name, such as "--gr-page": "#fffaf0". */
  readonly tokens = signal<Readonly<Record<string, string>>>({});
  private applied: string[] = [];

  constructor() {
    effect(() => {
      this.root.dataset['drawings'] = this.drawings() ? 'on' : 'off';
    });
    effect(() => {
      const tokens = this.tokens();
      for (const name of this.applied) if (!(name in tokens)) this.root.style.removeProperty(name);
      for (const [name, value] of Object.entries(tokens)) this.root.style.setProperty(name, value);
      this.applied = Object.keys(tokens);
    });
    inject(DestroyRef).onDestroy(() => {
      for (const name of this.applied) this.root.style.removeProperty(name);
    });
  }
}
