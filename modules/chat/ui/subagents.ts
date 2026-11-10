import { Injectable, computed, inject, signal } from '@angular/core';
import type { Entry, SubagentRun, SubagentState, ToolBlock } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { POPOUT } from '@ui/app/core/popout';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { Focus } from '@ui/app/shell/focus';

/** The right page's own page that shows what a subagent did. */
export const SUBAGENT_PAGE = 'subagent';

/** The subagent the right page shows: the chat and the tool call that started it. */
interface Shown {
  chatId: string;
  toolId: string;
  /** The tool call as it was when you opened it, for a subagent a subagent started. */
  block: ToolBlock;
}

/**
 * The subagent shown on the right page: the subagent one of a chat's tool
 * calls handed a task to, and what it did, kept current while it works.
 * A popout and the single page have no right page to show it on.
 */
@Injectable({ providedIn: 'root' })
export class Subagents {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly rightPage = inject(RightPageState);
  private readonly focus = inject(Focus);
  private readonly popout = inject(POPOUT);

  private readonly shown = signal<Shown | null>(null);
  /** What the subagent shown did, its replies and tools; empty until it's read. */
  readonly entries = signal<readonly Entry[]>([]);
  /** Until what it did is read. */
  readonly loading = signal(false);
  /** Entries that came while it was read, applied after. */
  private early: Entry[] = [];
  /** Where the subagent shown is with its task, when the agent said; undefined until it does. */
  private readonly said = signal<SubagentState | undefined>(undefined);
  /** Whether the agent said where it is while what it did was read, which is newer than what was read. */
  private saidEarly = false;
  /** Whether any of what it did came as it went; a subagent a message resumed may not pass it on. */
  private cameLive = false;

  /** Whether there's a right page to show a subagent on. */
  readonly canShow = computed(() => !this.popout && !this.focus.on());

  /** The chat the subagent shown works for. */
  readonly chat = computed(() => {
    const shown = this.shown();
    return shown ? this.list.all().find((chat) => chat.id === shown.chatId) : undefined;
  });

  /** The tool call that started the subagent shown, as it is now when the chat holds it. */
  readonly block = computed(() => {
    const shown = this.shown();
    if (!shown) return undefined;
    for (const entry of this.chat()?.entries ?? []) {
      if (entry.kind !== 'agent') continue;
      const block = entry.blocks.find((b) => b.kind === 'tool' && b.id === shown.toolId);
      if (block?.kind === 'tool') return block;
    }
    return shown.block;
  });

  /**
   * Where the subagent shown is with its task: as the agent said, else as its
   * tool call stands: working while it has no result and its chat runs.
   */
  readonly state = computed<SubagentState | undefined>(() => {
    const said = this.said();
    if (said) return said;
    const block = this.block();
    if (!block) return undefined;
    const status = this.chat()?.status;
    const live = status === 'thinking' || status === 'writing' || status === 'waiting';
    if (!block.result) return live ? 'working' : 'stopped';
    return block.result.isError ? 'failed' : 'done';
  });

  /** Whether the subagent shown is still at its task. */
  readonly running = computed(() => this.state() === 'working');

  /**
   * Whether the subagent shown waits for your OK on one of its tool calls: you
   * give it in its chat, where the approval bears the tool call's ID.
   */
  readonly waiting = computed(() => {
    const approvals = this.chat()?.approvals ?? [];
    if (!this.running() || !approvals.length) return false;
    const calls = new Set(
      this.entries().flatMap((entry) =>
        entry.kind === 'agent'
          ? entry.blocks.flatMap((b) => (b.kind === 'tool' ? [b.id] : []))
          : [],
      ),
    );
    return approvals.some((approval) => calls.has(approval.id));
  });

  constructor() {
    this.bridge.on('agents.subagentEntry', ({ chatId, toolId, entry }) => {
      const shown = this.shown();
      if (shown?.chatId !== chatId || shown.toolId !== toolId) return;
      this.cameLive = true;
      if (this.loading()) this.early.push(entry);
      else this.entries.update((entries) => upsert(entries, entry));
    });
    this.bridge.on('agents.subagentState', ({ chatId, toolId, state }) => {
      const shown = this.shown();
      if (shown?.chatId !== chatId || shown.toolId !== toolId) return;
      this.saidEarly = this.loading();
      this.said.set(state);
      // Done with none of its work come as it went: what it did is read as saved.
      if (state !== 'working' && !this.cameLive && !this.loading()) {
        this.saidEarly = true;
        this.read(chatId, toolId);
      }
    });
  }

  /** Turns the right page to what the subagent the chat's tool call started did. */
  show(chatId: string, block: ToolBlock): void {
    this.rightPage.showPage(SUBAGENT_PAGE);
    // A page that holds changes you haven't saved keeps the right page from turning.
    if (this.rightPage.turned() || this.rightPage.page() !== SUBAGENT_PAGE) return;
    const shown = this.shown();
    if (shown?.chatId === chatId && shown.toolId === block.id) return;
    this.shown.set({ chatId, toolId: block.id, block });
    this.entries.set([]);
    this.early = [];
    this.said.set(undefined);
    this.saidEarly = false;
    this.cameLive = false;
    this.read(chatId, block.id);
  }

  /** Reads what the subagent the tool call `toolId` started did. */
  private read(chatId: string, toolId: string): void {
    this.loading.set(true);
    this.bridge.invoke('agents.subagent', { chatId: chatId, toolId }).then(
      (run) => this.loaded(toolId, run ?? { entries: [] }),
      () => this.loaded(toolId, { entries: [] }),
    );
  }

  private loaded(toolId: string, run: SubagentRun): void {
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
