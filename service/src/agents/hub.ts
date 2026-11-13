import { homedir } from 'node:os';
import type {
  AgentCapability,
  AgentCommand,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentSignIn,
  Answer,
  ApprovalDecision,
  Attachment,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  NewChatSettings,
  OpenChat,
  ParallelFrom,
  PromptCache,
  QueuedEntry,
  Entry,
  TitledBy,
  RecentFolders,
  SettingsChange,
  SubagentRun,
} from '@grimoire/contract';
import type { Emit } from '../events';
import { openDatabase } from '../storage/database';
import { Accounts } from './accounts';
import type { AgentAdapter } from './adapter';
import { Approvals } from './approvals';
import { ChatRuns } from './chat-runs';
import { type ChatState, ChatTable, hubStore } from './chat-table';
import { ChatUpdates } from './chat-updates';
import { Editors } from './editors';
import { HubLifecycle } from './hub-lifecycle';
import { NewChats } from './new-chats';

/** What `AgentHub.glance` tells of an open chat. */
export interface ChatGlance {
  agent: AgentId;
  title: string;
  /** The folder it works in. */
  cwd: string;
  status: ChatStatus;
  capabilities: readonly AgentCapability[];
  cache?: PromptCache;
}

/**
 * The agent hub (ADR-007): the open chats, their transcripts and pending
 * approvals, kept in memory (ADR-009), with what outlasts a restart in
 * `store`. Windows are views of it:
 * they get a chat's state when they open it and its changes as events.
 * Streamed text is batched, at most one event per chat every `textBatchMs`.
 *
 * Of the open chats sent one entry in parallel, one edits; the others
 * can't edit files (ADR-011). Any other chat edits.
 *
 * Its parts: ChatUpdates changes what a chat holds, ChatRuns runs the
 * agent processes, NewChats begins chats, Approvals waits for your
 * decisions, Editors picks the chat that edits, Accounts signs the
 * agents in, and HubLifecycle puts the chats away.
 */
export class AgentHub {
  private readonly table = new ChatTable();
  private readonly updates: ChatUpdates;
  private readonly approvals: Approvals;
  private readonly editors: Editors;
  private readonly accounts: Accounts;
  private readonly runs: ChatRuns;
  private readonly newChats: NewChats;
  private readonly lifecycle: HubLifecycle;

  constructor(
    private readonly emit: Emit,
    textBatchMs = 50,
    private readonly store = hubStore(openDatabase(':memory:')),
  ) {
    this.updates = new ChatUpdates(emit, textBatchMs);
    this.approvals = new Approvals(emit, this.table, this.updates);
    this.editors = new Editors(emit, this.table, store);
    // The agent's open chats move to its new account, each as soon as no turn runs.
    this.accounts = new Accounts(emit, this.table, (adapter) => {
      for (const chat of this.table.chats.values())
        if (chat.agent === adapter) this.runs.restartWhenIdle(chat);
    });
    this.runs = new ChatRuns(emit, this.table, this.updates, this.approvals, this.editors);
    this.newChats = new NewChats(this.table, store, this.updates, this.editors, this.runs, {
      open: (agent, chatId, settings) => this.open(agent, chatId, settings),
      snapshot: (chat) => this.snapshot(chat),
    });
    this.lifecycle = new HubLifecycle(
      this.table,
      store,
      this.approvals,
      this.editors,
      this.accounts,
    );
  }

  addAdapter(adapter: AgentAdapter): void {
    this.table.adapters.set(adapter.info.id, adapter);
  }

  agents(): AgentInfo[] {
    return [...this.table.adapters.values()].map((adapter) => adapter.info);
  }

  listChats(agent: AgentId, cwd?: string): Promise<ChatSummary[]> {
    return this.table.adapter(agent).listChats(cwd);
  }

  models(agent: AgentId): Promise<AgentModels> {
    return this.table.adapter(agent).models();
  }

  /** Answers a one-off prompt on the agent's model for quick jobs; rejects when the agent can't. */
  ask(agent: AgentId, instructions: string, text: string, signal: AbortSignal): Promise<string> {
    const adapter = this.table.adapter(agent);
    if (!adapter.ask) return Promise.reject(new Error(`${adapter.info.name} can't answer prompts`));
    return adapter.ask(instructions, text, signal);
  }

  /** The agent's commands and skills in a folder; none when it has no such thing. */
  async commands(agent: AgentId, cwd?: string): Promise<AgentCommand[]> {
    return (await this.table.adapter(agent).commands?.(cwd ?? homedir())) ?? [];
  }

  /** Who the agent is signed in as, read now, and any sign-in under way. */
  account(agent: AgentId): Promise<AgentSignIn> {
    return this.accounts.account(agent);
  }

  /**
   * Signs the agent in to another account, in the browser, for every chat;
   * a sign-in already under way is cancelled. Open chats move to the new
   * account: an idle chat's process stops, and its next message starts it
   * again, continuing the chat; a running turn ends first.
   */
  signIn(agent: AgentId, email: string): Promise<AgentSignIn> {
    return this.accounts.signIn(agent, email);
  }

  signInCode(agent: AgentId, code: string): void {
    this.accounts.signInCode(agent, code);
  }

  cancelSignIn(agent: AgentId): void {
    this.accounts.cancelSignIn(agent);
  }

  /** Every window hears who each agent is signed in as now, read again, as after a profile switch. */
  announceAccounts(): Promise<void> {
    return this.accounts.announceAll();
  }

  /** The folders chats with any agent ran in, most recent first. */
  async folders(): Promise<RecentFolders> {
    const lists = await Promise.all(
      [...this.table.adapters.values()].map((adapter) => adapter.listChats().catch(() => [])),
    );
    const recent = lists
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap((chat) => (chat.cwd ? [chat.cwd] : []));
    return { home: homedir(), recent: [...new Set(recent)] };
  }

  /**
   * The open chats, in chat tab order. Those that no longer open
   * are forgotten. Once all are open, the chats sent in parallel edit as
   * they did before.
   */
  async openChats(): Promise<OpenChat[]> {
    const chats = await Promise.all(
      this.store.chats.list().map(({ agent, chatId, settings }) =>
        this.load(agent, chatId, settings).catch(() => {
          this.store.chats.remove(chatId);
          return undefined;
        }),
      ),
    );
    this.editors.settle();
    return chats.filter((chat) => chat !== undefined).map((chat) => this.snapshot(chat));
  }

  /** Opens a chat; it only reads when another open chat it was sent in parallel with edits. */
  async open(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<OpenChat> {
    const chat = await this.load(agent, chatId, settings);
    this.editors.settle();
    return this.snapshot(chat);
  }

  /** Starts a chat with your first message; a title given is yours, as if you'd named it. */
  async start(
    agent: AgentId,
    settings: NewChatSettings,
    text: string,
    title?: string,
    attachments: Attachment[] = [],
  ): Promise<OpenChat> {
    const chat = await this.newChats.start(agent, settings, text, title, attachments);
    if (title?.trim()) this.emit('agents.title', { chatId: chat.id, title: chat.title, by: 'you' });
    return chat;
  }

  parallel(
    from: ParallelFrom,
    model: string,
    text: string,
    attachments: Attachment[] = [],
  ): Promise<OpenChat> {
    return this.newChats.parallel(from, model, text, attachments);
  }

  fork(chatId: ChatId, entryId: string): Promise<OpenChat> {
    return this.newChats.fork(chatId, entryId);
  }

  /** An open chat's status, cache and what its agent can do, without copying its transcript; undefined once it's closed. */
  glance(chatId: ChatId): ChatGlance | undefined {
    const chat = this.table.chats.get(chatId);
    if (!chat) return undefined;
    const { status, cache, title } = chat;
    return {
      agent: chat.agent.info.id,
      title,
      cwd: chat.settings.cwd,
      status,
      capabilities: chat.agent.info.capabilities,
      ...(cache ? { cache } : {}),
    };
  }

  /** A chat's transcript as the agent saved it, open or not. */
  async transcript(agent: AgentId, chatId: ChatId, cwd: string): Promise<Entry[]> {
    return (await this.table.adapter(agent).history(chatId, cwd)).entries;
  }

  /** Sends a message, or queues it while a turn runs. */
  send(chatId: ChatId, text: string, attachments: Attachment[] = []): void {
    this.runs.send(this.table.chat(chatId), text, attachments);
  }

  /** Takes a message out of the queue; false when it had already gone. */
  unqueue(chatId: ChatId, id: string): boolean {
    return this.runs.unqueue(this.table.chat(chatId), id);
  }

  /** Stops the running turn, and withdraws the queued messages so they aren't sent. */
  interrupt(chatId: ChatId): Promise<QueuedEntry[]> {
    return this.runs.interrupt(this.table.chat(chatId));
  }

  /**
   * Changes a chat's model or permission, for its running process too. Its
   * MCP servers can't change in a running process: it starts again, as soon
   * as no turn runs, continuing the chat.
   */
  async configure(chatId: ChatId, change: SettingsChange): Promise<void> {
    const chat = this.table.chat(chatId);
    const { mcpOff, ...live } = change;
    if (mcpOff && !(Array.isArray(mcpOff) && mcpOff.every((name) => typeof name === 'string')))
      throw new Error('MCP servers are turned off by name');
    const servers = mcpOff && !sameNames(mcpOff, chat.settings.mcpOff ?? []);
    if (Object.keys(live).length) await chat.live?.configure(live);
    // Another model, picked by you, ends Auto.
    const { autoModel, ...kept } = chat.settings;
    chat.settings = { ...kept, ...(autoModel && !change.model ? { autoModel } : {}), ...change };
    if (!chat.settings.mcpOff?.length) delete chat.settings.mcpOff;
    this.store.chats.add({ chatId, agent: chat.agent.info.id, settings: chat.settings });
    this.emit('agents.settings', { chatId, settings: chat.settings });
    if (servers) this.runs.restartWhenIdle(chat);
  }

  /**
   * The MCP servers turned off in every chat changed: each open chat's
   * process starts again, as soon as no turn runs, continuing the chat.
   */
  mcpChanged(): void {
    for (const chat of this.table.chats.values()) this.runs.restartWhenIdle(chat);
  }

  /**
   * What the subagent the chat's tool call `toolId` started did: as it went,
   * while the chat was live, or else as the agent saved it. A subagent whose
   * work didn't come live, such as one a message resumed, reads as saved,
   * where it is with its task as it came live.
   */
  async subagent(chatId: ChatId, toolId: string): Promise<SubagentRun> {
    const chat = this.table.chat(chatId);
    const live = chat.subagents.get(toolId);
    if (live?.entries.length) {
      // What came live leaves out what only its saved files say, such as its effort.
      const saved = await chat.agent
        .subagentStats?.(chat.id, chat.settings.cwd, toolId)
        .catch(() => undefined);
      const run = structuredClone(live);
      const stats = { ...saved, ...run.stats };
      return Object.keys(stats).length ? { ...run, stats } : run;
    }
    const saved = chat.agent.subagent
      ? await chat.agent.subagent(chat.id, chat.settings.cwd, toolId)
      : { entries: [] };
    const stats = { ...saved.stats, ...live?.stats };
    return {
      ...saved,
      ...(live?.state ? { state: live.state } : {}),
      ...(Object.keys(stats).length ? { stats } : {}),
    };
  }

  /**
   * Restores the files to how they were before one of your messages, starting
   * the agent's process when the chat has none. That entry's edits, and those
   * of every entry after it, are withdrawn. A chat that only reads
   * can't.
   */
  async undo(chatId: ChatId, entryId: string): Promise<void> {
    const chat = this.table.chat(chatId);
    if (chat.editor)
      throw new Error(`${this.editors.editing(chat)}: make this the editing chat to undo`);
    if (chat.status !== 'idle') throw new Error('Stop the turn before undoing');
    const from = chat.entries.findIndex((entry) => entry.kind === 'user' && entry.id === entryId);
    if (from === -1) throw new Error('This message is not in the chat');
    if (chat.withdrawn.includes(entryId)) throw new Error('This message is already undone');
    if (chat.copied.includes(entryId))
      throw new Error(
        "This message was copied from the chat this one was forked from, so it can't be undone",
      );
    const live = this.runs.live(chat);
    if (!live.undo) throw new Error(`${chat.agent.info.name} can't undo`);
    await live.undo(entryId);

    const undone = chat.entries
      .slice(from)
      .filter((entry) => entry.kind === 'user' && !chat.withdrawn.includes(entry.id))
      .map((entry) => entry.id);
    this.store.withdrawn.add(chatId, undone);
    chat.withdrawn.push(...undone);
    this.emit('agents.withdrawn', { chatId, withdrawn: [...chat.withdrawn] });
  }

  /** Renames a chat with its agent; `by` says who named it, you unless Grimoire did on your behalf. */
  async rename(chatId: ChatId, title: string, by: TitledBy = 'you'): Promise<void> {
    const chat = this.table.chat(chatId);
    const named = title.trim();
    if (!named) throw new Error('A chat needs a title');
    if (!chat.agent.rename) throw new Error(`${chat.agent.info.name} can't rename chats`);
    await chat.agent.rename(chatId, chat.settings.cwd, named);
    chat.title = named;
    this.emit('agents.title', { chatId, title: named, by });
    this.editors.retitled(chat);
  }

  /**
   * Takes one of the separate tasks the chat offered, by its place among
   * them: it goes from the chat, and what a new chat for it begins with
   * comes back. It works where the chat does, at its model, effort,
   * permission and MCP servers.
   */
  takeFollowUp(
    chatId: ChatId,
    index: number,
  ): { agent: AgentId; settings: NewChatSettings; prompt: string } {
    const chat = this.table.chat(chatId);
    const taken = chat.followUps?.[index];
    if (!taken) throw new Error('This task is no longer offered');
    const rest = chat.followUps!.filter((_, i) => i !== index);
    chat.followUps = rest.length ? rest : undefined;
    this.emit('agents.followUps', { chatId, followUps: rest.length ? [...rest] : null });
    const { cwd, model, effort, mode, mcpOff } = chat.settings;
    const settings: NewChatSettings = {
      cwd,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(mode ? { mode } : {}),
      ...(mcpOff?.length ? { mcpOff: [...mcpOff] } : {}),
    };
    return { agent: chat.agent.info.id, settings, prompt: taken.prompt };
  }

  decide(approvalId: string, decision: ApprovalDecision): void {
    this.approvals.decide(approvalId, decision);
  }

  answer(approvalId: string, answers: Answer[]): void {
    this.approvals.answer(approvalId, answers);
  }

  /** Makes the chat the one that edits of those sent in parallel: the chat that edited only reads from now on. */
  takeOver(chatId: ChatId): void {
    this.editors.takeOver(this.table.chat(chatId));
  }

  close(chatId: ChatId): void {
    this.lifecycle.close(chatId);
  }

  closeAll(): void {
    this.lifecycle.closeAll();
  }

  busy(): string | undefined {
    return this.lifecycle.busy();
  }

  putAway(): void {
    this.lifecycle.putAway();
  }

  /** Opens a chat, unless it's open already, leaving who edits as it was. */
  private async load(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<ChatState> {
    let chat = this.table.chats.get(chatId);
    if (!chat) {
      const adapter = this.table.adapter(agent);
      const [history, title] = await Promise.all([
        adapter.history(chatId, settings.cwd),
        adapter.title(chatId, settings.cwd),
      ]);
      // Another window may have opened it meanwhile.
      chat =
        this.table.chats.get(chatId) ??
        this.table.track(chatId, adapter, settings, history.entries, title);
      chat.plan = history.plan;
      if (history.cache && !chat.cache) chat.cache = history.cache;
      chat.withdrawn = this.store.withdrawn.list(chatId);
      chat.copied = this.store.copied.list(chatId);
      // What the last turn offered stands, unless the chat went on meanwhile.
      if (history.followUps?.length && chat.status === 'idle' && !chat.followUps)
        chat.followUps = history.followUps;
    }
    this.store.chats.add({ chatId, agent, settings: chat.settings });
    return chat;
  }

  private snapshot(chat: ChatState): OpenChat {
    this.updates.flush(chat);
    const readOnly = this.editors.readOnlyOf(chat);
    return {
      id: chat.id,
      agent: chat.agent.info.id,
      title: chat.title,
      settings: chat.settings,
      status: chat.status,
      entries: structuredClone(chat.entries),
      approvals: this.approvals.of(chat),
      queued: [...chat.queued],
      ...(chat.context ? { context: chat.context } : {}),
      ...(chat.cache ? { cache: chat.cache } : {}),
      plan: chat.plan,
      withdrawn: [...chat.withdrawn],
      copied: [...chat.copied],
      ...(chat.suggestion !== undefined ? { suggestion: chat.suggestion } : {}),
      ...(chat.followUps ? { followUps: structuredClone(chat.followUps) } : {}),
      ...(readOnly ? { readOnly } : {}),
    };
  }
}

/** Whether two lists name the same, in any order. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name) => b.includes(name));
}
