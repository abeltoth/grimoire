import { Injectable, computed, inject, signal } from '@angular/core';
import type { Entry, HelperRun, HelperState, ToolBlock } from '@grimoire/contract';
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
  /** Where the helper shown is with its task, when the agent said; undefined until it does. */
  private readonly said = signal<HelperState | undefined>(undefined);
  /** Whether the agent said where it is while what it did was read, which is newer than what was read. */
  private saidEarly = false;

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

  /**
   * Where the helper shown is with its task: as the agent said, else as its
   * tool call stands: working while it has no result and its chapter runs.
   */
  readonly state = computed<HelperState | undefined>(() => {
    const said = this.said();
    if (said) return said;
    const block = this.block();
    if (!block) return undefined;
    const status = this.chapter()?.status;
    const live = status === 'thinking' || status === 'writing' || status === 'waiting';
    if (!block.result) return live ? 'working' : 'stopped';
    return block.result.isError ? 'failed' : 'done';
  });

  /** Whether the helper shown is still at its task. */
  readonly running = computed(() => this.state() === 'working');

  /**
   * Whether the helper shown waits for your OK on one of its tool calls: you
   * give it in its chapter, where the approval bears the tool call's ID.
   */
  readonly waiting = computed(() => {
    const approvals = this.chapter()?.approvals ?? [];
    if (!this.running() || !approvals.length) return false;
    const calls = new Set(
      this.entries().flatMap((entry) =>
        entry.kind === 'agent' ? entry.blocks.flatMap((b) => (b.kind === 'tool' ? [b.id] : [])) : [],
      ),
    );
    return approvals.some((approval) => calls.has(approval.id));
  });

  constructor() {
    this.bridge.on('agents.helperEntry', ({ chatId, toolId, entry }) => {
      const shown = this.shown();
      if (shown?.chapterId !== chatId || shown.toolId !== toolId) return;
      if (this.loading()) this.early.push(entry);
      else this.entries.update((entries) => upsert(entries, entry));
    });
    this.bridge.on('agents.helperState', ({ chatId, toolId, state }) => {
      const shown = this.shown();
      if (shown?.chapterId !== chatId || shown.toolId !== toolId) return;
      this.saidEarly = this.loading();
      this.said.set(state);
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
    this.said.set(undefined);
    this.saidEarly = false;
    this.loading.set(true);
    this.bridge.invoke('agents.helper', { chatId: chapterId, toolId: block.id }).then(
      (run) => this.loaded(block.id, run ?? { entries: [] }),
      () => this.loaded(block.id, { entries: [] }),
    );
  }

  private loaded(toolId: string, run: HelperRun): void {
    if (this.shown()?.toolId !== toolId) return;
    this.entries.set(this.early.reduce(upsert, run.entries as readonly Entry[]));
    if (!this.saidEarly) this.said.set(run.state);
    this.early = [];
    this.saidEarly = false;
    this.loading.set(false);
  }
}

function upsert(entries: readonly Entry[], entry: Entry): readonly Entry[] {
  return entries.some((existing) => existing.id === entry.id)
    ? entries.map((existing) => (existing.id === entry.id ? entry : existing))
    : [...entries, entry];
}
