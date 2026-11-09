import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import type {
  AgentCapability,
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
  Mark,
  EffortLevel,
  Editor,
  Attachment,
  Entry,
  EventName,
  EventPayload,
  FollowUp,
  NewChatSettings,
  OpenChat,
  ParallelFrom,
  PlanStep,
  PromptCache,
  QueuedEntry,
  RecentFolders,
} from '@grimoire/contract';
import { fitEffort } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';
import { POPOUT } from './popout';
import { PresetList } from './preset-list';
import { Settings } from './settings';

/** An open chat: a chat, or a blank page waiting for its first message. */
export interface Chat {
  /** The chat's ID; a local one while the chat is blank. */
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
  /** What its last reply left in the prompt cache. */
  cache?: PromptCache;
  /** The agent's plan, kept up to date as it works. */
  plan: readonly PlanStep[];
  /** Your messages whose file changes were undone. */
  withdrawn: readonly string[];
  /** Its marks: pinned, starred. */
  pins: readonly Mark[];
  /** Your tags, in the order you added them. */
  tags: readonly string[];
  /** Your messages copied from the chat this one was forked from; they can't be undone. */
  copied: readonly string[];
  /** What the agent suggests you send next, while it's idle with nothing queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins. */
  followUps?: readonly FollowUp[];
  /**
   * While another chat edits its project: that chat. This one
   * can't edit files until it's made the editing chat (ADR-011).
   */
  readOnly?: Editor;
  /** Why the last turn failed, until the next message. */
  error?: string;
  /** When a blank chat was opened, in ms since the epoch. */
  begunAt?: number;
  /** The first message a blank chat has written in, from its preset. */
  prompt?: string;
}

const DEFAULT_AGENT = 'claude-code';

/** The settings a chat's settings card changes. */
export type Setting = 'agent' | 'model' | 'effort' | 'mode' | 'folder' | 'preset';

/** A pick on the settings card. The agent and folder change only on a blank chat. */
export interface SettingsPick {
  agent?: AgentId;
  model?: string;
  /** Auto, on a blank chat: the model and effort are picked for its first message. */
  autoModel?: boolean;
  effort?: EffortLevel;
  mode?: ApprovalMode;
  cwd?: string;
  /** The MCP servers turned off for this chat, by name. */
  mcpOff?: string[];
}

/** The settings a new chat takes: the ones last picked or begun with. */
interface LastUsed {
  agent: AgentId;
  settings: NewChatSettings;
}

/**
 * The open chats, as the window sees them: a mirror of the agent hub's
 * open chats (ADR-007), kept current by its events. The hub remembers
 * which chats are open, and the layout which one you were on, so the main window
 * opens where you left it.
 */
@Injectable({ providedIn: 'root' })
export class Chats {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  /** The chat this window holds as a popout; null in the main window. */
  readonly popout = inject(POPOUT);
  private readonly settings = inject(Settings);
  private readonly presets = inject(PresetList);
  private nextBlank = 1;

  readonly agents = signal<readonly AgentInfo[]>([]);
  /** Each agent's models, once it has listed them. */
  readonly models = signal<Readonly<Record<AgentId, AgentModels>>>({});
  readonly folders = signal<RecentFolders>({ home: '', recent: [] });
  /** The chat whose settings card is open, and the setting it opened on. */
  readonly settingsCard = signal<{ id: string; on: Setting } | null>(null);
  private lastUsed: LastUsed | null = null;
  /** Told when a blank chat's first message starts it. */
  private readonly begun = new Set<(blankId: string, chat: OpenChat) => void>();
  /** The blank chats that are starting, by local ID: each gives the chat's ID, unless it couldn't start. */
  private readonly starting = new Map<string, Promise<string | undefined>>();
  readonly all = signal<readonly Chat[]>([]);
  readonly currentId = signal<string | undefined>(undefined);
  readonly current = computed(() => this.all().find((chat) => chat.id === this.currentId()));
  /** The chat on the right page, beside the one you're on; none until you put one there. */
  readonly besideId = signal<string | undefined>(undefined);
  readonly beside = computed(() => this.all().find((chat) => chat.id === this.besideId()));

  constructor() {
    // A popout's window closed: its chat comes back into the main window.
    if (!this.popout) this.bridge.onPopoutClosed((chatId) => void this.comeBack(chatId));
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
    this.listen('agents.cache', ({ chatId, cache }) =>
      this.update(chatId, (c) => ({ ...c, cache })),
    );
    this.listen('agents.turnEnded', ({ chatId, error }) =>
      this.update(chatId, (c) => ({ ...c, ...(error ? { error } : {}) })),
    );
    this.listen('agents.settings', ({ chatId, settings }) =>
      this.update(chatId, (c) => ({ ...c, settings })),
    );
    this.listen('agents.plan', ({ chatId, plan }) => this.update(chatId, (c) => ({ ...c, plan })));
    this.listen('agents.pins', ({ chatId, pins }) =>
      this.update(chatId, (c) => ({ ...c, pins })),
    );
    this.listen('agents.tags', ({ chatId, tags }) => this.update(chatId, (c) => ({ ...c, tags })));
    this.listen('agents.withdrawn', ({ chatId, withdrawn }) =>
      this.update(chatId, (c) => ({ ...c, withdrawn })),
    );
    this.listen('agents.suggestion', ({ chatId, suggestion }) =>
      this.update(chatId, ({ suggestion: _, ...c }) => ({
        ...c,
        ...(suggestion !== null ? { suggestion } : {}),
      })),
    );
    this.listen('agents.followUps', ({ chatId, followUps }) =>
      this.update(chatId, ({ followUps: _, ...c }) => ({
        ...c,
        ...(followUps !== null ? { followUps } : {}),
      })),
    );
    this.listen('agents.readOnly', ({ chatId, readOnly }) =>
      this.update(chatId, ({ readOnly: _, ...c }) => ({ ...c, ...(readOnly ? { readOnly } : {}) })),
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

  /** Whether the agent does this, such as renaming its chats. */
  can(agent: AgentId | undefined, capability: AgentCapability): boolean {
    return !!this.agents().find((info) => info.id === agent)?.capabilities.includes(capability);
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

  /**
   * The model as a chat shows it; on Auto, "Auto" until its first message,
   * then with the model Auto picked: "Auto: Sonnet 5.5".
   */
  modelLabel(agent: AgentId, settings: NewChatSettings, begun: boolean): string {
    if (!settings.autoModel) return this.modelName(agent, settings.model);
    return begun ? `Auto: ${this.modelName(agent, settings.model)}` : 'Auto';
  }

  /**
   * The effort levels a chat's model takes, and the one it runs at: the
   * chat's own, else the model's default, as near as the model takes it.
   */
  effortOf(
    agent: AgentId,
    settings: { model?: string; effort?: EffortLevel },
  ): { levels: readonly EffortLevel[]; level?: EffortLevel } {
    const listed = this.models()[agent];
    const id = settings.model ?? listed?.default;
    const model = listed?.models.find((m) => m.id === id);
    const levels = model?.efforts ?? [];
    return { levels, level: fitEffort(settings.effort ?? model?.effort, levels) };
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
    if (this.currentId() !== id && this.besideId() !== id) this.turnTo(id);
    this.settingsCard.set({ id, on });
    void this.loadFolders();
  }

  closeSettings(): void {
    this.settingsCard.set(null);
  }

  /**
   * Changes a chat's settings. A blank chat takes any of them; a
   * chat that has begun only a new model or permission. A new chat
   * takes the settings picked last.
   */
  async configure(id: string, pick: SettingsPick): Promise<void> {
    const chat = this.find(id);
    if (!chat) return;
    if (chat.status === 'blank') {
      const agent = pick.agent ?? chat.agent;
      // Another agent has other models: it starts on its default, at its effort.
      const { model: _, effort: ___, ...kept } = chat.settings;
      const base = agent === chat.agent ? chat.settings : kept;
      const { agent: __, ...change } = pick;
      const settings: NewChatSettings = { ...base, ...change };
      // Auto picks the model and effort; picking a model yourself ends it.
      if (pick.autoModel) {
        delete settings.model;
        delete settings.effort;
      } else if (pick.model) delete settings.autoModel;
      this.update(id, (c) => ({ ...c, agent, settings }));
      return this.remember({ agent, settings });
    }
    const change = {
      ...(pick.model ? { model: pick.model } : {}),
      ...(pick.effort ? { effort: pick.effort } : {}),
      ...(pick.mode ? { mode: pick.mode } : {}),
      ...(pick.mcpOff ? { mcpOff: pick.mcpOff } : {}),
    };
    try {
      await this.bridge.invoke('agents.configure', { chatId: id, change });
      const { autoModel, ...kept } = chat.settings;
      this.remember({
        agent: chat.agent,
        settings: { ...kept, ...(autoModel && !change.model ? { autoModel } : {}), ...change },
      });
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Gives a blank chat these settings, as a preset holds them. */
  setUp(id: string, agent: AgentId, settings: NewChatSettings, prompt?: string): void {
    if (this.find(id)?.status !== 'blank') return;
    this.update(id, ({ prompt: _, ...c }) => ({ ...c, agent, settings, ...(prompt ? { prompt } : {}) }));
    this.remember({ agent, settings });
  }

  /**
   * What a new chat begins with, as Settings says: a preset's
   * settings, or those used last, if they were with the default agent.
   */
  startOf(): { preset?: string; agent: AgentId; settings: NewChatSettings; prompt?: string } {
    const { newChat, defaultAgent } = this.settings.all();
    if (newChat.from === 'preset') {
      const preset = this.presets.all().find((p) => p.name === newChat.preset);
      if (preset) return { ...preset, preset: preset.name };
    }
    const agent = defaultAgent ?? this.lastUsed?.agent ?? DEFAULT_AGENT;
    return this.lastUsed?.agent === agent ? this.lastUsed : { agent, settings: {} };
  }

  /**
   * Opens a blank chat, with the settings given or what new chats
   * begin with, and a preset's first message written in, and turns to it.
   * Gives the blank chat's local ID.
   */
  newChat(from?: { agent: AgentId; settings: NewChatSettings; prompt?: string }): string {
    const { id } = this.blank(from);
    this.turnTo(id);
    return id;
  }

  /**
   * Tells `handle` each time a blank chat's first message starts it:
   * its local ID, and the chat it is now. Returns a
   * function that stops telling it.
   */
  onBegun(handle: (blankId: string, chat: OpenChat) => void): () => void {
    this.begun.add(handle);
    return () => this.begun.delete(handle);
  }

  /**
   * Takes one of the separate tasks a chat's agent offered: it goes from
   * the chat, and a blank chat opens with it written in, not sent,
   * where the chat works and with its settings.
   */
  async takeFollowUp(id: string, index: number): Promise<void> {
    try {
      const start = await this.bridge.invoke('agents.takeFollowUp', { chatId: id, index });
      this.newChat(start);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Opens a blank chat on the right page, beside the one you're on. */
  newBeside(): void {
    this.setBeside(this.blank().id);
  }

  /** Puts an open chat on the right page, beside the one you're on, which stays. */
  putBeside(id: string): void {
    if (id !== this.currentId() && this.find(id)) this.setBeside(id);
  }

  /** Takes the chat off the right page; it stays open, a chat tab away. */
  setAside(): void {
    this.setBeside(undefined);
  }

  /** A blank chat, with the settings given or what new chats begin with, added to the open chats. */
  private blank(from?: { agent: AgentId; settings: NewChatSettings; prompt?: string }): Chat {
    const start = from ?? this.startOf();
    const blank: Chat = {
      id: `blank-${this.nextBlank++}`,
      agent: start.agent,
      title: '',
      settings: start.settings,
      status: 'blank',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],
      tags: [],
      copied: [],
      begunAt: Date.now(),
      ...(start.prompt ? { prompt: start.prompt } : {}),
    };
    this.all.update((all) => [...all, blank]);
    return blank;
  }

  open(id: string): void {
    this.turnTo(id);
  }

  /** Adds a chat the service began by itself, such as a scheduled chat's run, without turning to it. */
  adopt(chat: OpenChat): void {
    if (this.find(chat.id)) return;
    this.all.update((all) => [...all, fromOpenChat(chat)]);
  }

  /** Whether a chat is open in the main window. */
  has(id: string): boolean {
    return !!this.find(id);
  }

  /**
   * Closes a chat and turns to the next one, or to a blank page. The
   * chat itself stays with the agent. A popout's window closes with it.
   */
  async close(id: string): Promise<void> {
    const chat = this.find(id);
    if (!chat) return;
    this.takeOut(id);
    if (chat.status !== 'blank')
      await this.bridge.invoke('agents.close', { chatId: id }).catch(() => {});
    if (this.popout) this.bridge.window.close();
  }

  /**
   * Pops a chat that has begun out of the main window, into a window of its
   * own: a popout. It's out of the main window until that window closes.
   */
  popOut(id: string): void {
    const chat = this.find(id);
    if (!chat || chat.status === 'blank' || this.popout) return;
    this.takeOut(id);
    this.bridge.popOut(id);
  }

  /** Takes a chat out of the main window; when it was open, turns to the next one, or a blank page. */
  private takeOut(id: string): void {
    const all = this.all();
    const index = all.findIndex((chat) => chat.id === id);
    if (index === -1) return;
    const rest = all.filter((chat) => chat.id !== id);
    this.all.set(rest);
    if (this.besideId() === id) this.setAside();
    if (this.currentId() === id && !this.popout) {
      const next = rest[Math.min(index, rest.length - 1)];
      if (next) this.turnTo(next.id);
      else this.newChat();
    }
  }

  /** A popout's chat comes back into the main window, open, unless it was closed. */
  private async comeBack(id: string): Promise<void> {
    if (this.find(id)) return this.turnTo(id);
    const open = await this.bridge.invoke('agents.openChats', {}).catch(() => []);
    const chat = open?.find((c) => c.id === id);
    if (!chat || this.find(id)) return;
    this.all.update((all) => [...all, fromOpenChat(chat)]);
    this.turnTo(id);
  }

  /**
   * Sends a message, with any pictures and files; a blank chat's first
   * one starts the chat. Gives the chat's ID, unless it couldn't be sent.
   */
  async send(id: string, text: string, attachments: readonly Attachment[] = []): Promise<string | undefined> {
    // What you send while a blank chat starts goes to it once it has.
    const starting = this.starting.get(id);
    if (starting) {
      const chatId = await starting;
      return chatId === undefined ? undefined : this.send(chatId, text, attachments);
    }
    const chat = this.find(id);
    if (!chat) return undefined;
    this.update(id, ({ error: _, ...c }) => c);
    if (chat.status === 'blank') {
      const started = this.start(chat, text, attachments);
      this.starting.set(id, started);
      return started.finally(() => this.starting.delete(id));
    }
    try {
      await this.bridge.invoke('agents.send', {
        chatId: id,
        text,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      });
      return id;
    } catch (error) {
      this.fail(id, error);
      return undefined;
    }
  }

  /** Starts a blank chat with its first message. */
  private async start(
    chat: Chat,
    text: string,
    attachments: readonly Attachment[],
  ): Promise<string | undefined> {
    const { id } = chat;
    try {
      const opened = await this.bridge.invoke('agents.start', {
        agent: chat.agent,
        settings: chat.settings,
        text,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
        ...(chat.title ? { title: chat.title } : {}),
      });
      // Tags given to the blank page go to its chat.
      const tags = this.find(id)?.tags ?? [];
      this.all.update((all) => all.map((c) => (c.id === id ? fromOpenChat(opened) : c)));
      if (this.currentId() === id) this.turnTo(opened.id);
      if (this.besideId() === id) this.setBeside(opened.id);
      this.remember({ agent: chat.agent, settings: chat.settings });
      for (const handle of this.begun) handle(id, opened);
      if (tags.length) await this.tag(opened.id, tags);
      return opened.id;
    } catch (error) {
      this.fail(id, error);
      return undefined;
    }
  }

  /**
   * Sends a message to two models: to the chat, and to a chat of its
   * own on the second model, which goes on the right page. A chat that
   * has begun is copied for it; a blank one starts first, then the second
   * starts afresh.
   */
  async sendParallel(
    id: string,
    model: string,
    text: string,
    attachments: readonly Attachment[] = [],
  ): Promise<void> {
    const chat = this.find(id);
    if (!chat) return;
    let first = id;
    let from: ParallelFrom = { chatId: id };
    if (chat.status === 'blank') {
      const started = await this.send(id, text, attachments);
      if (!started) return;
      first = started;
      from = {
        agent: chat.agent,
        settings: chat.settings,
        ...(chat.title ? { title: chat.title } : {}),
        alongside: started,
      };
    } else this.update(id, ({ error: _, ...c }) => c);
    try {
      const second = await this.bridge.invoke('agents.parallel', {
        from,
        model,
        text,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      });
      this.all.update((all) => [...all.filter((c) => c.id !== second.id), fromOpenChat(second)]);
      this.setBeside(second.id);
    } catch (error) {
      this.fail(first, error);
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

  /** Opens a saved chat, or turns to it when it's open already. */
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

  /** Restores the files to how they were before one of your messages. */
  async undo(id: string, entryId: string): Promise<void> {
    this.update(id, ({ error: _, ...c }) => c);
    return this.settle(id, this.bridge.invoke('agents.undo', { chatId: id, entryId }));
  }

  /**
   * Forks the chat after the turn one of your messages began, and turns
   * to the variant; from a popout, it's popped out as one too.
   */
  async fork(id: string, entryId: string): Promise<void> {
    this.update(id, ({ error: _, ...c }) => c);
    try {
      const chat = await this.bridge.invoke('agents.fork', { chatId: id, entryId });
      if (this.popout) return this.bridge.popOut(chat.id);
      this.all.update((all) => [...all.filter((c) => c.id !== chat.id), fromOpenChat(chat)]);
      this.turnTo(chat.id);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Gives a chat a new title; a blank chat starts with it. */
  async rename(id: string, title: string): Promise<void> {
    const chat = this.find(id);
    const named = title.trim();
    if (!chat || !named || named === chat.title) return;
    this.update(id, ({ error: _, ...c }) => ({ ...c, title: named }));
    if (chat.status === 'blank') return;
    try {
      await this.bridge.invoke('agents.rename', { chatId: id, title: named });
    } catch (error) {
      this.update(id, (c) => ({ ...c, title: chat.title }));
      this.fail(id, error);
    }
  }

  /** Sets a chat's tags: trimmed, without blanks, each once whatever its case. */
  async tag(id: string, tags: readonly string[]): Promise<void> {
    const chat = this.find(id);
    if (!chat) return;
    const seen = new Set<string>();
    const kept = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
    if (kept.join('\n') === chat.tags.join('\n')) return;
    this.update(id, ({ error: _, ...c }) => ({ ...c, tags: kept }));
    if (chat.status === 'blank') return;
    try {
      await this.bridge.invoke('agents.tag', { chatId: id, tags: kept });
    } catch (error) {
      this.update(id, (c) => ({ ...c, tags: chat.tags }));
      this.fail(id, error);
    }
  }

  /** Puts a mark on a chat, or takes it off. */
  pin(id: string, mark: Mark, on: boolean): Promise<void> {
    return this.settle(id, this.bridge.invoke('agents.pin', { chatId: id, mark, on }));
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

  /**
   * Makes the chat the one that edits its project: the one that
   * did only reads from now on.
   */
  async takeOver(id: string): Promise<void> {
    this.update(id, ({ error: _, ...c }) => c);
    try {
      await this.bridge.invoke('agents.takeOver', { chatId: id });
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Approves or denies an approval; a failure shows as the chat's error. */
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

  /** Shows why a request failed as the chat's error. */
  fail(id: string, error: unknown): void {
    this.update(id, (c) => ({
      ...c,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  /** Opens the chats the hub has open, on the one you were on; else a blank page. */
  private async restore(): Promise<void> {
    if (this.popout) return this.restorePopout(this.popout);
    try {
      // A blank page begins as the settings say, so they're asked for too.
      const [chats, layout] = await Promise.all([
        this.bridge.invoke('agents.openChats', {}),
        this.bridge.invoke('layout.get', {}),
        this.settings.ready,
        this.presets.ready,
      ]);
      // The chats popped out are in windows of their own.
      const popouts = new Set((layout?.popouts ?? []).map((popout) => popout.chatId));
      this.all.set((chats ?? []).filter((chat) => !popouts.has(chat.id)).map(fromOpenChat));
      this.lastUsed = layout?.lastUsed ?? null;
      const current = layout?.current;
      const beside = layout?.beside;
      if (beside && beside !== current && this.find(beside)) this.besideId.set(beside);
      if (current && this.find(current)) return this.currentId.set(current);
    } catch {
      // The service is unreachable: start on a blank page.
    }
    this.newChat();
  }

  /** A popout's window holds its one chat; it closes when the chat isn't open. */
  private async restorePopout(id: string): Promise<void> {
    const chats = await this.bridge.invoke('agents.openChats', {}).catch(() => []);
    const chat = chats?.find((c) => c.id === id);
    if (!chat) return this.bridge.window.close();
    this.all.set([fromOpenChat(chat)]);
    this.currentId.set(id);
  }

  /**
   * Turns to a chat and remembers it, so the main window opens there next time.
   * Turning to the chat on the right page swaps the two pages.
   */
  private turnTo(id: string): void {
    if (this.settingsCard()?.id !== id) this.closeSettings();
    const was = this.currentId();
    if (id === this.besideId()) this.setBeside(was && was !== id && this.find(was) ? was : undefined);
    this.currentId.set(id);
    if (this.popout) return;
    const chat = this.find(id);
    this.bridge
      .invoke('layout.set', { current: chat && chat.status !== 'blank' ? id : null })
      .catch(() => {});
  }

  /** Puts a chat on the right page, or none, and remembers it. */
  private setBeside(id: string | undefined): void {
    if (this.settingsCard()?.id === this.besideId() && id !== this.besideId()) this.closeSettings();
    this.besideId.set(id);
    const chat = id ? this.find(id) : undefined;
    this.bridge
      .invoke('layout.set', { beside: chat && chat.status !== 'blank' ? chat.id : null })
      .catch(() => {});
  }

  /** The settings a new chat takes next; MCP servers turned off for one chat stay with it. */
  private remember({ agent, settings: { mcpOff: _, ...settings } }: LastUsed): void {
    const lastUsed = { agent, settings };
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

  private find(id: string): Chat | undefined {
    return this.all().find((chat) => chat.id === id);
  }

  private update(id: string, change: (chat: Chat) => Chat): void {
    this.all.update((all) => all.map((chat) => (chat.id === id ? change(chat) : chat)));
  }

  private listen<K extends EventName>(event: K, handle: (payload: EventPayload<K>) => void): void {
    this.bridge.on(event, handle);
  }
}

function fromOpenChat(chat: OpenChat): Chat {
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
    pins: chat.pins ?? [],
    tags: chat.tags ?? [],
    copied: chat.copied ?? [],
    ...(chat.context ? { context: chat.context } : {}),
    ...(chat.cache ? { cache: chat.cache } : {}),
    ...(chat.suggestion ? { suggestion: chat.suggestion } : {}),
    ...(chat.followUps?.length ? { followUps: chat.followUps } : {}),
    ...(chat.readOnly ? { readOnly: chat.readOnly } : {}),
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
