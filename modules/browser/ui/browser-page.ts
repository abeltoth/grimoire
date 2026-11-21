import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { BrowserMove } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Wording } from '@ui/app/core/wording';
import { Icon } from '@ui/design-system/icon';
import { addressOf, tabLabel } from './address';
import { WebTabs } from './web-tabs';

/** What floats over the pages, such as a dialog or the profiles' menu, which a web page steps aside for. */
const OVER_PAGES = 'dialog[open], [data-over-pages]';

/**
 * The browser: web pages on tabs, with an address field. The pages are
 * the app's, laid over this page's spot for them and kept there as the
 * page moves; while something floats over it, a picture of the page
 * stands in, since nothing can be drawn over a web page.
 */
@Component({
  selector: 'gr-browser-page',
  imports: [Icon],
  templateUrl: './browser-page.html',
  styleUrl: './browser-page.css',
})
export class BrowserPage {
  protected readonly tabs = inject(WebTabs);
  protected readonly wording = inject(Wording);
  private readonly views = inject(GRIMOIRE_BRIDGE).browser;
  private readonly spot = viewChild.required<ElementRef<HTMLElement>>('spot');
  private readonly address = viewChild<ElementRef<HTMLInputElement>>('address');

  /** Whether something floats over the pages. */
  private readonly covered = signal(false);
  /** The picture standing in for the page while something floats over it. */
  protected readonly snapshot = signal('');
  /** Whether the shown tab's page can show: it has an address and loaded. */
  private readonly showsPage = computed(() => {
    const tab = this.tabs.shown();
    return !!tab?.url && !tab.error;
  });
  /** The page laid over the spot, and where, as last told to the app. */
  private placed: { id: string; at: string } | null = null;

  protected readonly label = tabLabel;

  constructor() {
    void this.tabs.load();
    const destroyRef = inject(DestroyRef);

    effect(() => {
      if (!this.tabs.addressWanted()) return;
      const field = this.address()?.nativeElement;
      field?.focus();
      field?.select();
    });

    afterNextRender(() => {
      let frame = 0;
      const follow = () => {
        this.place();
        frame = requestAnimationFrame(follow);
      };
      follow();
      const watch = new MutationObserver(() => void this.cover());
      watch.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'data-over-pages'],
      });
      destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        watch.disconnect();
        this.hide();
      });
    });
  }

  protected show(id: string): void {
    this.tabs.show(id);
  }

  protected go(move: BrowserMove): void {
    this.tabs.go(move);
  }

  protected enter(field: HTMLInputElement): void {
    const url = addressOf(field.value);
    if (!url) return;
    this.tabs.navigate(url);
    field.blur();
  }

  /** Esc puts the address back and leaves the field, rather than turning the page back. */
  protected escape(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    field.value = this.tabs.shown()?.url ?? '';
    field.blur();
  }

  /** Lays the shown tab's page over the spot, telling the app only when that changes. */
  private place(): void {
    const tab = this.tabs.shown();
    if (!tab || !this.showsPage() || this.covered()) return this.hide();
    const { x, y, width, height } = this.spot().nativeElement.getBoundingClientRect();
    const rect = { x, y, width, height };
    const at = [x, y, width, height].map(Math.round).join();
    if (this.placed?.id === tab.id && this.placed.at === at) return;
    this.views.place(tab.id, rect);
    this.placed = { id: tab.id, at };
    this.snapshot.set('');
  }

  private hide(): void {
    if (!this.placed) return;
    this.views.place(this.placed.id, null);
    this.placed = null;
  }

  /** Puts a picture of the page in its place while something floats over it. */
  private async cover(): Promise<void> {
    const covered = !!document.querySelector(OVER_PAGES);
    if (covered === this.covered()) return;
    if (covered && this.placed) this.snapshot.set(await this.views.snapshot(this.placed.id));
    this.covered.set(covered);
    this.place();
  }
}
