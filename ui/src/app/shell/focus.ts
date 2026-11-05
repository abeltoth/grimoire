import { Injectable, inject, signal } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '../core/bridge';

/**
 * Focus mode: the book lies at a single page, the chapter alone on the
 * desk, and everything else is put away until you turn back to two pages.
 * The book opens the way you left it.
 */
@Injectable({ providedIn: 'root' })
export class Focus {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly on = signal(false);
  /** Whether you've gone in or out since the book opened, so the remembered way doesn't undo it. */
  private moved = false;

  constructor() {
    this.bridge.invoke('layout.get', {}).then(
      (layout) => {
        if (!this.moved && layout?.focus) this.on.set(true);
      },
      () => {},
    );
  }

  enter(): void {
    this.set(true);
  }

  leave(): void {
    this.set(false);
  }

  private set(on: boolean): void {
    this.moved = true;
    if (this.on() === on) return;
    this.on.set(on);
    this.bridge.invoke('layout.set', { focus: on }).catch(() => {});
  }
}
