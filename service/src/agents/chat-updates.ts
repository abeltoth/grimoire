import type { ChatStatus, Entry, HookRun, SubagentRun, SubagentState, UserEntry } from '@grimoire/contract';
import type { Emit } from '../events';
import type { ChatState } from './chat-table';

/**
 * Changes what an open chat holds, and tells every window. Streamed text
 * is batched, at most one event per chat every `textBatchMs`; any other
 * change to the chat sends what's batched first.
 */
export class ChatUpdates {
  constructor(
    private readonly emit: Emit,
    private readonly textBatchMs: number,
  ) {}

  upsert(chat: ChatState, update: Entry): void {
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

  appendText(chat: ChatState, entryId: string, block: number, text: string): void {
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
  flush(chat: ChatState): void {
    clearTimeout(chat.flushTimer);
    chat.flushTimer = undefined;
    for (const pending of chat.pendingText.values())
      this.emit('agents.text', { chatId: chat.id, ...pending });
    chat.pendingText.clear();
  }

  setStatus(chat: ChatState, status: ChatStatus): void {
    if (chat.status === status) return;
    this.flush(chat);
    chat.status = status;
    this.emit('agents.status', { chatId: chat.id, status });
    // A turn began: what was suggested and offered before it no longer stands.
    if (status !== 'idle') {
      this.dropSuggestion(chat);
      this.dropFollowUps(chat);
    }
  }

  dropFollowUps(chat: ChatState): void {
    if (chat.followUps === undefined) return;
    chat.followUps = undefined;
    this.emit('agents.followUps', { chatId: chat.id, followUps: null });
  }

  dropSuggestion(chat: ChatState): void {
    if (chat.suggestion === undefined) return;
    chat.suggestion = undefined;
    this.emit('agents.suggestion', { chatId: chat.id, suggestion: null });
  }

  emitQueued(chat: ChatState): void {
    this.emit('agents.queued', { chatId: chat.id, queued: [...chat.queued] });
  }

  /**
   * Writes each hook run on your message that began the turn it ran on: the
   * one it's already written on, else the last. One that runs between turns
   * goes with the turn before.
   */
  logHooks(chat: ChatState, runs: readonly HookRun[]): void {
    const yours = chat.entries.filter((entry): entry is UserEntry => entry.kind === 'user');
    const changed = new Map<string, UserEntry>();
    for (const run of runs) {
      const began = yours.findLast((entry) => entry.hooks?.some((known) => known.id === run.id)) ?? yours.at(-1);
      if (!began) continue;
      const entry = changed.get(began.id) ?? { ...began, hooks: [...(began.hooks ?? [])] };
      const hooks = entry.hooks!;
      const at = hooks.findIndex((known) => known.id === run.id);
      if (at === -1) hooks.push(run);
      else hooks[at] = run;
      changed.set(began.id, entry);
    }
    for (const entry of changed.values()) this.upsert(chat, entry);
  }

  /** Hooks still running when the process ends never say how they went: they were cancelled. */
  cancelHooks(chat: ChatState): void {
    for (const entry of chat.entries) {
      if (entry.kind !== 'user' || !entry.hooks?.some((run) => run.outcome === 'running')) continue;
      const hooks = entry.hooks.map((run) =>
        run.outcome === 'running' ? { ...run, outcome: 'cancelled' as const } : run,
      );
      this.upsert(chat, { ...entry, hooks });
    }
  }

  /** Writes how long the turn took on your message that began it. */
  timeTurn(chat: ChatState): void {
    const began = chat.entries.findLast((entry) => entry.kind === 'user');
    if (began?.kind !== 'user' || began.at === undefined || began.took !== undefined) return;
    this.upsert(chat, { ...began, took: Date.now() - began.at });
  }

  /** Keeps a new or changed entry of a subagent's run, apart from the chat's transcript. */
  subagentEntry(chat: ChatState, toolId: string, update: Entry): void {
    const entry = structuredClone(update);
    const { entries } = this.subagentRun(chat, toolId);
    const index = entries.findIndex((existing) => existing.id === entry.id);
    entry.at ??= entries[index]?.at ?? Date.now();
    if (index === -1) entries.push(entry);
    else entries[index] = entry;
    this.emit('agents.subagentEntry', { chatId: chat.id, toolId, entry });
  }

  setSubagentState(chat: ChatState, toolId: string, state: SubagentState): void {
    this.subagentRun(chat, toolId).state = state;
    this.emit('agents.subagentState', { chatId: chat.id, toolId, state });
  }

  /** The run of the subagent the chat's tool call `toolId` started, kept from its first word. */
  private subagentRun(chat: ChatState, toolId: string): SubagentRun {
    let run = chat.subagents.get(toolId);
    if (!run) chat.subagents.set(toolId, (run = { entries: [] }));
    return run;
  }
}
