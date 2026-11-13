import { randomUUID } from 'node:crypto';
import type { Attachment, QueuedEntry } from '@grimoire/contract';
import type { Emit } from '../events';
import type { ChatEvents, LiveChat, Verdict } from './adapter';
import type { Approvals } from './approvals';
import { type ChatState, type ChatTable, userEntry } from './chat-table';
import type { ChatUpdates } from './chat-updates';
import type { Editors } from './editors';

/**
 * The agent processes behind the open chats. A chat's process starts with
 * the message that needs it, and passes on what the agent does; what a
 * process that was closed or replaced still reports is dropped. A message
 * sent while a turn runs waits in the chat's queue; the next goes when the
 * turn ends.
 */
export class ChatRuns {
  constructor(
    private readonly emit: Emit,
    private readonly table: ChatTable,
    private readonly updates: ChatUpdates,
    private readonly approvals: Approvals,
    private readonly editors: Editors,
  ) {}

  /** Sends a message, or queues it while a turn runs. */
  send(chat: ChatState, text: string, attachments: Attachment[] = []): void {
    if (!text.trim() && !attachments.length)
      throw new Error('Write something, or attach something, to send');
    if (chat.status === 'idle') return this.sendTo(chat, text, true, attachments);
    chat.queued.push({ id: randomUUID(), text, ...(attachments.length ? { attachments } : {}) });
    this.updates.dropSuggestion(chat);
    this.updates.emitQueued(chat);
  }

  /** Sends a message now, starting the chat's process when it has none: to continue the chat when `resume`. */
  sendTo(chat: ChatState, text: string, resume: boolean, attachments: Attachment[] = []): void {
    chat.live ??= chat.agent.run(chat.id, chat.settings, resume, this.events(chat));
    const id = randomUUID();
    this.updates.upsert(chat, userEntry(id, text, attachments));
    if (chat.status === 'idle') this.updates.setStatus(chat, 'thinking');
    chat.live.send(text, id, attachments);
  }

  /** The chat's process, started to continue the chat when it has none. */
  live(chat: ChatState): LiveChat {
    return (chat.live ??= chat.agent.run(chat.id, chat.settings, true, this.events(chat)));
  }

  /** Takes a message out of the queue; false when it had already gone. */
  unqueue(chat: ChatState, id: string): boolean {
    const index = chat.queued.findIndex((queued) => queued.id === id);
    if (index === -1) return false;
    chat.queued.splice(index, 1);
    this.updates.emitQueued(chat);
    return true;
  }

  /** Stops the running turn, and withdraws the queued messages so they aren't sent. */
  async interrupt(chat: ChatState): Promise<QueuedEntry[]> {
    const withdrawn = chat.queued.splice(0);
    if (withdrawn.length) this.updates.emitQueued(chat);
    await chat.live?.interrupt();
    return withdrawn;
  }

  /** Stops the chat's process now, or once its turn ends; its next message starts another. */
  restartWhenIdle(chat: ChatState): void {
    if (!chat.live) return;
    if (chat.status === 'idle') this.restartProcess(chat);
    else chat.restart = true;
  }

  /** What the chat's process reports, for as long as it's the chat's process. */
  events(chat: ChatState): ChatEvents {
    const processes = chat.processes;
    const current = () => this.table.chats.get(chat.id) === chat && chat.processes === processes;
    return {
      status: (status) => {
        if (current() && !this.approvals.has(chat)) this.updates.setStatus(chat, status);
      },
      entry: (entry) => {
        if (current()) this.updates.upsert(chat, entry);
      },
      text: (entryId, block, text) => {
        if (current()) this.updates.appendText(chat, entryId, block, text);
      },
      subagentEntry: (toolId, entry) => {
        if (current()) this.updates.subagentEntry(chat, toolId, entry);
      },
      subagentState: (toolId, state) => {
        if (current()) this.updates.setSubagentState(chat, toolId, state);
      },
      subagentStats: (toolId, stats) => {
        if (current()) this.updates.addSubagentStats(chat, toolId, stats);
      },
      approval: (request, signal) =>
        current() ? this.approvals.ask(chat, request, signal) : Promise.resolve<Verdict>('deny'),
      readOnly: () =>
        chat.editor
          ? `${this.editors.editing(chat)}, so this chat can't edit files in it. ` +
            'Leave the edits to that chat, unless the user makes this the editing chat.'
          : undefined,
      context: (context) => {
        if (!current()) return;
        chat.context = context;
        this.emit('agents.context', { chatId: chat.id, context });
      },
      cache: (cache) => {
        if (!current()) return;
        chat.cache = cache;
        this.emit('agents.cache', { chatId: chat.id, cache });
      },
      plan: (plan) => {
        if (!current()) return;
        chat.plan = plan;
        this.emit('agents.plan', { chatId: chat.id, plan });
      },
      tokens: (uses) => {
        const began = chat.entries.findLast((entry) => entry.kind === 'user');
        if (!current() || began?.kind !== 'user') return;
        this.updates.upsert(chat, { ...began, tokens: { at: began.at ?? Date.now(), uses } });
      },
      hooks: (runs) => {
        if (current()) this.updates.logHooks(chat, runs);
      },
      title: (title) => {
        if (!current() || title === chat.title) return;
        chat.title = title;
        this.emit('agents.title', { chatId: chat.id, title, by: 'agent' });
        this.editors.retitled(chat);
      },
      suggestion: (text) => {
        // Only while you could take it: no turn runs and nothing waits to go.
        if (!current() || chat.status !== 'idle' || chat.queued.length || !text.trim()) return;
        chat.suggestion = text;
        this.emit('agents.suggestion', { chatId: chat.id, suggestion: text });
      },
      followUps: (followUps) => {
        // Only while no turn runs: the next one, begun at once with what was queued, has gone past them.
        if (!current() || chat.status !== 'idle' || chat.queued.length || !followUps.length) return;
        chat.followUps = structuredClone(followUps);
        this.emit('agents.followUps', { chatId: chat.id, followUps: structuredClone(followUps) });
      },
      turnEnded: (error) => {
        if (!current()) return;
        this.approvals.denyAll(chat);
        this.updates.timeTurn(chat);
        this.updates.setStatus(chat, 'idle');
        this.emit('agents.turnEnded', { chatId: chat.id, ...(error ? { error } : {}) });
        if (chat.restart) this.restartProcess(chat);
        this.sendQueued(chat);
      },
      closed: (error) => {
        if (!current()) return;
        chat.live = undefined;
        chat.restart = false;
        this.approvals.denyAll(chat);
        // Subagents still at work in the background end with the process.
        for (const [toolId, run] of chat.subagents)
          if (run.state === 'working') this.updates.setSubagentState(chat, toolId, 'stopped');
        this.updates.cancelHooks(chat);
        if (chat.status !== 'idle') {
          this.updates.timeTurn(chat);
          this.updates.setStatus(chat, 'idle');
          this.emit('agents.turnEnded', { chatId: chat.id, error: error ?? 'The agent stopped' });
          this.sendQueued(chat);
        }
      },
    };
  }

  /** Stops the chat's process; its next message starts another, continuing the chat. */
  private restartProcess(chat: ChatState): void {
    chat.restart = false;
    chat.processes++;
    const live = chat.live;
    chat.live = undefined;
    live?.close();
  }

  /** A turn ended: the next queued message goes. */
  private sendQueued(chat: ChatState): void {
    const next = chat.queued.shift();
    if (!next) return;
    this.updates.emitQueued(chat);
    this.sendTo(chat, next.text, true, next.attachments);
  }
}
