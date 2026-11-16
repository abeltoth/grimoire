import { Injectable, computed, inject } from '@angular/core';
import { SETTINGS_TAB } from '@grimoire/contract';
import { Settings } from '../../core/settings';
import { type PageTab, ShellRegistry } from '../shell-registry';

/**
 * The page tabs as you arranged them in Settings: in your order, a tab
 * you never moved keeping the place its feature gives it, and those you
 * hid left out of the fore-edge. Settings always shows.
 */
@Injectable({ providedIn: 'root' })
export class PageTabOrder {
  private readonly registry = inject(ShellRegistry);
  private readonly settings = inject(Settings);

  /** Every page tab, hidden or not, in your order. */
  readonly all = computed(() =>
    arrange(this.registry.pageTabs.all(), this.settings.all().pageTabOrder ?? []),
  );
  // A service started before these settings existed doesn't send them.
  private readonly hiddenIds = computed(() => this.settings.all().pageTabsHidden ?? []);

  /** The tabs the fore-edge shows. */
  readonly shown = computed(() => this.all().filter((tab) => !this.hidden(tab.id)));

  hidden(id: string): boolean {
    return id !== SETTINGS_TAB && this.hiddenIds().includes(id);
  }

  /** Moves a tab to just before another, or to the end when that's null. */
  place(id: string, before: string | null): void {
    if (id === before) return;
    const ids = this.all()
      .map((tab) => tab.id)
      .filter((other) => other !== id);
    const at = before === null ? ids.length : ids.indexOf(before);
    if (at < 0) return;
    ids.splice(at, 0, id);
    if (ids.every((other, i) => other === this.all()[i]?.id)) return;
    void this.settings.set({ pageTabOrder: ids });
  }

  /** Hides a shown tab or shows a hidden one; Settings stays. */
  toggle(id: string): void {
    if (id === SETTINGS_TAB) return;
    const hidden = this.hiddenIds();
    void this.settings.set({
      pageTabsHidden: hidden.includes(id) ? hidden.filter((kept) => kept !== id) : [...hidden, id],
    });
  }
}

/** The tabs in `order` take the places they hold among themselves; the rest keep theirs. */
export function arrange(tabs: readonly PageTab[], order: readonly string[]): PageTab[] {
  const rank = (tab: PageTab) => order.indexOf(tab.id);
  const placed = tabs.filter((tab) => rank(tab) >= 0).sort((a, b) => rank(a) - rank(b));
  let next = 0;
  return tabs.map((tab) => (rank(tab) >= 0 ? placed[next++]! : tab));
}
