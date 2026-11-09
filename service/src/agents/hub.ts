import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type {
  AgentAccount,
  AgentCommand,
  AgentId,
  AgentInfo,
  AgentMemories,
  AgentModels,
  AgentSetup,
  AgentSignIn,
  SetupFile,
  Answer,
  Approval,
  ApprovalDecision,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  PromptCache,
  Attachment,
  Mark,
  Editor,
  Entry,
  EventName,
  EventPayload,
  FollowUp,
  SubagentRun,
  SubagentState,
  HookRun,
  NewChatSettings,
  OpenChat,
  ParallelFrom,
  PlanStep,
  PlanUsage,
  QueuedEntry,
  RecentFolders,
  SettingsChange,
  UsageBreakdown,
  UsageReading,
  UserEntry,
} from '@grimoire/contract';
import type { DatabaseSync } from 'node:sqlite';
import { OpenChats } from '../storage/open-chats';
import { openDatabase } from '../storage/database';
import { Pins } from '../storage/pins';
import { Parallels } from '../storage/parallels';
import { EntryIds } from '../storage/entry-ids';
import { Tags } from '../storage/tags';
import { UsageReadings, sameAccount } from '../storage/usage-readings';
import type { AgentAdapter, ChatEvents, LiveChat, SignInRun, Verdict } from './adapter';
import { samePath } from './files';
import { MemoryFiles } from './memory-files';
import { MemoryWatcher } from './memory-watcher';
import { SetupFiles } from './setup-files';
import { SetupWatcher } from './setup-watcher';

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
  /** What the last reply left in the prompt cache. */
  cache?: PromptCache;
  plan: PlanStep[];
  /** Your messages whose file changes were undone. */
  withdrawn: string[];
  pins: Mark[];
  tags: string[];
  /** Your messages copied from the chat this one was forked from. */
  copied: string[];
  /** What the agent suggests you send next, until a turn begins or something is queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins or you take each. */
  followUps?: FollowUp[];
  /** While another chat it was sent in parallel with edits (ADR-011): that chat. This one can't edit files. */
  editor?: ChatId;
  /** While the agent process runs. */
  live?: LiveChat;
  /** How many processes the chat has had; what an earlier one still reports is dropped. */
  processes: number;
  /** The agent was signed in to another account during a turn: the process starts again once it ends. */
  restart: boolean;
  /** What the subagents its tool calls started did while it was live, and where they are, by tool call. */
  subagents: Map<string, SubagentRun>;
  /** Streamed text not sent to windows yet, per entry and block. */
  pendingText: Map<string, { entryId: string; block: number; text: string }>;
  flushTimer?: NodeJS.Timeout;
}

/** A sign-in under way, waiting for you in the browser. */
interface SigningIn {
  email: string;
  url: string | null;
  run: SignInRun;
}

/** An email: something, an @, and a domain, without spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

interface PendingApproval {
  approval: Approval;
  resolve: (verdict: Verdict) => void;
}

/** What the hub keeps across restarts, in Grimoire's database (ADR-009). */
export interface HubStore {
  /** The open chats, so they reopen after a restart. */
  chats: OpenChats;
  /** Your messages whose edits were undone. */
  withdrawn: EntryIds;
  /** Your messages a fork copied; the agent can't undo them. */
  copied: EntryIds;
  /** Which chats are pinned or starred. */
  pins: Pins;
  /** Your tags for chats. */
  tags: Tags;
  /** Each reading of the agents' plan limits. */
  usage: UsageReadings;
  /** The chats sent one entry in parallel, and the one that edits each group. */
  parallels: Parallels;
}

export function hubStore(db: DatabaseSync): HubStore {
  return {
    chats: new OpenChats(db),
    withdrawn: new EntryIds(db, 'withdrawn'),
    copied: new EntryIds(db, 'copied'),
    pins: new Pins(db),
    tags: new Tags(db),
    usage: new UsageReadings(db),
    parallels: new Parallels(db),
  };
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
 */
export class AgentHub {
  private readonly adapters = new Map<AgentId, AgentAdapter>();
  private readonly chats = new Map<ChatId, ChatState>();
  private readonly approvals = new Map<string, PendingApproval>();
  /** Who each agent was last read to be signed in as. */
  private readonly accounts = new Map<AgentId, AgentAccount | null>();
  private readonly signIns = new Map<AgentId, SigningIn>();
  private readonly setupFiles = new SetupFiles((agent, cwd) => this.setup(agent, cwd));
  private readonly memoryFiles = new MemoryFiles((agent, cwd) => this.memories(agent, cwd));
  private readonly setupWatcher = new SetupWatcher((agent, cwd) =>
    this.emit('agents.setupChanged', { agent, cwd }),
  );
  private readonly memoryWatcher = new MemoryWatcher((agent, cwd) =>
    this.emit('agents.memoriesChanged', { agent, cwd }),
  );

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
    const pins = this.store.pins.all();
    const tags = this.store.tags.all();
    return chats.map((chat) => ({
      ...chat,
      pins: pins.get(chat.id) ?? [],
      tags: tags.get(chat.id) ?? [],
    }));
  }

  models(agent: AgentId): Promise<AgentModels> {
    return this.adapter(agent).models();
  }

  /** The agent's commands and skills in a folder; none when it has no such thing. */
  async commands(agent: AgentId, cwd?: string): Promise<AgentCommand[]> {
    return (await this.adapter(agent).commands?.(cwd ?? homedir())) ?? [];
  }

  /** What the agent loads in a folder, your home folder when there's none; null when it can't say. */
  async setup(agent: AgentId, cwd?: string): Promise<AgentSetup | null> {
    const setup = (await this.adapter(agent).setup?.(cwd ?? homedir())) ?? null;
    if (setup) {
      this.setupFiles.remember(agent, setup);
      this.setupWatcher.watch(agent, setup);
    }
    return setup;
  }

  /** The memories the agent keeps for a folder, your home folder when there's none; null when it keeps none. */
  async memories(agent: AgentId, cwd?: string): Promise<AgentMemories | null> {
    const memories = (await this.adapter(agent).memories?.(cwd ?? homedir())) ?? null;
    if (memories) this.memoryWatcher.watch(agent, memories);
    return memories;
  }

  /** One of the memories the agent keeps for the folder. */
  openMemory(agent: AgentId, cwd: string | undefined, file: string): Promise<SetupFile> {
    return this.memoryFiles.open(agent, cwd ?? homedir(), file);
  }

  /** Writes one of the memories the agent keeps for the folder, unless it changed since it was opened. */
  saveMemory(
    agent: AgentId,
    cwd: string | undefined,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    return this.memoryFiles.save(agent, cwd ?? homedir(), file, text, changedAt);
  }

  /** Deletes one of the memories the agent keeps for the folder, and its line in the index. */
  deleteMemory(
    agent: AgentId,
    cwd: string | undefined,
    file: string,
    changedAt: number,
  ): Promise<void> {
    return this.memoryFiles.delete(agent, cwd ?? homedir(), file, changedAt);
  }

  /** One of the files the agent's setup in the folder lists. */
  openSetupFile(agent: AgentId, cwd: string | undefined, file: string): Promise<SetupFile> {
    return this.setupFiles.open(agent, cwd ?? homedir(), file);
  }

  /** Writes one of the files the agent's setup in the folder lists, unless it changed since it was opened. */
  saveSetupFile(
    agent: AgentId,
    cwd: string | undefined,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    return this.setupFiles.save(agent, cwd ?? homedir(), file, text, changedAt);
  }

  /** The agent's plan limits, read now and kept; null when it has no plan. */
  async usage(agent: AgentId): Promise<PlanUsage | null> {
    const adapter = this.adapter(agent);
    if (!adapter.usage) return null;
    const usage = await adapter.usage();
    this.store.usage.record(agent, usage);
    return usage;
  }

  /** Who the agent is signed in as, read now, and any sign-in under way. */
  async account(agent: AgentId): Promise<AgentSignIn> {
    return this.signInState(agent, true);
  }

  /**
   * Signs the agent in to another account, in the browser, for every chat;
   * a sign-in already under way is cancelled. Open chats move to the new
   * account: an idle chat's process stops, and its next message starts it
   * again, continuing the chat; a running turn ends first. Then the plan's
   * limits are read again, as they're the new account's.
   */
  async signIn(agent: AgentId, email: string): Promise<AgentSignIn> {
    const adapter = this.adapter(agent);
    if (!adapter.signIn) throw new Error(`${adapter.info.name} can't switch accounts`);
    const to = email.trim();
    if (!EMAIL.test(to)) throw new Error('Give the email of the account to sign in to');
    this.signIns.get(agent)?.run.cancel();
    const signingIn: SigningIn = {
      email: to,
      url: null,
      run: adapter.signIn(to, (url) => {
        if (this.signIns.get(agent) !== signingIn) return;
        signingIn.url = url;
        void this.announceSignIn(agent, false);
      }),
    };
    this.signIns.set(agent, signingIn);
    void this.announceSignIn(agent, false);
    try {
      await signingIn.run.done;
    } catch (error) {
      if (this.signIns.get(agent) === signingIn) {
        this.signIns.delete(agent);
        void this.announceSignIn(agent, false);
      }
      throw error;
    }
    if (this.signIns.get(agent) === signingIn) this.signIns.delete(agent);
    this.moveToNewAccount(adapter);
    if (adapter.usage) this.usage(agent).catch(() => {});
    return this.announceSignIn(agent, true);
  }

  /** Passes on the code the sign-in page shows, when it doesn't return to the agent by itself. */
  signInCode(agent: AgentId, code: string): void {
    const signingIn = this.signIns.get(agent);
    if (!signingIn) throw new Error('No sign-in is under way');
    if (!code.trim()) throw new Error('Paste the code the sign-in page shows');
    signingIn.run.code(code);
  }

  /** Stops a sign-in under way; the agent stays signed in as before. */
  cancelSignIn(agent: AgentId): void {
    this.signIns.get(agent)?.run.cancel();
  }

  /** Each reading of the agent's plan limits kept since a time, oldest first: those of the account signed in now. */
  usageHistory(agent: AgentId, since: number): UsageReading[] {
    return sameAccount(this.store.usage.since(agent, since));
  }

  /** What the agent's own scan says took the plan's usage; null when it can't say. */
  async usageBreakdown(agent: AgentId): Promise<UsageBreakdown | null> {
    const adapter = this.adapter(agent);
    return adapter.usageBreakdown ? adapter.usageBreakdown() : null;
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

  /**
   * The folders chats ran in that are still there, most recent first,
   * leaving out those in the temp folder, such as a test run's.
   */
  async setupFolders(temp = tmpdir()): Promise<string[]> {
    const inTemp = samePath(temp) + path.sep;
    const { recent } = await this.folders();
    return recent.filter(
      (cwd) => existsSync(cwd) && !(samePath(cwd) + path.sep).startsWith(inTemp),
    );
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
    this.settleEditors();
    return chats.filter((chat) => chat !== undefined).map((chat) => this.snapshot(chat));
  }

  /** Opens a chat; it only reads when another open chat it was sent in parallel with edits. */
  async open(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<OpenChat> {
    const chat = await this.load(agent, chatId, settings);
    this.settleEditors();
    return this.snapshot(chat);
  }

  /** Opens a chat, unless it's open already, leaving who edits as it was. */
  private async load(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<ChatState> {
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
      if (history.cache && !chat.cache) chat.cache = history.cache;
      chat.withdrawn = this.store.withdrawn.list(chatId);
      chat.pins = this.store.pins.of(chatId);
      chat.tags = this.store.tags.of(chatId);
      chat.copied = this.store.copied.list(chatId);
      // What the last turn offered stands, unless the chat went on meanwhile.
      if (history.followUps?.length && chat.status === 'idle' && !chat.followUps) chat.followUps = history.followUps;
    }
    this.store.chats.add({ chatId, agent, settings: chat.settings });
    return chat;
  }

  /** Starts a new chat with its first message. */
  async start(
    agent: AgentId,
    settings: NewChatSettings,
    text: string,
    title?: string,
    attachments: Attachment[] = [],
  ): Promise<OpenChat> {
    let resolved: ChatSettings = { ...settings, cwd: settings.cwd ?? homedir() };
    if (resolved.autoModel) resolved = await this.autoPicked(agent, resolved, text);
    return this.begin(agent, resolved, text, title?.trim() || undefined, attachments);
  }

  /**
   * A new chat's settings on Auto: the model and effort the agent picks for
   * its first message, in place of any set; the agent's defaults when it can't say.
   */
  private async autoPicked(agent: AgentId, settings: ChatSettings, text: string): Promise<ChatSettings> {
    const { model: _, effort: __, ...rest } = settings;
    const picked = await this.adapter(agent)
      .pickModel?.(text)
      .catch(() => undefined);
    return { ...rest, ...picked };
  }

  /**
   * Sends one entry to a second model too, in a chat of its own: from a
   * chat that has begun, a copy of it, after the message goes to the chat
   * itself; from a new chat's settings, a chat begun afresh. The second
   * works in the same folder, so while the first edits, the second only
   * reads (ADR-011).
   */
  async parallel(from: ParallelFrom, model: string, text: string, attachments: Attachment[] = []): Promise<OpenChat> {
    if (!text.trim() && !attachments.length) throw new Error('Write something, or attach something, to send');
    if (!('chatId' in from)) {
      const cwd = from.settings.cwd ?? homedir();
      const named = from.title?.trim();
      const title = named ? await this.variantTitle(this.adapter(from.agent), named, cwd) : undefined;
      // The second model is the one asked for, not Auto's.
      const { autoModel: _, ...settings } = from.settings;
      return this.begin(from.agent, { ...settings, cwd, model }, text, title, attachments, from.alongside);
    }
    const chat = this.chat(from.chatId);
    if (!chat.agent.fork) throw new Error(`${chat.agent.info.name} can't copy a chat to another model`);
    if (chat.status !== 'idle') throw new Error('Wait for the turn to end, or stop it, to send to two models');
    const last = chat.entries.findLast((entry) => entry.kind === 'user');
    if (!last) throw new Error('This chat has nothing to copy yet');
    const title = await this.variantTitle(chat.agent, chat.title, chat.settings.cwd);
    const forkId = await chat.agent.fork(chat.id, chat.settings.cwd, last.id, title);
    // The chat goes on at once; its copy follows once it's open.
    this.send(chat.id, text, attachments);
    const { autoModel: _, ...settings } = chat.settings;
    this.store.parallels.join(forkId, chat.id);
    const variant = await this.open(chat.agent.info.id, forkId, { ...settings, model });
    // The copy's entries are copies, without the original's file checkpoints.
    this.store.copied.add(
      forkId,
      variant.entries.filter((entry) => entry.kind === 'user').map((entry) => entry.id),
    );
    const copy = this.chat(forkId);
    copy.copied = this.store.copied.list(forkId);
    this.send(forkId, text, attachments);
    return this.snapshot(copy);
  }

  /** Begins a chat with its first message, where its settings say; sent in parallel with `alongside`, when given. */
  private async begin(
    agent: AgentId,
    resolved: ChatSettings,
    text: string,
    named: string | undefined,
    attachments: Attachment[],
    alongside?: ChatId,
  ): Promise<OpenChat> {
    const adapter = this.adapter(agent);
    if (!adapter.start) {
      const chat = this.track(randomUUID(), adapter, resolved, [], named ?? '');
      if (alongside) this.store.parallels.join(chat.id, alongside);
      this.store.chats.add({ chatId: chat.id, agent, settings: resolved });
      this.settleEditors();
      chat.live = adapter.run(chat.id, chat.settings, false, this.eventsFor(chat), named);
      this.sendTo(chat, text, false, attachments);
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
        if (alongside) this.store.parallels.join(chatId, alongside);
        this.store.chats.add({ chatId, agent, settings: resolved });
        this.settleEditors();
        this.upsert(chat, userEntry(id, text, attachments));
        this.setStatus(chat, 'thinking');
        return this.eventsFor(chat);
      },
      named,
      attachments,
    );
    if (!chat) throw new Error(`${agent} started a chat without naming it`);
    // Closed while it started.
    if (this.chats.get(chat.id) !== chat) live.close();
    else chat.live = live;
    return this.snapshot(chat);
  }

  /** Sends a message, or queues it while a turn runs. */
  send(chatId: ChatId, text: string, attachments: Attachment[] = []): void {
    const chat = this.chat(chatId);
    if (!text.trim() && !attachments.length) throw new Error('Write something, or attach something, to send');
    if (chat.status === 'idle') return this.sendTo(chat, text, true, attachments);
    chat.queued.push({ id: randomUUID(), text, ...(attachments.length ? { attachments } : {}) });
    this.dropSuggestion(chat);
    this.emitQueued(chat);
  }

  /**
   * Changes a chat's model or permission, for its running process too. Its
   * MCP servers can't change in a running process: it starts again, as soon
   * as no turn runs, continuing the chat.
   */
  async configure(chatId: ChatId, change: SettingsChange): Promise<void> {
    const chat = this.chat(chatId);
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
    if (servers) this.restartWhenIdle(chat);
  }

  /**
   * The MCP servers turned off in every chat changed: each open chat's
   * process starts again, as soon as no turn runs, continuing the chat.
   */
  mcpChanged(): void {
    for (const chat of this.chats.values()) this.restartWhenIdle(chat);
  }

  /**
   * What the subagent the chat's tool call `toolId` started did: as it went,
   * while the chat was live, or else as the agent saved it. A subagent whose
   * work didn't come live, such as one a message resumed, reads as saved,
   * where it is with its task as it came live.
   */
  async subagent(chatId: ChatId, toolId: string): Promise<SubagentRun> {
    const chat = this.chat(chatId);
    const live = chat.subagents.get(toolId);
    if (live?.entries.length) return structuredClone(live);
    const saved = chat.agent.subagent
      ? await chat.agent.subagent(chat.id, chat.settings.cwd, toolId)
      : { entries: [] };
    return live?.state ? { ...saved, state: live.state } : saved;
  }

  /**
   * Restores the files to how they were before one of your messages, starting
   * the agent's process when the chat has none. That entry's edits, and those
   * of every entry after it, are withdrawn. A chat that only reads
   * can't.
   */
  async undo(chatId: ChatId, entryId: string): Promise<void> {
    const chat = this.chat(chatId);
    if (chat.editor) throw new Error(`${this.editing(chat)}: make this the editing chat to undo`);
    if (chat.status !== 'idle') throw new Error('Stop the turn before undoing');
    const from = chat.entries.findIndex((entry) => entry.kind === 'user' && entry.id === entryId);
    if (from === -1) throw new Error('This message is not in the chat');
    if (chat.withdrawn.includes(entryId)) throw new Error('This message is already undone');
    if (chat.copied.includes(entryId))
      throw new Error("This message was copied from the chat this one was forked from, so it can't be undone");
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
   * Forks a chat after the turn one of your messages began into a variant,
   * such as "Context meter (a)", and opens it.
   */
  async fork(chatId: ChatId, entryId: string): Promise<OpenChat> {
    const chat = this.chat(chatId);
    if (!chat.agent.fork) throw new Error(`${chat.agent.info.name} can't fork`);
    if (chat.status !== 'idle') throw new Error('Stop the turn before forking');
    const title = await this.variantTitle(chat.agent, chat.title, chat.settings.cwd);
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

  /** A title with the first variant letter free in the folder: "Context meter (a)", then "(b)". */
  private async variantTitle(agent: AgentAdapter, title: string, cwd: string): Promise<string> {
    const base = title.trim().replace(/ \([a-z]\)$/, '') || 'Untitled chat';
    const taken = new Set((await agent.listChats(cwd)).map((c) => c.title));
    const letter = [...'abcdefghijklmnopqrstuvwxyz'].find((l) => !taken.has(`${base} (${l})`));
    return `${base} (${letter ?? 'z'})`;
  }

  /** Renames a chat with its agent. */
  async rename(chatId: ChatId, title: string): Promise<void> {
    const chat = this.chat(chatId);
    const named = title.trim();
    if (!named) throw new Error('A chat needs a title');
    if (!chat.agent.rename) throw new Error(`${chat.agent.info.name} can't rename chats`);
    await chat.agent.rename(chatId, chat.settings.cwd, named);
    chat.title = named;
    this.emit('agents.title', { chatId, title: named });
    this.retitled(chat);
  }

  /** Puts a mark on a chat, or takes it off. */
  pin(chatId: ChatId, mark: Mark, on: boolean): void {
    this.store.pins.set(chatId, mark, on);
    const pins = this.store.pins.of(chatId);
    const chat = this.chats.get(chatId);
    if (chat) chat.pins = pins;
    this.emit('agents.pins', { chatId, pins });
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

  /**
   * Takes one of the separate tasks the chat offered, by its place among
   * them: it goes from the chat, and what a new chat for it begins with
   * comes back. It works where the chat does, at its model, effort,
   * permission and MCP servers.
   */
  takeFollowUp(chatId: ChatId, index: number): { agent: AgentId; settings: NewChatSettings; prompt: string } {
    const chat = this.chat(chatId);
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

  /** Makes the chat the one that edits of those sent in parallel: the chat that edited only reads from now on. */
  takeOver(chatId: ChatId): void {
    const chat = this.chat(chatId);
    this.store.parallels.setEditor(this.store.parallels.groupOf(chat.id), chat.id);
    this.settleEditors();
  }

  /**
   * Closes an open chat: it's no longer open after a restart. When it
   * edited, the chat sent in parallel with it opened first after it edits from now on.
   */
  close(chatId: ChatId): void {
    this.store.chats.remove(chatId);
    this.release(chatId);
    this.settleEditors();
  }

  /** Stops every chat and spare process, for when the service stops; chats reopen when it starts again. */
  closeAll(): void {
    for (const signingIn of this.signIns.values()) signingIn.run.cancel();
    this.putAway();
    for (const adapter of this.adapters.values()) adapter.dispose?.();
  }

  /**
   * Why the open chats can't be put away now, naming those that are busy:
   * a turn runs or an approval waits in them, or a sign-in is under way.
   * Undefined when they can.
   */
  busy(): string | undefined {
    if (this.signIns.size) return 'A sign-in is under way: finish or cancel it first';
    const busy = [...this.chats.values()].filter(
      (chat) => chat.status !== 'idle' || this.hasApprovals(chat),
    );
    if (!busy.length) return undefined;
    const names = busy
      .map((chat) => (chat.title ? `"${chat.title}"` : 'an untitled chat'))
      .join(', ');
    return `Wait for ${names} to finish, or stop ${busy.length === 1 ? 'it' : 'them'}, first`;
  }

  /**
   * Stops every open chat's process and forgets the chats, but keeps their
   * chats, as when another profile is put in use: they reopen when it's
   * back. Who the agents were signed in as, and the setups and memories
   * watched, are forgotten too.
   */
  putAway(): void {
    for (const id of [...this.chats.keys()]) this.release(id);
    this.accounts.clear();
    this.setupWatcher.dispose();
    this.memoryWatcher.dispose();
  }

  /**
   * Every window hears who each agent is signed in as now, read again, and
   * the plan's limits are read for that account, as after a profile switch.
   */
  async announceAccounts(): Promise<void> {
    await Promise.all(
      [...this.adapters.values()].map(async (adapter) => {
        if (!adapter.account) return;
        await this.announceSignIn(adapter.info.id, true);
        if (adapter.usage) this.usage(adapter.info.id).catch(() => {});
      }),
    );
  }

  private release(chatId: ChatId): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    this.chats.delete(chatId);
    this.settleAll(chat);
    chat.live?.close();
    clearTimeout(chat.flushTimer);
  }

  /**
   * Gives the open chats sent one entry in parallel one chat that edits
   * (ADR-011): the one kept for them while that's open, else the one opened
   * first. The others only read; a chat sent in parallel with none open
   * edits. Each chat that changed hears so.
   */
  private settleEditors(): void {
    const order = this.store.chats.list().map((chat) => chat.chatId);
    const place = (chat: ChatState) => (order.includes(chat.id) ? order.indexOf(chat.id) : order.length);
    const groups = new Map<string, ChatState[]>();
    for (const chat of this.chats.values()) {
      const group = this.store.parallels.groupOf(chat.id);
      groups.set(group, [...(groups.get(group) ?? []), chat]);
    }
    for (const [group, chats] of groups) {
      const kept = this.store.parallels.editorOf(group);
      const editor =
        chats.find((chat) => chat.id === kept) ??
        chats.reduce((first, chat) => (place(chat) < place(first) ? chat : first));
      // Kept only for chats sent in parallel; a chat on its own edits without.
      const parallel = kept !== undefined || chats.length > 1 || group !== editor.id;
      if (parallel && editor.id !== kept) this.store.parallels.setEditor(group, editor.id);
      for (const chat of chats) {
        const by = chat === editor ? undefined : editor.id;
        if (chat.editor === by) continue;
        chat.editor = by;
        this.emit('agents.readOnly', { chatId: chat.id, readOnly: this.readOnlyOf(chat) ?? null });
      }
    }
  }

  /** The chat that edits in place of one that only reads; undefined for a chat that edits. */
  private readOnlyOf(chat: ChatState): Editor | undefined {
    return chat.editor ? { chatId: chat.editor, title: this.chats.get(chat.editor)?.title ?? '' } : undefined;
  }

  /** The chats that only read while this one edits hear its new title. */
  private retitled(chat: ChatState): void {
    for (const reader of this.chats.values()) {
      const readOnly = reader.editor === chat.id && this.readOnlyOf(reader);
      if (readOnly) this.emit('agents.readOnly', { chatId: reader.id, readOnly });
    }
  }

  /** Who edits in place of a chat that only reads, as what it's told says. */
  private editing(chat: ChatState): string {
    const title = chat.editor && this.chats.get(chat.editor)?.title;
    return `${title ? `"${title}"` : 'Another chat'} is editing this project`;
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
      pins: [],
      tags: [],
      copied: [],
      processes: 0,
      restart: false,
      subagents: new Map(),
      pendingText: new Map(),
    };
    this.chats.set(id, chat);
    return chat;
  }

  /** Who the agent is signed in as, read again when `fresh`, and any sign-in under way. */
  private async signInState(agent: AgentId, fresh: boolean): Promise<AgentSignIn> {
    const adapter = this.adapter(agent);
    if (fresh || !this.accounts.has(agent))
      this.accounts.set(agent, (await adapter.account?.()) ?? null);
    return this.knownSignIn(agent);
  }

  /** Who the agent was last read to be signed in as, and any sign-in under way. */
  private knownSignIn(agent: AgentId): AgentSignIn {
    const signingIn = this.signIns.get(agent);
    return {
      agent,
      account: this.accounts.get(agent) ?? null,
      pending: signingIn ? { email: signingIn.email, url: signingIn.url } : null,
    };
  }

  /** Every window hears of a sign-in that began, changed or ended. */
  private async announceSignIn(agent: AgentId, fresh: boolean): Promise<AgentSignIn> {
    const state = await this.signInState(agent, fresh).catch(() => this.knownSignIn(agent));
    this.emit('agents.account', state);
    return state;
  }

  /** The agent's open chats move to its new account, each as soon as no turn runs. */
  private moveToNewAccount(adapter: AgentAdapter): void {
    for (const chat of this.chats.values()) if (chat.agent === adapter) this.restartWhenIdle(chat);
  }

  /** Stops the chat's process now, or once its turn ends; its next message starts another. */
  private restartWhenIdle(chat: ChatState): void {
    if (!chat.live) return;
    if (chat.status === 'idle') this.restartProcess(chat);
    else chat.restart = true;
  }

  /** Stops the chat's process; its next message starts another, continuing the chat. */
  private restartProcess(chat: ChatState): void {
    chat.restart = false;
    chat.processes++;
    const live = chat.live;
    chat.live = undefined;
    live?.close();
  }

  private sendTo(chat: ChatState, text: string, resume: boolean, attachments: Attachment[] = []): void {
    chat.live ??= chat.agent.run(chat.id, chat.settings, resume, this.eventsFor(chat));
    const id = randomUUID();
    this.upsert(chat, userEntry(id, text, attachments));
    if (chat.status === 'idle') this.setStatus(chat, 'thinking');
    chat.live.send(text, id, attachments);
  }

  /** A turn ended: the next queued message goes. */
  private sendQueued(chat: ChatState): void {
    const next = chat.queued.shift();
    if (!next) return;
    this.emitQueued(chat);
    this.sendTo(chat, next.text, true, next.attachments);
  }

  private emitQueued(chat: ChatState): void {
    this.emit('agents.queued', { chatId: chat.id, queued: [...chat.queued] });
  }

  private eventsFor(chat: ChatState): ChatEvents {
    // Events from a process that was closed, or replaced, are dropped.
    const processes = chat.processes;
    const current = () => this.chats.get(chat.id) === chat && chat.processes === processes;
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
      subagentEntry: (toolId, update) => {
        if (!current()) return;
        const entry = structuredClone(update);
        const { entries } = this.subagentRun(chat, toolId);
        const index = entries.findIndex((existing) => existing.id === entry.id);
        entry.at ??= entries[index]?.at ?? Date.now();
        if (index === -1) entries.push(entry);
        else entries[index] = entry;
        this.emit('agents.subagentEntry', { chatId: chat.id, toolId, entry });
      },
      subagentState: (toolId, state) => {
        if (current()) this.setSubagentState(chat, toolId, state);
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
      readOnly: () =>
        chat.editor
          ? `${this.editing(chat)}, so this chat can't edit files in it. ` +
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
        this.upsert(chat, { ...began, tokens: { at: began.at ?? Date.now(), uses } });
      },
      hooks: (runs) => {
        if (current()) this.logHooks(chat, runs);
      },
      title: (title) => {
        if (!current() || title === chat.title) return;
        chat.title = title;
        this.emit('agents.title', { chatId: chat.id, title });
        this.retitled(chat);
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
        this.settleAll(chat);
        this.timeTurn(chat);
        this.setStatus(chat, 'idle');
        this.emit('agents.turnEnded', { chatId: chat.id, ...(error ? { error } : {}) });
        if (chat.restart) this.restartProcess(chat);
        this.sendQueued(chat);
      },
      closed: (error) => {
        if (!current()) return;
        chat.live = undefined;
        chat.restart = false;
        this.settleAll(chat);
        // Subagents still at work in the background end with the process.
        for (const [toolId, run] of chat.subagents)
          if (run.state === 'working') this.setSubagentState(chat, toolId, 'stopped');
        this.cancelHooks(chat);
        if (chat.status !== 'idle') {
          this.timeTurn(chat);
          this.setStatus(chat, 'idle');
          this.emit('agents.turnEnded', { chatId: chat.id, error: error ?? 'The agent stopped' });
          this.sendQueued(chat);
        }
      },
    };
  }

  /** The run of the subagent the chat's tool call `toolId` started, kept from its first word. */
  private subagentRun(chat: ChatState, toolId: string): SubagentRun {
    let run = chat.subagents.get(toolId);
    if (!run) chat.subagents.set(toolId, (run = { entries: [] }));
    return run;
  }

  private setSubagentState(chat: ChatState, toolId: string, state: SubagentState): void {
    this.subagentRun(chat, toolId).state = state;
    this.emit('agents.subagentState', { chatId: chat.id, toolId, state });
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

  /**
   * Writes each hook run on your message that began the turn it ran on: the
   * one it's already written on, else the last. One that runs between turns
   * goes with the turn before.
   */
  private logHooks(chat: ChatState, runs: readonly HookRun[]): void {
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
  private cancelHooks(chat: ChatState): void {
    for (const entry of chat.entries) {
      if (entry.kind !== 'user' || !entry.hooks?.some((run) => run.outcome === 'running')) continue;
      const hooks = entry.hooks.map((run) =>
        run.outcome === 'running' ? { ...run, outcome: 'cancelled' as const } : run,
      );
      this.upsert(chat, { ...entry, hooks });
    }
  }

  /** Writes how long the turn took on your message that began it. */
  private timeTurn(chat: ChatState): void {
    const began = chat.entries.findLast((entry) => entry.kind === 'user');
    if (began?.kind !== 'user' || began.at === undefined || began.took !== undefined) return;
    this.upsert(chat, { ...began, took: Date.now() - began.at });
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
    // A turn began: what was suggested and offered before it no longer stands.
    if (status !== 'idle') {
      this.dropSuggestion(chat);
      this.dropFollowUps(chat);
    }
  }

  private dropFollowUps(chat: ChatState): void {
    if (chat.followUps === undefined) return;
    chat.followUps = undefined;
    this.emit('agents.followUps', { chatId: chat.id, followUps: null });
  }

  private dropSuggestion(chat: ChatState): void {
    if (chat.suggestion === undefined) return;
    chat.suggestion = undefined;
    this.emit('agents.suggestion', { chatId: chat.id, suggestion: null });
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
      ...(chat.cache ? { cache: chat.cache } : {}),
      plan: chat.plan,
      withdrawn: [...chat.withdrawn],
      pins: [...chat.pins],
      tags: [...chat.tags],
      copied: [...chat.copied],
      ...(chat.suggestion !== undefined ? { suggestion: chat.suggestion } : {}),
      ...(chat.followUps ? { followUps: structuredClone(chat.followUps) } : {}),
      ...(chat.editor ? { readOnly: this.readOnlyOf(chat) } : {}),
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

function userEntry(id: string, text: string, attachments: Attachment[]): Entry {
  return { kind: 'user', id, text, ...(attachments.length ? { attachments } : {}) };
}

/** Whether two lists name the same, in any order. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name) => b.includes(name));
}
