import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
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
  Entry,
  EventName,
  EventPayload,
  NewChatSettings,
  OpenChat,
  QueuedEntry,
  RecentFolders,
  SettingsChange,
} from '@grimoire/contract';
import { Chapters } from '../storage/chapters';
import { openDatabase } from '../storage/database';
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

/**
 * The agent hub (ADR-007): the open chats, their transcripts and pending
 * approvals, kept in memory (ADR-009). Which chats are open is kept in
 * `chapters`, so they reopen after a restart. Windows are views of it:
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
    private readonly chapters = new Chapters(openDatabase(':memory:')),
  ) {}

  addAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.info.id, adapter);
  }

  agents(): AgentInfo[] {
    return [...this.adapters.values()].map((adapter) => adapter.info);
  }

  listChats(agent: AgentId, cwd?: string): Promise<ChatSummary[]> {
    return this.adapter(agent).listChats(cwd);
  }

  models(agent: AgentId): Promise<AgentModels> {
    return this.adapter(agent).models();
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
      this.chapters.list().map(({ agent, chatId, settings }) =>
        this.open(agent, chatId, settings).catch(() => {
          this.chapters.remove(chatId);
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
      const [entries, title] = await Promise.all([
        adapter.transcript(chatId, settings.cwd),
        adapter.title(chatId, settings.cwd),
      ]);
      // Another window may have opened it meanwhile.
      chat = this.chats.get(chatId) ?? this.track(chatId, adapter, settings, entries, title);
    }
    this.chapters.add({ chatId, agent, settings: chat.settings });
    return this.snapshot(chat);
  }

  async start(agent: AgentId, settings: NewChatSettings, text: string): Promise<OpenChat> {
    const resolved: ChatSettings = { ...settings, cwd: settings.cwd ?? homedir() };
    const adapter = this.adapter(agent);
    if (!adapter.start) {
      const chat = this.track(randomUUID(), adapter, resolved, [], '');
      this.chapters.add({ chatId: chat.id, agent, settings: resolved });
      this.sendTo(chat, text, false);
      return this.snapshot(chat);
    }
    // The agent picks the chat's ID, on a spare process when it has one.
    let chat: ChatState | undefined;
    const live = await adapter.start(resolved, text, (chatId) => {
      chat = this.track(chatId, adapter, resolved, [], '');
      this.chapters.add({ chatId, agent, settings: resolved });
      this.upsert(chat, { kind: 'user', id: randomUUID(), text });
      this.setStatus(chat, 'thinking');
      return this.eventsFor(chat);
    });
    if (!chat) throw new Error(`${agent} started a chat without naming it`);
    // Closed while it started.
    if (this.chats.get(chat.id) !== chat) live.close();
    else chat.live = live;
    return this.snapshot(chat);
  }

  /** Sends a message, or queues it while a turn runs. */
  send(chatId: ChatId, text: string): void {
    const chat = this.chat(chatId);
    if (chat.status === 'idle') return this.sendTo(chat, text, true);
    chat.queued.push({ id: randomUUID(), text });
    this.emitQueued(chat);
  }

  /** Changes a chat's model or permission, for its running process too. */
  async configure(chatId: ChatId, change: SettingsChange): Promise<void> {
    const chat = this.chat(chatId);
    await chat.live?.configure(change);
    chat.settings = { ...chat.settings, ...change };
    this.chapters.add({ chatId, agent: chat.agent.info.id, settings: chat.settings });
    this.emit('agents.settings', { chatId, settings: chat.settings });
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
    this.chapters.remove(chatId);
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
      pendingText: new Map(),
    };
    this.chats.set(id, chat);
    return chat;
  }

  private sendTo(chat: ChatState, text: string, resume: boolean): void {
    chat.live ??= chat.agent.run(chat.id, chat.settings, resume, this.eventsFor(chat));
    this.upsert(chat, { kind: 'user', id: randomUUID(), text });
    if (chat.status === 'idle') this.setStatus(chat, 'thinking');
    chat.live.send(text);
  }

  /** A turn ended: the next queued message goes. */
  private sendQueued(chat: ChatState): void {
    const next = chat.queued.shift();
    if (!next) return;
    this.emitQueued(chat);
    this.sendTo(chat, next.text, true);
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
