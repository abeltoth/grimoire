import { Injectable, computed, inject, signal } from '@angular/core';
import type { Entry, ToolBlock } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { LEAF } from '@ui/app/core/leaf';
import { Facing } from '@ui/app/shell/facing';
import { Focus } from '@ui/app/shell/focus';

/** The facing page's own page that shows what a helper did. */
export const HELPER_PAGE = 'helper';

/** The helper the facing page shows: the chapter and the tool call that started it. */
interface Shown {
  chapterId: string;
  toolId: string;
  /** The tool call as it was when you opened it, for a helper a helper started. */
  block: ToolBlock;
}

/**
 * The helper shown on the facing page: the subagent one of a chapter's tool
 * calls handed a task to, and what it did, kept current while it works.
 * A loose leaf and the single page have no facing page to show it on.
 */
@Injectable({ providedIn: 'root' })
export class Helpers {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  private readonly facing = inject(Facing);
  private readonly focus = inject(Focus);
  private readonly leaf = inject(LEAF);

  private readonly shown = signal<Shown | null>(null);
  /** What the helper shown did, its replies and tools; empty until it's read. */
  readonly entries = signal<readonly Entry[]>([]);
  /** Until what it did is read. */
  readonly loading = signal(false);
  /** Entries that came while it was read, applied after. */
  private early: Entry[] = [];

  /** Whether there's a facing page to show a helper on. */
  readonly canShow = computed(() => !this.leaf && !this.focus.on());

  /** The chapter the helper shown works for. */
  readonly chapter = computed(() => {
    const shown = this.shown();
    return shown ? this.chats.all().find((chapter) => chapter.id === shown.chapterId) : undefined;
  });

  /** The tool call that started the helper shown, as it is now when the chapter holds it. */
  readonly block = computed(() => {
    const shown = this.shown();
    if (!shown) return undefined;
    for (const entry of this.chapter()?.entries ?? []) {
      if (entry.kind !== 'agent') continue;
      const block = entry.blocks.find((b) => b.kind === 'tool' && b.id === shown.toolId);
      if (block?.kind === 'tool') return block;
    }
    return shown.block;
  });

  /** Whether the helper shown is still working: its tool call has no result, and its chapter is running. */
  readonly running = computed(() => {
    const status = this.chapter()?.status;
    return !this.block()?.result && (status === 'thinking' || status === 'writing' || status === 'waiting');
  });

  constructor() {
    this.bridge.on('agents.helperEntry', ({ chatId, toolId, entry }) => {
      const shown = this.shown();
      if (shown?.chapterId !== chatId || shown.toolId !== toolId) return;
      if (this.loading()) this.early.push(entry);
      else this.entries.update((entries) => upsert(entries, entry));
    });
  }

  /** Turns the facing page to what the helper the chapter's tool call started did. */
  show(chapterId: string, block: ToolBlock): void {
    this.facing.showPage(HELPER_PAGE);
    // A page that holds changes you haven't saved keeps the facing page from turning.
    if (this.facing.turned() || this.facing.page() !== HELPER_PAGE) return;
    const shown = this.shown();
    if (shown?.chapterId === chapterId && shown.toolId === block.id) return;
    this.shown.set({ chapterId, toolId: block.id, block });
    this.entries.set([]);
    this.early = [];
    this.loading.set(true);
    this.bridge.invoke('agents.helper', { chatId: chapterId, toolId: block.id }).then(
      (entries) => this.loaded(block.id, entries ?? []),
      () => this.loaded(block.id, []),
    );
  }

  private loaded(toolId: string, entries: Entry[]): void {
    if (this.shown()?.toolId !== toolId) return;
    this.entries.set(this.early.reduce(upsert, entries as readonly Entry[]));
    this.early = [];
    this.loading.set(false);
  }
}

function upsert(entries: readonly Entry[], entry: Entry): readonly Entry[] {
  return entries.some((existing) => existing.id === entry.id)
    ? entries.map((existing) => (existing.id === entry.id ? entry : existing))
    : [...entries, entry];
}
