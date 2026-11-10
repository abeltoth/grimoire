import { Injectable, inject } from '@angular/core';
import type {
  AgentId,
  Answer,
  ApprovalDecision,
  Attachment,
  NewChatSettings,
  ParallelFrom,
  QueuedEntry,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';
import { type Chat, type SettingsPick, fromOpenChat } from './chat';
import { ChatList } from './chat-list';
import { NewChats } from './new-chats';

/**
 * What you do in an open chat, through the service: send, stop, undo,
 * fork, rename, answer and change its settings. A request that fails
 * shows as the chat's error.
 */
@Injectable({ providedIn: 'root' })
export class ChatActions {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly newChats = inject(NewChats);
  /** The blank chats that are starting, by local ID: each gives the chat's ID, unless it couldn't start. */
  private readonly starting = new Map<string, Promise<string | undefined>>();

  /**
   * Changes a chat's settings. A blank chat takes any of them; a
   * chat that has begun only a new model or permission. A new chat
   * takes the settings picked last.
   */
  async configure(id: string, pick: SettingsPick): Promise<void> {
    const chat = this.list.find(id);
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
      this.list.update(id, (c) => ({ ...c, agent, settings }));
      return this.newChats.remember({ agent, settings });
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
      this.newChats.remember({
        agent: chat.agent,
        settings: { ...kept, ...(autoModel && !change.model ? { autoModel } : {}), ...change },
      });
    } catch (error) {
      this.list.fail(id, error);
    }
  }

  /** Gives a blank chat these settings, as a preset holds them. */
  setUp(id: string, agent: AgentId, settings: NewChatSettings, prompt?: string): void {
    if (this.list.find(id)?.status !== 'blank') return;
    this.list.update(id, ({ prompt: _, ...c }) => ({
      ...c,
      agent,
      settings,
      ...(prompt ? { prompt } : {}),
    }));
    this.newChats.remember({ agent, settings });
  }

  /**
   * Takes one of the separate tasks a chat's agent offered: it goes from
   * the chat, and a blank chat opens with it written in, not sent,
   * where the chat works and with its settings.
   */
  async takeFollowUp(id: string, index: number): Promise<void> {
    try {
      const start = await this.bridge.invoke('agents.takeFollowUp', { chatId: id, index });
      this.list.newChat(start);
    } catch (error) {
      this.list.fail(id, error);
    }
  }

  /**
   * Sends a message, with any pictures and files; a blank chat's first
   * one starts the chat. Gives the chat's ID, unless it couldn't be sent.
   */
  async send(
    id: string,
    text: string,
    attachments: readonly Attachment[] = [],
  ): Promise<string | undefined> {
    // What you send while a blank chat starts goes to it once it has.
    const starting = this.starting.get(id);
    if (starting) {
      const chatId = await starting;
      return chatId === undefined ? undefined : this.send(chatId, text, attachments);
    }
    const chat = this.list.find(id);
    if (!chat) return undefined;
    this.list.update(id, ({ error: _, ...c }) => c);
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
      this.list.fail(id, error);
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
    const chat = this.list.find(id);
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
    } else this.list.update(id, ({ error: _, ...c }) => c);
    try {
      const second = await this.bridge.invoke('agents.parallel', {
        from,
        model,
        text,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      });
      this.list.all.update((all) => [
        ...all.filter((c) => c.id !== second.id),
        fromOpenChat(second),
      ]);
      this.list.setBeside(second.id);
    } catch (error) {
      this.list.fail(first, error);
    }
  }

  /** Stops the running turn; the queued messages come back, unsent. */
  async interrupt(id: string): Promise<readonly QueuedEntry[]> {
    try {
      return (await this.bridge.invoke('agents.interrupt', { chatId: id })) ?? [];
    } catch (error) {
      this.list.fail(id, error);
      return [];
    }
  }

  /** Restores the files to how they were before one of your messages. */
  async undo(id: string, entryId: string): Promise<void> {
    this.list.update(id, ({ error: _, ...c }) => c);
    return this.settle(id, this.bridge.invoke('agents.undo', { chatId: id, entryId }));
  }

  /**
   * Forks the chat after the turn one of your messages began, and turns
   * to the variant; from a popout, it's popped out as one too.
   */
  async fork(id: string, entryId: string): Promise<void> {
    this.list.update(id, ({ error: _, ...c }) => c);
    try {
      const chat = await this.bridge.invoke('agents.fork', { chatId: id, entryId });
      if (this.list.popout) return this.bridge.popOut(chat.id);
      this.list.all.update((all) => [...all.filter((c) => c.id !== chat.id), fromOpenChat(chat)]);
      this.list.open(chat.id);
    } catch (error) {
      this.list.fail(id, error);
    }
  }

  /** Gives a chat a new title; a blank chat starts with it. */
  async rename(id: string, title: string): Promise<void> {
    const chat = this.list.find(id);
    const named = title.trim();
    if (!chat || !named || named === chat.title) return;
    this.list.update(id, ({ error: _, ...c }) => ({ ...c, title: named }));
    if (chat.status === 'blank') return;
    try {
      await this.bridge.invoke('agents.rename', { chatId: id, title: named });
    } catch (error) {
      this.list.update(id, (c) => ({ ...c, title: chat.title }));
      this.list.fail(id, error);
    }
  }

  /** Takes a message out of the queue; false when it had already gone. */
  async unqueue(id: string, entryId: string): Promise<boolean> {
    try {
      return await this.bridge.invoke('agents.unqueue', { chatId: id, id: entryId });
    } catch (error) {
      this.list.fail(id, error);
      return false;
    }
  }

  /**
   * Makes the chat the one that edits its project: the one that
   * did only reads from now on.
   */
  async takeOver(id: string): Promise<void> {
    this.list.update(id, ({ error: _, ...c }) => c);
    try {
      await this.bridge.invoke('agents.takeOver', { chatId: id });
    } catch (error) {
      this.list.fail(id, error);
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
      this.list.all.update((all) => all.map((c) => (c.id === id ? fromOpenChat(opened) : c)));
      if (this.list.currentId() === id) this.list.open(opened.id);
      if (this.list.besideId() === id) this.list.setBeside(opened.id);
      this.newChats.remember({ agent: chat.agent, settings: chat.settings });
      this.newChats.began(id, opened);
      return opened.id;
    } catch (error) {
      this.list.fail(id, error);
      return undefined;
    }
  }

  private async settle(id: string, request: Promise<void>): Promise<void> {
    try {
      await request;
    } catch (error) {
      this.list.fail(id, error);
    }
  }
}
