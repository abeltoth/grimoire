import { Component, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '../../core/bridge';
import { Wording } from '../../core/wording';
import { RightPageState } from '../right-page/right-page-state';
import { ShellRegistry } from '../shell-registry';
import { ShortcutPipe } from '../shortcut';

/** How close the tabs may be drawn, as a share of their full spacing. */
const CLOSEST = 0.25;
/** How small their labels may be set, as a share of their full size; shorter still, they're cut off. */
const SMALLEST = 0.7;

/**
 * The page tabs: tabs cut into the right-hand page block, one per
 * registered page, and the gilt command palette tab at the bottom. When the book is
 * too short for them, they're drawn closer together, then their labels
 * smaller, and at the last the longest labels are cut off.
 */
@Component({
  selector: 'gr-page-tabs',
  imports: [ShortcutPipe],
  templateUrl: './page-tabs.html',
  styleUrl: './page-tabs.css',
  host: {
    role: 'navigation',
    '[attr.aria-label]': "wording.say('Thumb index', 'Pages')",
    '[style.--page-tabs-space]': 'space()',
    '[style.--page-tabs-type]': 'type()',
  },
})
export class PageTabs {
  protected readonly registry = inject(ShellRegistry);
  protected readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);
  protected readonly index = computed(() => this.registry.commands.get('shell.commandPalette'));
  /** The share of their full spacing and label size the tabs are drawn at. */
  protected readonly space = signal(1);
  protected readonly type = signal(1);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver === 'undefined') return;
    const resized = new ResizeObserver(() => this.fit(host));
    afterRenderEffect((onCleanup) => {
      this.registry.pageTabs.all();
      resized.observe(host);
      for (const tab of host.children) resized.observe(tab);
      onCleanup(() => resized.disconnect());
    });
  }

  /** Draws the tabs as large as fits them all between the book's head and foot. */
  private fit(host: HTMLElement): void {
    const tabs = [...host.children];
    const room = host.clientHeight;
    if (!tabs.length || !room) return;
    let spacing = (parseFloat(getComputedStyle(host).rowGap) || 0) * (tabs.length - 1);
    let labels = 0;
    for (const tab of tabs) {
      const style = getComputedStyle(tab);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      spacing += padding;
      // The label's full length, even where it's cut off.
      labels += tab.firstElementChild?.scrollHeight ?? 0;
    }
    // What they'd take drawn full size.
    spacing /= this.space();
    labels /= this.type();
    let space = 1;
    let type = 1;
    if (spacing + labels > room) {
      space = Math.max(CLOSEST, (room - labels) / spacing);
      if (space === CLOSEST) type = Math.max(SMALLEST, (room - CLOSEST * spacing) / labels);
    }
    if (Math.abs(space - this.space()) > 0.005) this.space.set(space);
    if (Math.abs(type - this.type()) > 0.005) this.type.set(type);
  }
}
