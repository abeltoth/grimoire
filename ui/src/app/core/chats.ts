import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import type {
  AgentId,
  AgentInfo,
  Answer,
  Approval,
  ApprovalDecision,
  ChatStatus,
  ContextUsage,
  Entry,
  EventName,
  EventPayload,
  NewChatSettings,
  OpenChat,
  QueuedEntry,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/** A chapter: one chat, or a blank page waiting for its first message. */
export interface Chapter {
  /** The chat's ID; a local one while the chapter is blank. */
  id: string;
  agent: AgentId;
  /** Empty until the agent names the chat. */
  title: string;
  settings: NewChatSettings;
  status: ChatStatus | 'blank';
  entries: readonly Entry[];
  approvals: readonly Approval[];
  /** Messages you sent while a turn ran, waiting for it to end. */
  queued: readonly QueuedEntry[];
  /** How full the context window is, once the agent reports it. */
  context?: ContextUsage;
  /** Why the last turn failed, until the next message. */
  error?: string;
}

const DEFAULT_AGENT = 'claude-code';

/**
 * The open chapters, as the window sees them: a mirror of the agent hub's
 * open chats (ADR-007), kept current by its events. The hub remembers
 * which chats are open, and the layout which one you were on, so the book
 * opens where you left it.
 */
@Injectable({ providedIn: 'root' })
export class Chats {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private nextBlank = 1;

  readonly agents = signal<readonly AgentInfo[]>([]);
  readonly all = signal<readonly Chapter[]>([]);
  readonly currentId = signal<string | undefined>(undefined);
  readonly current = computed(() => this.all().find((chapter) => chapter.id === this.currentId()));

  constructor() {
    this.listen('agents.entry', ({ chatId, entry }) =>
      this.update(chatId, (c) => ({ ...c, entries: upsert(c.entries, entry) })),
    );
    this.listen('agents.text', ({ chatId, entryId, block, text }) =>
      this.update(chatId, (c) => ({ ...c, entries: appendText(c.entries, entryId, block, text) })),
    );
    this.listen('agents.status', ({ chatId, status }) =>
      this.update(chatId, (c) => ({ ...c, status })),
    );
    this.listen('agents.title', ({ chatId, title }) =>
      this.update(chatId, (c) => ({ ...c, title })),
    );
    this.listen('agents.approval', ({ approval }) =>
      this.update(approval.chatId, (c) => ({ ...c, approvals: [...c.approvals, approval] })),
    );
    this.listen('agents.approvalSettled', ({ chatId, approvalId }) =>
      this.update(chatId, (c) => ({
        ...c,
        approvals: c.approvals.filter((a) => a.id !== approvalId),
      })),
    );
    this.listen('agents.queued', ({ chatId, queued }) =>
      this.update(chatId, (c) => ({ ...c, queued })),
    );
    this.listen('agents.context', ({ chatId, context }) =>
      this.update(chatId, (c) => ({ ...c, context })),
    );
    this.listen('agents.turnEnded', ({ chatId, error }) =>
      this.update(chatId, (c) => ({ ...c, ...(error ? { error } : {}) })),
    );
    this.bridge.invoke('agents.list', {}).then(
      (agents) => this.agents.set(agents),
      () => {},
    );
    inject(PendingTasks).run(() => this.restore());
  }

  agentName(agent: AgentId): string {
    return this.agents().find((info) => info.id === agent)?.name ?? agent;
  }

  /** Opens a blank chapter and turns to it. */
  newChapter(settings: NewChatSettings = this.current()?.settings ?? {}): void {
    const blank: Chapter = {
      id: `blank-${this.nextBlank++}`,
      agent: DEFAULT_AGENT,
      title: '',
      settings,
      status: 'blank',
      entries: [],
      approvals: [],
      queued: [],
    };
    this.all.update((all) => [...all, blank]);
    this.turnTo(blank.id);
  }

  open(id: string): void {
    this.turnTo(id);
  }

  /**
   * Closes a chapter and turns to the next one, or to a blank page. The
   * chat itself stays with the agent.
   */
  async close(id: string): Promise<void> {
    const all = this.all();
    const index = all.findIndex((chapter) => chapter.id === id);
    if (index === -1) return;
    const rest = all.filter((chapter) => chapter.id !== id);
    this.all.set(rest);
    if (this.currentId() === id) {
      const next = rest[Math.min(index, rest.length - 1)];
      if (next) this.turnTo(next.id);
      else this.newChapter();
    }
    if (all[index]!.status !== 'blank')
      await this.bridge.invoke('agents.close', { chatId: id }).catch(() => {});
  }

  /** Sends a message; a blank chapter's first one starts the chat. */
  async send(id: string, text: string): Promise<void> {
    const chapter = this.find(id);
    if (!chapter) return;
    this.update(id, ({ error: _, ...c }) => c);
    try {
      if (chapter.status !== 'blank')
        return await this.bridge.invoke('agents.send', { chatId: id, text });
      const chat = await this.bridge.invoke('agents.start', {
        agent: chapter.agent,
        settings: chapter.settings,
        text,
      });
      this.all.update((all) => all.map((c) => (c.id === id ? fromOpenChat(chat) : c)));
      if (this.currentId() === id) this.turnTo(chat.id);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Stops the running turn; the queued messages come back, unsent. */
  async interrupt(id: string): Promise<readonly QueuedEntry[]> {
    try {
      return (await this.bridge.invoke('agents.interrupt', { chatId: id })) ?? [];
    } catch (error) {
      this.fail(id, error);
      return [];
    }
  }

  /** Takes a message out of the queue; false when it had already gone. */
  async unqueue(id: string, entryId: string): Promise<boolean> {
    try {
      return await this.bridge.invoke('agents.unqueue', { chatId: id, id: entryId });
    } catch (error) {
      this.fail(id, error);
      return false;
    }
  }

  /** Seals or denies an approval; a failure shows as the chapter's error. */
  decide(id: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    return this.settle(id, this.bridge.invoke('agents.decide', { approvalId, decision }));
  }

  /** Sends your answers to the agent's questions. */
  answer(id: string, approvalId: string, answers: Answer[]): Promise<void> {
    return this.settle(id, this.bridge.invoke('agents.answer', { approvalId, answers }));
  }

  private async settle(id: string, request: Promise<void>): Promise<void> {
    try {
      await request;
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Shows why a request failed as the chapter's error. */
  private fail(id: string, error: unknown): void {
    this.update(id, (c) => ({
      ...c,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  /** Opens the chapters the hub has open, on the one you were on; else a blank page. */
  private async restore(): Promise<void> {
    try {
      const [chats, layout] = await Promise.all([
        this.bridge.invoke('agents.openChats', {}),
        this.bridge.invoke('layout.get', {}),
      ]);
      this.all.set((chats ?? []).map(fromOpenChat));
      const current = layout?.current;
      if (current && this.find(current)) return this.currentId.set(current);
    } catch {
      // The service is unreachable: start on a blank page.
    }
    this.newChapter();
  }

  /** Turns to a chapter and remembers it, so the book opens there next time. */
  private turnTo(id: string): void {
    this.currentId.set(id);
    const chapter = this.find(id);
    this.bridge
      .invoke('layout.set', { current: chapter && chapter.status !== 'blank' ? id : null })
      .catch(() => {});
  }

  private find(id: string): Chapter | undefined {
    return this.all().find((chapter) => chapter.id === id);
  }

  private update(id: string, change: (chapter: Chapter) => Chapter): void {
    this.all.update((all) => all.map((chapter) => (chapter.id === id ? change(chapter) : chapter)));
  }

  private listen<K extends EventName>(event: K, handle: (payload: EventPayload<K>) => void): void {
    this.bridge.on(event, handle);
  }
}

function fromOpenChat(chat: OpenChat): Chapter {
  return {
    id: chat.id,
    agent: chat.agent,
    title: chat.title,
    settings: chat.settings,
    status: chat.status,
    entries: chat.entries,
    approvals: chat.approvals,
    queued: chat.queued,
    ...(chat.context ? { context: chat.context } : {}),
  };
}

function upsert(entries: readonly Entry[], entry: Entry): readonly Entry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id);
  return index === -1 ? [...entries, entry] : replaceAt(entries, index, entry);
}

function appendText(
  entries: readonly Entry[],
  entryId: string,
  block: number,
  text: string,
): readonly Entry[] {
  return entries.map((entry) => {
    if (entry.id !== entryId || entry.kind !== 'agent') return entry;
    const target = entry.blocks[block];
    if (!target || target.kind === 'tool') return entry;
    return {
      ...entry,
      blocks: replaceAt(entry.blocks, block, { ...target, text: target.text + text }),
    };
  });
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}
