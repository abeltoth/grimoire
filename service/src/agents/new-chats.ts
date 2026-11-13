import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
  AgentId,
  Attachment,
  ChatId,
  ChatSettings,
  NewChatSettings,
  OpenChat,
  ParallelFrom,
} from '@grimoire/contract';
import type { AgentAdapter } from './adapter';
import { type ChatState, type ChatTable, type HubStore, userEntry } from './chat-table';
import type { ChatRuns } from './chat-runs';
import type { ChatUpdates } from './chat-updates';
import type { Editors } from './editors';

/** What beginning chats needs of the hub: opening a saved chat, and a chat's state for the windows. */
export interface Opening {
  open(agent: AgentId, chatId: ChatId, settings: ChatSettings): Promise<OpenChat>;
  snapshot(chat: ChatState): OpenChat;
}

/**
 * How chats begin: a new one with its first message, on the model the
 * agent picks for it when on Auto; a fork after one of your messages; and
 * one sent the same entry on a second model, which only reads while the
 * first edits.
 */
export class NewChats {
  constructor(
    private readonly table: ChatTable,
    private readonly store: HubStore,
    private readonly updates: ChatUpdates,
    private readonly editors: Editors,
    private readonly runs: ChatRuns,
    private readonly opening: Opening,
  ) {}

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
   * Sends one entry to a second model too, in a chat of its own: from a
   * chat that has begun, a copy of it, after the message goes to the chat
   * itself; from a new chat's settings, a chat begun afresh. The second
   * works in the same folder, so while the first edits, the second only
   * reads.
   */
  async parallel(
    from: ParallelFrom,
    model: string,
    text: string,
    attachments: Attachment[] = [],
  ): Promise<OpenChat> {
    if (!text.trim() && !attachments.length)
      throw new Error('Write something, or attach something, to send');
    if (!('chatId' in from)) {
      const cwd = from.settings.cwd ?? homedir();
      const named = from.title?.trim();
      const title = named
        ? await this.variantTitle(this.table.adapter(from.agent), named, cwd)
        : undefined;
      // The second model is the one asked for, not Auto's.
      const { autoModel: _, ...settings } = from.settings;
      return this.begin(
        from.agent,
        { ...settings, cwd, model },
        text,
        title,
        attachments,
        from.alongside,
      );
    }
    const chat = this.table.chat(from.chatId);
    if (!chat.agent.fork)
      throw new Error(`${chat.agent.info.name} can't copy a chat to another model`);
    if (chat.status !== 'idle')
      throw new Error('Wait for the turn to end, or stop it, to send to two models');
    const last = chat.entries.findLast((entry) => entry.kind === 'user');
    if (!last) throw new Error('This chat has nothing to copy yet');
    const title = await this.variantTitle(chat.agent, chat.title, chat.settings.cwd);
    const forkId = await chat.agent.fork(chat.id, chat.settings.cwd, last.id, title);
    // The chat goes on at once; its copy follows once it's open.
    this.runs.send(chat, text, attachments);
    const { autoModel: _, ...settings } = chat.settings;
    this.store.parallels.join(forkId, chat.id);
    const variant = await this.opening.open(chat.agent.info.id, forkId, { ...settings, model });
    // The copy's entries are copies, without the original's file checkpoints.
    this.store.copied.add(
      forkId,
      variant.entries.filter((entry) => entry.kind === 'user').map((entry) => entry.id),
    );
    const copy = this.table.chat(forkId);
    copy.copied = this.store.copied.list(forkId);
    this.runs.send(copy, text, attachments);
    return this.opening.snapshot(copy);
  }

  /**
   * Forks a chat after the turn one of your messages began into a variant,
   * such as "Context meter (a)", and opens it.
   */
  async fork(chatId: ChatId, entryId: string): Promise<OpenChat> {
    const chat = this.table.chat(chatId);
    if (!chat.agent.fork) throw new Error(`${chat.agent.info.name} can't fork`);
    if (chat.status !== 'idle') throw new Error('Stop the turn before forking');
    const title = await this.variantTitle(chat.agent, chat.title, chat.settings.cwd);
    const forkId = await chat.agent.fork(chat.id, chat.settings.cwd, entryId, title);
    const variant = await this.opening.open(chat.agent.info.id, forkId, chat.settings);
    // The fork's entries are copies, without the original's file checkpoints.
    this.store.copied.add(
      forkId,
      variant.entries.filter((entry) => entry.kind === 'user').map((entry) => entry.id),
    );
    const copied = this.store.copied.list(forkId);
    const opened = this.table.chats.get(forkId);
    if (opened) opened.copied = copied;
    return { ...variant, copied };
  }

  /**
   * A new chat's settings on Auto: the model and effort the agent picks for
   * its first message, in place of any set; the agent's defaults when it can't say.
   */
  private async autoPicked(
    agent: AgentId,
    settings: ChatSettings,
    text: string,
  ): Promise<ChatSettings> {
    const { model: _, effort: __, ...rest } = settings;
    const picked = await this.table
      .adapter(agent)
      .pickModel?.(text)
      .catch(() => undefined);
    return { ...rest, ...picked };
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
    const adapter = this.table.adapter(agent);
    if (!adapter.start) {
      const chat = this.table.track(randomUUID(), adapter, resolved, [], named ?? '');
      if (alongside) this.store.parallels.join(chat.id, alongside);
      this.store.chats.add({ chatId: chat.id, agent, settings: resolved });
      this.editors.settle();
      chat.live = adapter.run(chat.id, chat.settings, false, this.runs.events(chat), named);
      this.runs.sendTo(chat, text, false, attachments);
      return this.opening.snapshot(chat);
    }
    // The agent picks the chat's ID, on a spare process when it has one.
    let chat: ChatState | undefined;
    const id = randomUUID();
    const live = await adapter.start(
      resolved,
      text,
      id,
      (chatId) => {
        chat = this.table.track(chatId, adapter, resolved, [], named ?? '');
        if (alongside) this.store.parallels.join(chatId, alongside);
        this.store.chats.add({ chatId, agent, settings: resolved });
        this.editors.settle();
        this.updates.upsert(chat, userEntry(id, text, attachments));
        this.updates.setStatus(chat, 'thinking');
        return this.runs.events(chat);
      },
      named,
      attachments,
    );
    if (!chat) throw new Error(`${agent} started a chat without naming it`);
    // Closed while it started.
    if (this.table.chats.get(chat.id) !== chat) live.close();
    else chat.live = live;
    return this.opening.snapshot(chat);
  }

  /** A title with the first variant letter free in the folder: "Context meter (a)", then "(b)". */
  private async variantTitle(agent: AgentAdapter, title: string, cwd: string): Promise<string> {
    const base = title.trim().replace(/ \([a-z]\)$/, '') || 'Untitled chat';
    const taken = new Set((await agent.listChats(cwd)).map((c) => c.title));
    const letter = [...'abcdefghijklmnopqrstuvwxyz'].find((l) => !taken.has(`${base} (${l})`));
    return `${base} (${letter ?? 'z'})`;
  }
}
