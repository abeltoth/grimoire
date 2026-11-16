import { Injectable, inject, signal } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import { RightPageState } from './right-page/right-page-state';

/**
 * Focus mode: the book lies at a single page, the chat alone on the
 * desk, and everything else is put away until you turn back to two pages.
 * One of the right page's own pages, such as Files, can lie there alone
 * in the chat's place. The book opens the way you left it.
 */
@Injectable({ providedIn: 'root' })
export class Focus {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly rightPage = inject(RightPageState);

  readonly on = signal(false);
  /** The right page's own page that lies alone in the chat's place, by ID; null for the chat. */
  readonly alone = signal<string | null>(null);
  /** Whether you've gone in or out since the book opened, so the remembered way doesn't undo it. */
  private moved = false;

  constructor() {
    this.bridge.invoke('layout.get', {}).then(
      (layout) => {
        if (this.moved || !layout?.focus) return;
        this.on.set(true);
        this.alone.set(layout.focusPage ?? null);
      },
      () => {},
    );
  }

  /** Lays the chat alone, so a page tab's page, the command palette or the approvals close first. */
  enter(): void {
    if (!this.rightPage.turnBack()) return;
    this.set(true);
    this.lay(null);
  }

  leave(): void {
    this.set(false);
  }

  /** Lays one of the right page's own pages alone in the chat's place; null lays the chat. */
  lay(page: string | null): void {
    this.moved = true;
    if (this.alone() === page) return;
    this.alone.set(page);
    this.bridge.invoke('layout.set', { focusPage: page }).catch(() => {});
  }

  private set(on: boolean): void {
    this.moved = true;
    if (this.on() === on) return;
    this.on.set(on);
    this.bridge.invoke('layout.set', { focus: on }).catch(() => {});
  }
}
