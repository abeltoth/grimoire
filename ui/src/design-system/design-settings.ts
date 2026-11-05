import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

/**
 * Look-and-feel switches that apply to the whole window. For now only
 * drawings, which the app's Settings keep as the Colophon sets them.
 */
@Injectable({ providedIn: 'root' })
export class DesignSettings {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly drawings = signal(true);

  constructor() {
    effect(() => {
      this.root.dataset['drawings'] = this.drawings() ? 'on' : 'off';
    });
  }
}
