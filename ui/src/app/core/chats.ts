import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import type {
  AgentId,
  AgentInfo,
  AgentModels,
  Answer,
  ApprovalMode,
  Approval,
  ApprovalDecision,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  DogEar,
  Entry,
  EventName,
  EventPayload,
  NewChatSettings,
  OpenChat,
  PlanStep,
  QueuedEntry,
  RecentFolders,
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
  /** The agent's plan, kept up to date as it works. */
  plan: readonly PlanStep[];
  /** Your entries whose file changes were undone. */
  withdrawn: readonly string[];
  /** The dog-ears folded down: pinned, starred. */
  dogEars: readonly DogEar[];
  /** Your entries copied from the chat this one was forked from; they can't be undone. */
  copied: readonly string[];
  /** Why the last turn failed, until the next message. */
  error?: string;
  /** When a blank chapter was opened, in ms since the epoch. */
  begunAt?: number;
}

const DEFAULT_AGENT = 'claude-code';

/** The settings a chapter's settings card changes. */
export type Setting = 'agent' | 'model' | 'mode' | 'folder' | 'preset';

/** A pick on the settings card. The agent and folder change only on a blank chapter. */
export interface SettingsPick {
  agent?: AgentId;
  model?: string;
  mode?: ApprovalMode;
  cwd?: string;
}

/** The settings a new chapter takes: the ones last picked or begun with. */
interface LastUsed {
  agent: AgentId;
  settings: NewChatSettings;
}

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
  /** Each agent's models, once it has listed them. */
  readonly models = signal<Readonly<Record<AgentId, AgentModels>>>({});
  readonly folders = signal<RecentFolders>({ home: '', recent: [] });
  /** The chapter whose settings card is open, and the setting it opened on. */
  readonly settingsCard = signal<{ id: string; on: Setting } | null>(null);
  private lastUsed: LastUsed | null = null;
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
    this.listen('agents.settings', ({ chatId, settings }) =>
      this.update(chatId, (c) => ({ ...c, settings })),
    );
    this.listen('agents.plan', ({ chatId, plan }) => this.update(chatId, (c) => ({ ...c, plan })));
    this.listen('agents.dogEars', ({ chatId, dogEars }) =>
      this.update(chatId, (c) => ({ ...c, dogEars })),
    );
    this.listen('agents.withdrawn', ({ chatId, withdrawn }) =>
      this.update(chatId, (c) => ({ ...c, withdrawn })),
    );
    this.bridge.invoke('agents.list', {}).then(
      (agents) => {
        this.agents.set(agents ?? []);
        for (const { id } of agents ?? []) void this.loadModels(id);
      },
      () => {},
    );
    void this.loadFolders();
    inject(PendingTasks).run(() => this.restore());
  }

  agentName(agent: AgentId): string {
    return this.agents().find((info) => info.id === agent)?.name ?? agent;
  }

  /** The model's name, or the agent's default model's when it names none. */
  modelName(agent: AgentId, model: string | undefined): string {
    const listed = this.models()[agent];
    const id = model ?? listed?.default;
    return listed?.models.find((m) => m.id === id)?.name ?? model ?? 'Default model';
  }

  /** A folder as you'd write it, with your home folder as ~. */
  folderName(cwd: string | undefined): string {
    const { home } = this.folders();
    if (!cwd) return '~';
    const rest = home && cwd.startsWith(home) ? cwd.slice(home.length) : undefined;
    return rest === '' || (rest !== undefined && /^[\\/]/.test(rest)) ? `~${rest}` : cwd;
  }

  /** Lists the recent folders again, for the settings card. */
  async loadFolders(): Promise<void> {
    try {
      const folders = await this.bridge.invoke('agents.folders', {});
      if (folders) this.folders.set(folders);
    } catch {
      // Keep the folders listed before.
    }
  }

  openSettings(id: string, on: Setting): void {
    if (this.currentId() !== id) this.turnTo(id);
    this.settingsCard.set({ id, on });
    void this.loadFolders();
  }

  closeSettings(): void {
    this.settingsCard.set(null);
  }

  /**
   * Changes a chapter's settings. A blank chapter takes any of them; a
   * chapter that has begun only a new model or permission. A new chapter
   * takes the settings picked last.
   */
  async configure(id: string, pick: SettingsPick): Promise<void> {
    const chapter = this.find(id);
    if (!chapter) return;
    if (chapter.status === 'blank') {
      const agent = pick.agent ?? chapter.agent;
      // Another agent has other models: it starts on its default.
      const { model: _, ...kept } = chapter.settings;
      const base = agent === chapter.agent ? chapter.settings : kept;
      const { agent: __, ...change } = pick;
      const settings: NewChatSettings = { ...base, ...change };
      this.update(id, (c) => ({ ...c, agent, settings }));
      return this.remember({ agent, settings });
    }
    const change = {
      ...(pick.model ? { model: pick.model } : {}),
      ...(pick.mode ? { mode: pick.mode } : {}),
    };
    try {
      await this.bridge.invoke('agents.configure', { chatId: id, change });
      this.remember({ agent: chapter.agent, settings: { ...chapter.settings, ...change } });
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Opens a blank chapter, with the settings used last, and turns to it. */
  newChapter(): void {
    const blank: Chapter = {
      id: `blank-${this.nextBlank++}`,
      agent: this.lastUsed?.agent ?? DEFAULT_AGENT,
      title: '',
      settings: this.lastUsed?.settings ?? {},
      status: 'blank',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      copied: [],
      begunAt: Date.now(),
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
      this.remember({ agent: chapter.agent, settings: chapter.settings });
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

  /** Every agent's chats, most recent first. */
  async pastChats(): Promise<ChatSummary[]> {
    const lists = await Promise.all(
      this.agents().map((agent) =>
        this.bridge.invoke('agents.chats', { agent: agent.id }).catch(() => []),
      ),
    );
    return lists.flatMap((list) => list ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Opens a saved chat as a chapter, or turns to it when it's open already. */
  async openChat(chat: ChatSummary): Promise<void> {
    if (this.find(chat.id)) return this.turnTo(chat.id);
    try {
      const open = await this.bridge.invoke('agents.open', {
        agent: chat.agent,
        chatId: chat.id,
        settings: { cwd: chat.cwd ?? this.folders().home },
      });
      this.all.update((all) => [...all.filter((c) => c.id !== open.id), fromOpenChat(open)]);
      this.turnTo(open.id);
    } catch (error) {
      const current = this.currentId();
      if (current) this.fail(current, error);
    }
  }

  /** Restores the files to how they were before one of your entries. */
  async undo(id: string, entryId: string): Promise<void> {
    this.update(id, ({ error: _, ...c }) => c);
    return this.settle(id, this.bridge.invoke('agents.undo', { chatId: id, entryId }));
  }

  /** Forks the chapter after the turn one of your entries began, and turns to the variant. */
  async fork(id: string, entryId: string): Promise<void> {
    this.update(id, ({ error: _, ...c }) => c);
    try {
      const chat = await this.bridge.invoke('agents.fork', { chatId: id, entryId });
      this.all.update((all) => [...all.filter((c) => c.id !== chat.id), fromOpenChat(chat)]);
      this.turnTo(chat.id);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Folds a chapter's dog-ear down, or unfolds it. */
  dogEar(id: string, dogEar: DogEar, folded: boolean): Promise<void> {
    return this.settle(id, this.bridge.invoke('agents.dogEar', { chatId: id, dogEar, folded }));
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
      this.lastUsed = layout?.lastUsed ?? null;
      const current = layout?.current;
      if (current && this.find(current)) return this.currentId.set(current);
    } catch {
      // The service is unreachable: start on a blank page.
    }
    this.newChapter();
  }

  /** Turns to a chapter and remembers it, so the book opens there next time. */
  private turnTo(id: string): void {
    if (this.settingsCard()?.id !== id) this.closeSettings();
    this.currentId.set(id);
    const chapter = this.find(id);
    this.bridge
      .invoke('layout.set', { current: chapter && chapter.status !== 'blank' ? id : null })
      .catch(() => {});
  }

  private remember(lastUsed: LastUsed): void {
    this.lastUsed = lastUsed;
    this.bridge.invoke('layout.set', { lastUsed }).catch(() => {});
  }

  private async loadModels(agent: AgentId): Promise<void> {
    try {
      const models = await this.bridge.invoke('agents.models', { agent });
      if (models) this.models.update((all) => ({ ...all, [agent]: models }));
    } catch {
      // The agent couldn't list its models: settings show the model's ID.
    }
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
    plan: chat.plan ?? [],
    withdrawn: chat.withdrawn ?? [],
    dogEars: chat.dogEars ?? [],
    copied: chat.copied ?? [],
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
