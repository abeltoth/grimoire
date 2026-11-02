import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
  AgentCommand,
  AgentId,
  AgentInfo,
  AgentModels,
  Answer,
  Approval,
  ApprovalDecision,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  Enclosure,
  DogEar,
  Entry,
  EventName,
  EventPayload,
  NewChatSettings,
  OpenChat,
  PlanStep,
  PlanUsage,
  QueuedEntry,
  RecentFolders,
  SettingsChange,
} from '@grimoire/contract';
import type { DatabaseSync } from 'node:sqlite';
import { Chapters } from '../storage/chapters';
import { openDatabase } from '../storage/database';
import { DogEars } from '../storage/dog-ears';
import { EntryIds } from '../storage/entry-ids';
import { Tags } from '../storage/tags';
import { UsageReadings } from '../storage/usage-readings';
import type { AgentAdapter, ChatEvents, LiveChat, Verdict } from './adapter';

export type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

interface ChatState {
  id: ChatId;
  agent: AgentAdapter;
  title: string;
  settings: ChatSettings;
  status: ChatStatus;
  entries: Entry[];
  /** Messages you sent while a turn ran; the next goes when it ends. */
  queued: QueuedEntry[];
  /** How full the context window is, once the agent reports it. */
  context?: ContextUsage;
  plan: PlanStep[];
  /** Your entries whose file changes were undone. */
  withdrawn: string[];
  dogEars: DogEar[];
  tags: string[];
  /** Your entries copied from the chat this one was forked from. */
  copied: string[];
  /** While the agent process runs. */
  live?: LiveChat;
  /** Streamed text not sent to windows yet, per entry and block. */
  pendingText: Map<string, { entryId: string; block: number; text: string }>;
  flushTimer?: NodeJS.Timeout;
}

interface PendingApproval {
  approval: Approval;
  resolve: (verdict: Verdict) => void;
}

/** What the hub keeps across restarts, in Grimoire's database (ADR-009). */
export interface HubStore {
  /** The chats open as chapters, so they reopen after a restart. */
  chapters: Chapters;
  /** Your entries whose edits were undone. */
  withdrawn: EntryIds;
  /** Your entries a fork copied; the agent can't undo them. */
  copied: EntryIds;
  /** Which chats are pinned or starred. */
  dogEars: DogEars;
  /** Your tags for chats. */
  tags: Tags;
  /** Each reading of the agents' plan limits. */
  usage: UsageReadings;
}

export function hubStore(db: DatabaseSync): HubStore {
  return {
    chapters: new Chapters(db),
    withdrawn: new EntryIds(db, 'withdrawn'),
    copied: new EntryIds(db, 'copied'),
    dogEars: new DogEars(db),
    tags: new Tags(db),
    usage: new UsageReadings(db),
  };
}

/**
 * The agent hub (ADR-007): the open chats, their transcripts and pending
 * approvals, kept in memory (ADR-009), with what outlasts a restart in
 * `store`. Windows are views of it:
 * they get a chat's state when they open it and its changes as events.
 * Streamed text is batched, at most one event per chat every `textBatchMs`.
 */
export class AgentHub {
  private readonly adapters = new Map<AgentId, AgentAdapter>();
  private readonly chats = new Map<ChatId, ChatState>();
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(
    private readonly emit: Emit,
    private readonly textBatchMs = 50,
    private readonly store = hubStore(openDatabase(':memory:')),
  ) {}

  addAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.info.id, adapter);
  }

  agents(): AgentInfo[] {
    return [...this.adapters.values()].map((adapter) => adapter.info);
  }

  async listChats(agent: AgentId, cwd?: string): Promise<ChatSummary[]> {
    const chats = await this.adapter(agent).listChats(cwd);
    const dogEars = this.store.dogEars.all();
    return chats.map((chat) => ({ ...chat, dogEars: dogEars.get(chat.id) ?? [] }));
  }

  models(agent: AgentId): Promise<AgentModels> {
    return this.adapter(agent).models();
  }

  /** The agent's commands and skills in a folder; none when it has no such thing. */
  async commands(agent: AgentId, cwd?: string): Promise<AgentCommand[]> {
    return (await this.adapter(agent).commands?.(cwd ?? homedir())) ?? [];
  }

  /** The agent's plan limits, read now and kept; null when it has no plan. */
  async usage(agent: AgentId): Promise<PlanUsage | null> {
    const adapter = this.adapter(agent);
    if (!adapter.usage) return null;
    const usage = await adapter.usage();
    this.store.usage.record(agent, usage);
    return usage;
  }

  /**
   * Reads every agent's plan limits now and then every `ms`, so their
   * history is kept even while no one looks. Returns a function that stops it.
   */
  readUsageEvery(ms: number): () => void {
    const read = () => {
      for (const adapter of this.adapters.values()) {
        if (adapter.usage) this.usage(adapter.info.id).catch(() => {});
      }
    };
    read();
    const timer = setInterval(read, ms);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** The folders chats with any agent ran in, most recent first. */
  async folders(): Promise<RecentFolders> {
    const lists = await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.listChats().catch(() => [])),
    );
    const recent = lists
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap((chat) => (chat.cwd ? [chat.cwd] : []));
    return { home: homedir(), recent: [...new Set(recent)] };
  }

  /** The chats open as chapters, in ribbon order. Those that no longer open are forgotten. */
  async openChats(): Promise<OpenChat[]> {
    const chats = await Promise.all(
      this.store.chapters.list().map(({ agent, chatId, settings }) =>
        this.open(agent, chatId, settings).catch(() => {
          this.store.chapters.remove(chatId);
          return undefined;
        }),
      ),
    );
    return chats.filter((chat) => chat !== undefined);
  }

  async open(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<OpenChat> {
    let chat = this.chats.get(chatId);
    if (!chat) {
      const adapter = this.adapter(agent);
      const [history, title] = await Promise.all([
        adapter.history(chatId, settings.cwd),
        adapter.title(chatId, settings.cwd),
      ]);
      // Another window may have opened it meanwhile.
      chat = this.chats.get(chatId) ?? this.track(chatId, adapter, settings, history.entries, title);
      chat.plan = history.plan;
      chat.withdrawn = this.store.withdrawn.list(chatId);
      chat.dogEars = this.store.dogEars.of(chatId);
      chat.tags = this.store.tags.of(chatId);
      chat.copied = this.store.copied.list(chatId);
    }
    this.store.chapters.add({ chatId, agent, settings: chat.settings });
    return this.snapshot(chat);
  }

  async start(
    agent: AgentId,
    settings: NewChatSettings,
    text: string,
    title?: string,
    enclosures: Enclosure[] = [],
  ): Promise<OpenChat> {
    const resolved: ChatSettings = { ...settings, cwd: settings.cwd ?? homedir() };
    const adapter = this.adapter(agent);
    const named = title?.trim() || undefined;
    if (!adapter.start) {
      const chat = this.track(randomUUID(), adapter, resolved, [], named ?? '');
      this.store.chapters.add({ chatId: chat.id, agent, settings: resolved });
      chat.live = adapter.run(chat.id, resolved, false, this.eventsFor(chat), named);
      this.sendTo(chat, text, false, enclosures);
      return this.snapshot(chat);
    }
    // The agent picks the chat's ID, on a spare process when it has one.
    let chat: ChatState | undefined;
    const id = randomUUID();
    const live = await adapter.start(
      resolved,
      text,
      id,
      (chatId) => {
        chat = this.track(chatId, adapter, resolved, [], named ?? '');
        this.store.chapters.add({ chatId, agent, settings: resolved });
        this.upsert(chat, userEntry(id, text, enclosures));
        this.setStatus(chat, 'thinking');
        return this.eventsFor(chat);
      },
      named,
      enclosures,
    );
    if (!chat) throw new Error(`${agent} started a chat without naming it`);
    // Closed while it started.
    if (this.chats.get(chat.id) !== chat) live.close();
    else chat.live = live;
    return this.snapshot(chat);
  }

  /** Sends a message, or queues it while a turn runs. */
  send(chatId: ChatId, text: string, enclosures: Enclosure[] = []): void {
    const chat = this.chat(chatId);
    if (!text.trim() && !enclosures.length) throw new Error('Write something, or attach something, to send');
    if (chat.status === 'idle') return this.sendTo(chat, text, true, enclosures);
    chat.queued.push({ id: randomUUID(), text, ...(enclosures.length ? { enclosures } : {}) });
    this.emitQueued(chat);
  }

  /** Changes a chat's model or permission, for its running process too. */
  async configure(chatId: ChatId, change: SettingsChange): Promise<void> {
    const chat = this.chat(chatId);
    await chat.live?.configure(change);
    chat.settings = { ...chat.settings, ...change };
    this.store.chapters.add({ chatId, agent: chat.agent.info.id, settings: chat.settings });
    this.emit('agents.settings', { chatId, settings: chat.settings });
  }

  /**
   * Restores the files to how they were before one of your entries, starting
   * the agent's process when the chat has none. That entry's edits, and those
   * of every entry after it, are withdrawn.
   */
  async undo(chatId: ChatId, entryId: string): Promise<void> {
    const chat = this.chat(chatId);
    if (chat.status !== 'idle') throw new Error('Stop the turn before undoing');
    const from = chat.entries.findIndex((entry) => entry.kind === 'user' && entry.id === entryId);
    if (from === -1) throw new Error('This entry is not in the chat');
    if (chat.withdrawn.includes(entryId)) throw new Error('This entry is already undone');
    if (chat.copied.includes(entryId))
      throw new Error("This entry was copied from the chat this one was forked from, so it can't be undone");
    chat.live ??= chat.agent.run(chat.id, chat.settings, true, this.eventsFor(chat));
    if (!chat.live.undo) throw new Error(`${chat.agent.info.name} can't undo`);
    await chat.live.undo(entryId);

    const undone = chat.entries
      .slice(from)
      .filter((entry) => entry.kind === 'user' && !chat.withdrawn.includes(entry.id))
      .map((entry) => entry.id);
    this.store.withdrawn.add(chatId, undone);
    chat.withdrawn.push(...undone);
    this.emit('agents.withdrawn', { chatId, withdrawn: [...chat.withdrawn] });
  }

  /**
   * Forks a chat after the turn one of your entries began into a variant,
   * such as "Context meter (a)", and opens it as a chapter.
   */
  async fork(chatId: ChatId, entryId: string): Promise<OpenChat> {
    const chat = this.chat(chatId);
    if (!chat.agent.fork) throw new Error(`${chat.agent.info.name} can't fork`);
    if (chat.status !== 'idle') throw new Error('Stop the turn before forking');
    const title = await this.variantTitle(chat);
    const forkId = await chat.agent.fork(chat.id, chat.settings.cwd, entryId, title);
    const variant = await this.open(chat.agent.info.id, forkId, chat.settings);
    // The fork's entries are copies, without the original's file checkpoints.
    this.store.copied.add(
      forkId,
      variant.entries.filter((entry) => entry.kind === 'user').map((entry) => entry.id),
    );
    const copied = this.store.copied.list(forkId);
    const opened = this.chats.get(forkId);
    if (opened) opened.copied = copied;
    return { ...variant, copied };
  }

  /** The chat's title with the first free variant letter: "Context meter (a)", then "(b)". */
  private async variantTitle(chat: ChatState): Promise<string> {
    const base = chat.title.replace(/ \([a-z]\)$/, '') || 'Untitled chapter';
    const taken = new Set((await chat.agent.listChats(chat.settings.cwd)).map((c) => c.title));
    const letter = [...'abcdefghijklmnopqrstuvwxyz'].find((l) => !taken.has(`${base} (${l})`));
    return `${base} (${letter ?? 'z'})`;
  }

  /** Folds a chat's dog-ear down, or unfolds it. */
  /** Renames a chat with its agent. */
  async rename(chatId: ChatId, title: string): Promise<void> {
    const chat = this.chat(chatId);
    const named = title.trim();
    if (!named) throw new Error('A chapter needs a title');
    if (!chat.agent.rename) throw new Error(`${chat.agent.info.name} can't rename chats`);
    await chat.agent.rename(chatId, chat.settings.cwd, named);
    chat.title = named;
    this.emit('agents.title', { chatId, title: named });
  }

  dogEar(chatId: ChatId, dogEar: DogEar, folded: boolean): void {
    this.store.dogEars.set(chatId, dogEar, folded);
    const dogEars = this.store.dogEars.of(chatId);
    const chat = this.chats.get(chatId);
    if (chat) chat.dogEars = dogEars;
    this.emit('agents.dogEars', { chatId, dogEars });
  }

  /** Sets a chat's tags: trimmed, without blanks, and each once whatever its case. */
  tag(chatId: ChatId, tags: readonly string[]): void {
    const seen = new Set<string>();
    const kept = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
    this.store.tags.set(chatId, kept);
    const chat = this.chats.get(chatId);
    if (chat) chat.tags = kept;
    this.emit('agents.tags', { chatId, tags: kept });
  }

  /** Takes a message out of the queue; false when it had already gone. */
  unqueue(chatId: ChatId, id: string): boolean {
    const chat = this.chat(chatId);
    const index = chat.queued.findIndex((queued) => queued.id === id);
    if (index === -1) return false;
    chat.queued.splice(index, 1);
    this.emitQueued(chat);
    return true;
  }

  /** Stops the running turn, and withdraws the queued messages so they aren't sent. */
  async interrupt(chatId: ChatId): Promise<QueuedEntry[]> {
    const chat = this.chat(chatId);
    const withdrawn = chat.queued.splice(0);
    if (withdrawn.length) this.emitQueued(chat);
    await chat.live?.interrupt();
    return withdrawn;
  }

  decide(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.pending(approvalId);
    if (pending.approval.questions && decision !== 'deny')
      throw new Error('This approval asks questions; answer them instead');
    this.settle(pending, decision);
  }

  answer(approvalId: string, answers: Answer[]): void {
    const pending = this.pending(approvalId);
    const { questions } = pending.approval;
    if (!questions) throw new Error('This approval asks no questions');
    if (answers.length !== questions.length)
      throw new Error(`Expected ${questions.length} answers, got ${answers.length}`);
    this.settle(pending, { answers });
  }

  /** Closes a chat's chapter: it's no longer open after a restart. */
  close(chatId: ChatId): void {
    this.store.chapters.remove(chatId);
    this.release(chatId);
  }

  /** Stops every chat and spare process, for when the service stops; chats reopen when it starts again. */
  closeAll(): void {
    for (const id of [...this.chats.keys()]) this.release(id);
    for (const adapter of this.adapters.values()) adapter.dispose?.();
  }

  private release(chatId: ChatId): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    this.chats.delete(chatId);
    this.settleAll(chat);
    chat.live?.close();
    clearTimeout(chat.flushTimer);
  }

  private track(
    id: ChatId,
    agent: AgentAdapter,
    settings: ChatSettings,
    entries: Entry[],
    title: string,
  ): ChatState {
    const chat: ChatState = {
      id,
      agent,
      title,
      settings,
      status: 'idle',
      entries,
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
      pendingText: new Map(),
    };
    this.chats.set(id, chat);
    return chat;
  }

  private sendTo(chat: ChatState, text: string, resume: boolean, enclosures: Enclosure[] = []): void {
    chat.live ??= chat.agent.run(chat.id, chat.settings, resume, this.eventsFor(chat));
    const id = randomUUID();
    this.upsert(chat, userEntry(id, text, enclosures));
    if (chat.status === 'idle') this.setStatus(chat, 'thinking');
    chat.live.send(text, id, enclosures);
  }

  /** A turn ended: the next queued message goes. */
  private sendQueued(chat: ChatState): void {
    const next = chat.queued.shift();
    if (!next) return;
    this.emitQueued(chat);
    this.sendTo(chat, next.text, true, next.enclosures);
  }

  private emitQueued(chat: ChatState): void {
    this.emit('agents.queued', { chatId: chat.id, queued: [...chat.queued] });
  }

  private eventsFor(chat: ChatState): ChatEvents {
    // Events from a process that was closed, or replaced, are dropped.
    const current = () => this.chats.get(chat.id) === chat;
    return {
      status: (status) => {
        if (current() && !this.hasApprovals(chat)) this.setStatus(chat, status);
      },
      entry: (entry) => {
        if (current()) this.upsert(chat, entry);
      },
      text: (entryId, block, text) => {
        if (current()) this.appendText(chat, entryId, block, text);
      },
      approval: (request, signal) =>
        new Promise<Verdict>((resolve) => {
          if (!current() || signal.aborted) return resolve('deny');
          const approval: Approval = { ...request, chatId: chat.id, at: Date.now() };
          const pending: PendingApproval = { approval, resolve };
          this.approvals.set(approval.id, pending);
          signal.addEventListener('abort', () => this.settle(pending, 'deny'), { once: true });
          this.flush(chat);
          this.emit('agents.approval', { approval });
          this.setStatus(chat, 'waiting');
        }),
      context: (context) => {
        if (!current()) return;
        chat.context = context;
        this.emit('agents.context', { chatId: chat.id, context });
      },
      plan: (plan) => {
        if (!current()) return;
        chat.plan = plan;
        this.emit('agents.plan', { chatId: chat.id, plan });
      },
      title: (title) => {
        if (!current() || title === chat.title) return;
        chat.title = title;
        this.emit('agents.title', { chatId: chat.id, title });
      },
      turnEnded: (error) => {
        if (!current()) return;
        this.settleAll(chat);
        this.setStatus(chat, 'idle');
        this.emit('agents.turnEnded', { chatId: chat.id, ...(error ? { error } : {}) });
        this.sendQueued(chat);
      },
      closed: (error) => {
        if (!current()) return;
        chat.live = undefined;
        this.settleAll(chat);
        if (chat.status !== 'idle') {
          this.setStatus(chat, 'idle');
          this.emit('agents.turnEnded', { chatId: chat.id, error: error ?? 'The agent stopped' });
          this.sendQueued(chat);
        }
      },
    };
  }

  private upsert(chat: ChatState, update: Entry): void {
    this.flush(chat);
    // A copy: the hub appends streamed text to its own entries.
    const entry = structuredClone(update);
    const known = chat.entries.find((existing) => existing.id === entry.id);
    entry.at ??= known?.at ?? Date.now();
    const index = chat.entries.findIndex((existing) => existing.id === entry.id);
    if (index === -1) chat.entries.push(entry);
    else chat.entries[index] = entry;
    this.emit('agents.entry', { chatId: chat.id, entry });
  }

  private appendText(chat: ChatState, entryId: string, block: number, text: string): void {
    const entry = chat.entries.find((existing) => existing.id === entryId);
    const target = entry?.kind === 'agent' ? entry.blocks[block] : undefined;
    if (!target || target.kind === 'tool') return;
    target.text += text;

    const key = `${entryId}/${block}`;
    const pending = chat.pendingText.get(key);
    if (pending) pending.text += text;
    else chat.pendingText.set(key, { entryId, block, text });
    chat.flushTimer ??= setTimeout(() => this.flush(chat), this.textBatchMs);
  }

  /** Sends the batched text now, so it arrives before the next event. */
  private flush(chat: ChatState): void {
    clearTimeout(chat.flushTimer);
    chat.flushTimer = undefined;
    for (const pending of chat.pendingText.values())
      this.emit('agents.text', { chatId: chat.id, ...pending });
    chat.pendingText.clear();
  }

  private setStatus(chat: ChatState, status: ChatStatus): void {
    if (chat.status === status) return;
    this.flush(chat);
    chat.status = status;
    this.emit('agents.status', { chatId: chat.id, status });
  }

  private pending(approvalId: string): PendingApproval {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new Error('This approval is no longer pending');
    return pending;
  }

  private settle(pending: PendingApproval, verdict: Verdict): void {
    const { approval } = pending;
    if (!this.approvals.delete(approval.id)) return;
    pending.resolve(verdict);
    this.emit('agents.approvalSettled', { chatId: approval.chatId, approvalId: approval.id });
    const chat = this.chats.get(approval.chatId);
    if (chat && chat.status === 'waiting' && !this.hasApprovals(chat))
      this.setStatus(chat, 'thinking');
  }

  private settleAll(chat: ChatState): void {
    for (const pending of [...this.approvals.values()]) {
      if (pending.approval.chatId === chat.id) this.settle(pending, 'deny');
    }
  }

  private hasApprovals(chat: ChatState): boolean {
    return [...this.approvals.values()].some((pending) => pending.approval.chatId === chat.id);
  }

  private snapshot(chat: ChatState): OpenChat {
    this.flush(chat);
    return {
      id: chat.id,
      agent: chat.agent.info.id,
      title: chat.title,
      settings: chat.settings,
      status: chat.status,
      entries: structuredClone(chat.entries),
      approvals: [...this.approvals.values()]
        .filter((pending) => pending.approval.chatId === chat.id)
        .map((pending) => pending.approval),
      queued: [...chat.queued],
      ...(chat.context ? { context: chat.context } : {}),
      plan: chat.plan,
      withdrawn: [...chat.withdrawn],
      dogEars: [...chat.dogEars],
      tags: [...chat.tags],
      copied: [...chat.copied],
    };
  }

  private adapter(agent: AgentId): AgentAdapter {
    const adapter = this.adapters.get(agent);
    if (!adapter) throw new Error(`Unknown agent: ${agent}`);
    return adapter;
  }

  private chat(chatId: ChatId): ChatState {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error('This chat is not open');
    return chat;
  }
}

function userEntry(id: string, text: string, enclosures: Enclosure[]): Entry {
  return { kind: 'user', id, text, ...(enclosures.length ? { enclosures } : {}) };
}
