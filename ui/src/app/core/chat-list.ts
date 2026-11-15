import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import type { ChatSummary, EventName, EventPayload, OpenChat } from '@grimoire/contract';
import { AgentCatalog } from './agent-catalog';
import { GRIMOIRE_BRIDGE } from './bridge';
import { type Chat, type ChatStart, type Setting, appendText, fromOpenChat, upsert } from './chat';
import { NewChats } from './new-chats';

/**
 * The open chats, as the window sees them: a mirror of the agent hub's
 * open chats, kept current by its events. The hub remembers
 * which chats are open, and the layout which one you were on, so the window
 * opens where you left it.
 */
@Injectable({ providedIn: 'root' })
export class ChatList {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly newChats = inject(NewChats);
  private readonly catalog = inject(AgentCatalog);

  /** The chat whose settings card is open, and the setting it opened on. */
  readonly settingsCard = signal<{ id: string; on: Setting } | null>(null);
  readonly all = signal<readonly Chat[]>([]);
  readonly currentId = signal<string | undefined>(undefined);
  readonly current = computed(() => this.all().find((chat) => chat.id === this.currentId()));
  /** The chat on the right page, beside the one you're on; none until you put one there. */
  readonly besideId = signal<string | undefined>(undefined);
  readonly beside = computed(() => this.all().find((chat) => chat.id === this.besideId()));

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
    this.listen('agents.outdated', ({ chatId, outdated }) =>
      this.update(chatId, ({ outdated: _, ...c }) => ({ ...c, ...(outdated ? { outdated } : {}) })),
    );
    inject(PendingTasks).run(() => this.restore());
  }

  openSettings(id: string, on: Setting): void {
    if (this.currentId() !== id && this.besideId() !== id) this.turnTo(id);
    this.settingsCard.set({ id, on });
    void this.catalog.loadFolders();
  }

  closeSettings(): void {
    this.settingsCard.set(null);
  }

  /**
   * Opens a blank chat, with the settings given or what new chats
   * begin with, and a preset's first message written in, and turns to it.
   * Gives the blank chat's local ID.
   */
  newChat(from?: ChatStart): string {
    const { id } = this.blank(from);
    this.turnTo(id);
    return id;
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

  open(id: string): void {
    this.turnTo(id);
  }

  /** Adds a chat the service began by itself, such as a scheduled chat's run, without turning to it. */
  adopt(chat: OpenChat): void {
    if (this.find(chat.id)) return;
    this.all.update((all) => [...all, fromOpenChat(chat)]);
  }

  /** Whether a chat is open. */
  has(id: string): boolean {
    return !!this.find(id);
  }

  /**
   * Closes a chat and turns to the next one, or to a blank page. The
   * chat itself stays with the agent.
   */
  async close(id: string): Promise<void> {
    const chat = this.find(id);
    if (!chat) return;
    this.takeOut(id);
    if (chat.status !== 'blank')
      await this.bridge.invoke('agents.close', { chatId: id }).catch(() => {});
  }

  /** Opens a saved chat, or turns to it when it's open already. */
  async openChat(chat: ChatSummary): Promise<void> {
    if (this.find(chat.id)) return this.turnTo(chat.id);
    try {
      const open = await this.bridge.invoke('agents.open', {
        agent: chat.agent,
        chatId: chat.id,
        settings: { cwd: chat.cwd ?? this.catalog.folders().home },
      });
      this.all.update((all) => [...all.filter((c) => c.id !== open.id), fromOpenChat(open)]);
      this.turnTo(open.id);
    } catch (error) {
      const current = this.currentId();
      if (current) this.fail(current, error);
    }
  }

  /** Shows why a request failed as the chat's error. */
  fail(id: string, error: unknown): void {
    this.update(id, (c) => ({
      ...c,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  /** Puts a chat on the right page, or none, and remembers it. */
  setBeside(id: string | undefined): void {
    if (this.settingsCard()?.id === this.besideId() && id !== this.besideId()) this.closeSettings();
    this.besideId.set(id);
    const chat = id ? this.find(id) : undefined;
    this.bridge
      .invoke('layout.set', { beside: chat && chat.status !== 'blank' ? chat.id : null })
      .catch(() => {});
  }

  find(id: string): Chat | undefined {
    return this.all().find((chat) => chat.id === id);
  }

  update(id: string, change: (chat: Chat) => Chat): void {
    this.all.update((all) => all.map((chat) => (chat.id === id ? change(chat) : chat)));
  }

  /** A blank chat, with the settings given or what new chats begin with, added to the open chats. */
  private blank(from?: ChatStart): Chat {
    const blank = this.newChats.blank(from);
    this.all.update((all) => [...all, blank]);
    return blank;
  }

  /** Takes a chat out of the open chats; when it was open, turns to the next one, or a blank page. */
  private takeOut(id: string): void {
    const all = this.all();
    const index = all.findIndex((chat) => chat.id === id);
    if (index === -1) return;
    const rest = all.filter((chat) => chat.id !== id);
    this.all.set(rest);
    if (this.besideId() === id) this.setAside();
    if (this.currentId() === id) {
      const next = rest[Math.min(index, rest.length - 1)];
      if (next) this.turnTo(next.id);
      else this.newChat();
    }
  }

  /** Opens the chats the hub has open, on the one you were on; else a blank page. */
  private async restore(): Promise<void> {
    try {
      // A blank page begins as the settings say, so they're asked for too.
      const [chats, layout] = await Promise.all([
        this.bridge.invoke('agents.openChats', {}),
        this.bridge.invoke('layout.get', {}),
        this.newChats.ready(),
      ]);
      this.all.set((chats ?? []).map(fromOpenChat));
      this.newChats.restored(layout?.lastUsed ?? null);
      const current = layout?.current;
      const beside = layout?.beside;
      if (beside && beside !== current && this.find(beside)) this.besideId.set(beside);
      if (current && this.find(current)) return this.currentId.set(current);
    } catch {
      // The service is unreachable: start on a blank page.
    }
    this.newChat();
  }

  /**
   * Turns to a chat and remembers it, so the window opens there next time.
   * Turning to the chat on the right page swaps the two pages.
   */
  private turnTo(id: string): void {
    if (this.settingsCard()?.id !== id) this.closeSettings();
    const was = this.currentId();
    if (id === this.besideId())
      this.setBeside(was && was !== id && this.find(was) ? was : undefined);
    this.currentId.set(id);
    const chat = this.find(id);
    this.bridge
      .invoke('layout.set', { current: chat && chat.status !== 'blank' ? id : null })
      .catch(() => {});
  }

  private listen<K extends EventName>(event: K, handle: (payload: EventPayload<K>) => void): void {
    this.bridge.on(event, handle);
  }
}
