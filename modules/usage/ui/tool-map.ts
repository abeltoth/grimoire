import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import type { UsedTool } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { tokenCount } from '@ui/app/core/tokens';
import { type MapItem, blocksOf, shadesOf, targetItems, toolItems } from './tool-map-items';
import { squarify } from './treemap-layout';
import { uses } from './usage-format';

/** One view of the map: every tool, or what was zoomed into; its blocks are null while they're read. */
interface Level {
  name: string;
  /** The block zoomed into; none for every tool. */
  item?: MapItem;
  items: MapItem[] | null;
  error?: string;
}

/** A block as drawn: its place in percent of the map, how dark for its context a use, and what fits on it. */
interface DrawnBlock {
  item: MapItem;
  left: number;
  top: number;
  width: number;
  height: number;
  shade: number;
  named: boolean;
  figured: boolean;
}

/** The map's width against its height. */
const ASPECT = 2.5;

/** The width the map is laid out for before it's measured, as wide as the page's charts. */
const UNMEASURED = 520;

/** The least a block needs, in pixels, for its name, and for its figures under it. */
const NAMED = { width: 44, height: 26 };
const FIGURED = { width: 72, height: 46 };

/**
 * The context the tools' results added to the chats, as a map of blocks:
 * a block's size is its tokens, its shade how many it adds a use, and its
 * name is written only where it fits. Picking a tool zooms into what it ran
 * on, each file or command over all its calls; picking one of those opens
 * the chat it added the most to.
 */
@Component({
  selector: 'gr-usage-tool-map',
  templateUrl: './tool-map.html',
  styleUrls: ['./tool-map.css'],
})
export class UsageToolMap {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tools = input.required<readonly UsedTool[]>();
  /** The span's start, to read what the tools ran on over it. */
  readonly since = input.required<number>();

  protected readonly aspect = ASPECT;
  protected readonly count = tokenCount;
  protected readonly uses = uses;
  /** How wide the map is drawn, in pixels, once measured. */
  private readonly width = signal(0);

  /** The views zoomed into, past every tool's; none again over another span or another read. */
  private readonly path = linkedSignal<unknown, Level[]>({
    source: () => [this.tools(), this.since()],
    computation: () => [],
  });
  protected readonly levels = computed((): Level[] => [
    { name: 'All tools', items: toolItems(this.tools()) },
    ...this.path(),
  ]);
  protected readonly level = computed(() => this.levels().at(-1)!);

  protected readonly hovered = linkedSignal<Level, string | null>({
    source: this.level,
    computation: () => null,
  });

  protected readonly drawn = computed((): DrawnBlock[] => {
    const blocks = blocksOf(this.level().items ?? []);
    const tiles = squarify(
      blocks.map((item) => item.context),
      ASPECT,
      1,
    );
    const shades = shadesOf(blocks);
    const wide = this.width() || UNMEASURED;
    const high = wide / ASPECT;
    return tiles.map((tile, i) => {
      const [width, height] = [(tile.w / ASPECT) * wide, tile.h * high];
      const fits = (least: { width: number; height: number }) =>
        width >= least.width && height >= least.height;
      return {
        item: blocks[i]!,
        left: (tile.x / ASPECT) * 100,
        top: tile.y * 100,
        width: (tile.w / ASPECT) * 100,
        height: tile.h * 100,
        shade: shades[i]!,
        named: fits(NAMED),
        figured: fits(FIGURED),
      };
    });
  });

  /** The block under the pointer or focus. */
  protected readonly shown = computed(() => {
    const key = this.hovered();
    return this.drawn().find(({ item }) => item.key === key)?.item;
  });

  /** What the view holds in all: the block zoomed into, or every block. */
  protected readonly whole = computed(() => {
    const level = this.level();
    if (level.item && !level.item.rest) return level.item;
    const blocks = this.drawn().map(({ item }) => item);
    return {
      context: blocks.reduce((all, item) => all + item.context, 0),
      uses: blocks.reduce((all, item) => all + item.uses, 0),
    };
  });

  /** What picking a block of this view does. */
  protected readonly hint = computed(() =>
    this.drawn().some(({ item }) => item.chat)
      ? 'pick one to open the chat it added the most to'
      : 'pick a tool to see what it ran on',
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => this.width.set(entry!.contentRect.width));
      observer.observe(this.host.nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected perUse(item: MapItem): string {
    return tokenCount(item.context / Math.max(item.uses, 1));
  }

  /** How often it was used, and in how many chats when it's more than one. */
  protected usedIn(item: MapItem): string {
    return item.chats && item.chats > 1
      ? `${uses(item.uses)} in ${item.chats} chats`
      : uses(item.uses);
  }

  protected spoken(item: MapItem): string {
    return `${item.full}: ${tokenCount(item.context)} tokens of context, ${this.usedIn(item)}, ${this.perUse(item)} a use`;
  }

  protected show(key: string | null): void {
    this.hovered.set(key);
  }

  /** Zooms into a tool or into "Other", or opens the chat a file or command added the most to. */
  protected pick(item: MapItem): void {
    if (item.rest) return this.zoom({ name: 'Other', item, items: item.rest });
    if (item.chat) return void this.open(item.chat);
    if (!item.tools) return;
    const level: Level = { name: item.name, item, items: null };
    this.zoom(level);
    void this.read(level, item.tools);
  }

  /** Back to a view zoomed out, 0 for every tool. */
  protected back(depth: number): void {
    this.path.update((path) => path.slice(0, depth));
  }

  private zoom(level: Level): void {
    this.path.update((path) => [...path, level]);
  }

  private async read(level: Level, tools: string[]): Promise<void> {
    try {
      const targets = await this.bridge.invoke('search.toolTargets', {
        since: this.since(),
        tools,
      });
      this.settle(level, { items: targetItems(targets, tools.length > 1) });
    } catch (error) {
      this.settle(level, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** What was read for a view, if it's still being shown. */
  private settle(level: Level, read: Partial<Level>): void {
    this.path.update((path) => path.map((each) => (each === level ? { ...each, ...read } : each)));
  }

  private open(chat: NonNullable<MapItem['chat']>): Promise<void> {
    return this.list.openChat({
      id: chat.id,
      agent: chat.agent,
      title: chat.title,
      ...(chat.cwd ? { cwd: chat.cwd } : {}),
      updatedAt: 0,
    });
  }
}
