import { Component, computed, inject, signal } from '@angular/core';
import { SETTINGS_TAB } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { PageTabOrder } from '@ui/app/shell/page/page-tab-order';

/**
 * The page tabs, on the Settings page: each is dragged to its place on the
 * fore-edge, or hidden from it and shown again. Settings can't be hidden,
 * since it's where hidden tabs are shown again.
 */
@Component({
  selector: 'gr-page-tab-settings',
  templateUrl: './page-tab-settings.html',
  styleUrls: ['./page-tab-settings.css', './settings-sections.css'],
})
export class PageTabSettings {
  protected readonly order = inject(PageTabOrder);
  protected readonly wording = inject(Wording);
  protected readonly settingsTab = SETTINGS_TAB;
  protected readonly settingsLabel = computed(() => {
    const tab = this.order.all().find((entry) => entry.id === SETTINGS_TAB);
    return tab ? this.wording.label(tab) : 'Settings';
  });

  /** The tab being dragged. */
  protected readonly dragging = signal<string | null>(null);
  /** Where it would drop: before or after the tab it's over. */
  protected readonly over = signal<{ id: string; after: boolean } | null>(null);

  protected dragStart(event: DragEvent, id: string): void {
    this.dragging.set(id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  protected dragOver(event: DragEvent, id: string): void {
    if (!this.dragging()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const { top, height } = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.over.set({ id, after: height > 0 && event.clientY > top + height / 2 });
  }

  /** Drops the tab dragged before the tab it's over, or after it from its lower half. */
  protected drop(event: DragEvent): void {
    const id = this.dragging();
    const over = this.over();
    this.dragEnd();
    if (!id || !over) return;
    event.preventDefault();
    const ids = this.order.all().map((tab) => tab.id);
    const at = ids.indexOf(over.id) + (over.after ? 1 : 0);
    this.order.place(id, ids[at] ?? null);
  }

  protected dragEnd(): void {
    this.dragging.set(null);
    this.over.set(null);
  }
}
