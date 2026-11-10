import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CARD_COLUMNS,
  type Card,
  type CardChat,
  type CardColumn,
  type CardDraft,
  type JiraSync,
  type JiraTransition,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { NewChats } from '@ui/app/core/new-chats';

/** The board's columns, in order, as they're headed. */
export const COLUMNS: readonly { column: CardColumn; label: string }[] = [
  { column: 'todo', label: 'To do' },
  { column: 'doing', label: 'In progress' },
  { column: 'done', label: 'Done' },
];

/**
 * What a card's new chat begins with, written in: its title, after its
 * issue's key for a Jira card, and its notes under it.
 */
export function promptOf(card: Pick<Card, 'title' | 'notes' | 'jira'>): string {
  const title = card.jira ? `${card.jira.key}: ${card.title}` : card.title;
  return card.notes ? `${title}\n\n${card.notes}` : title;
}

/**
 * The Kanban board, as the window sees it: a mirror of the service's
 * cards, kept current by its events. A card's new chat opens as a blank
 * chat with the task written in; once its first message is sent, the
 * chat is noted on the card, and a task still to do is in progress. Your
 * Jira issues are cards too, synced from Jira when you ask, and moved in
 * Jira: a card moved shows where it's going at once, and goes back if
 * Jira refuses, saying why.
 */
@Injectable({ providedIn: 'root' })
export class Board {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly newChats = inject(NewChats);
  /** The blank chats opened from cards and not begun yet, each with its card's ID. */
  private readonly opening = new Map<string, string>();

  /** Every card as the service listed it last. */
  private readonly listed = signal<readonly Card[] | undefined>(undefined);
  /**
   * The Jira cards being moved in Jira, by ID, each shown where it's
   * going meanwhile: the column, and the status once it's picked.
   */
  private readonly held = signal<ReadonlyMap<string, { column: CardColumn; status?: string }>>(
    new Map(),
  );

  /**
   * Every card, on the board or closed, a Jira card being moved where it's
   * going, at its column's foot; undefined until the service has listed them.
   */
  readonly all = computed(() => {
    const cards = this.listed();
    const held = this.held();
    if (!cards || !held.size) return cards;
    const shifted = new Set<string>();
    const shown = cards.map((card) => {
      const to = held.get(card.id);
      if (!to || !card.jira) return card;
      if (to.column !== card.column) shifted.add(card.id);
      return {
        ...card,
        column: to.column,
        jira: { ...card.jira, status: to.status ?? card.jira.status },
      };
    });
    return CARD_COLUMNS.flatMap((column) => [
      ...shown.filter((card) => card.column === column && !shifted.has(card.id)),
      ...shown.filter((card) => card.column === column && shifted.has(card.id)),
    ]);
  });
  /** Why the last change failed, until the next one. */
  readonly failed = signal<string | null>(null);
  /**
   * What came of moving a Jira card that didn't move, on that card, until
   * the next move: why, and whether to offer to open it in Jira.
   */
  readonly jiraNote = signal<{ card: string; text: string; openInJira: boolean } | null>(null);
  /** Where the board's Jira issues stand; undefined until the service has said. */
  readonly jira = signal<JiraSync | undefined>(undefined);
  /** The cards on the board, not closed. */
  readonly open = computed(() => (this.all() ?? []).filter((card) => card.closedAt === undefined));
  /** The card on the board the chat you're on began from, if any. */
  readonly current = computed(() => {
    const id = this.list.currentId();
    return id
      ? this.open().find((card) => card.chats.some((chat) => chat.chatId === id))
      : undefined;
  });

  constructor() {
    this.bridge.on('kanban.changed', ({ cards }) => this.listed.set(cards));
    this.bridge.on('kanban.jira', ({ jira }) => this.jira.set(jira));
    this.newChats.onBegun((blankId, chat) => {
      const id = this.opening.get(blankId);
      if (!id) return;
      this.opening.delete(blankId);
      const link = { id, chatId: chat.id, agent: chat.agent, cwd: chat.settings.cwd };
      void this.change(() => this.bridge.invoke('kanban.link', link));
    });
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const cards = await this.bridge.invoke('kanban.list', {});
      if (cards) this.listed.set(cards);
      const jira = await this.bridge.invoke('kanban.jira', {});
      if (jira) this.jira.set(jira);
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Fetches your Jira issues afresh, unless the last sync began less than
   * `ifOlderThan` ms ago; the cards and where they stand come as events.
   */
  async syncJira(ifOlderThan?: number): Promise<void> {
    try {
      const jira = await this.bridge.invoke('kanban.syncJira', ifOlderThan ? { ifOlderThan } : {});
      if (jira) this.jira.set(jira);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Shows a Jira card in a column while Jira is asked how it can move there. */
  hold(id: string, column: CardColumn): void {
    this.held.update((held) => new Map([...held, [id, { column }]]));
  }

  /** Shows a Jira card held where it is again. */
  release(id: string): void {
    this.held.update((held) => new Map([...held].filter(([card]) => card !== id)));
  }

  /** Whether a Jira card's status is being changed in Jira now. */
  moving(id: string): boolean {
    return this.held().get(id)?.status !== undefined;
  }

  /**
   * The changes of status Jira allows a Jira card's issue now, only those
   * into `column` when it's given; undefined when Jira can't be asked, and
   * why shows on the card.
   */
  async transitions(id: string, column?: CardColumn): Promise<JiraTransition[] | undefined> {
    try {
      return (
        (await this.bridge.invoke('kanban.transitions', { id, ...(column ? { column } : {}) })) ??
        []
      );
    } catch (error) {
      this.jiraNote.set({ card: id, text: messageOf(error), openInJira: true });
      return undefined;
    }
  }

  /**
   * Changes a Jira card's status in Jira by the transition: the card shows
   * where it's going at once, and goes back when Jira refuses, saying why
   * on it, with an offer to open it in Jira. False then.
   */
  async transition(id: string, transition: JiraTransition): Promise<boolean> {
    this.held.update(
      (held) => new Map([...held, [id, { column: transition.column, status: transition.status }]]),
    );
    try {
      const cards = await this.bridge.invoke('kanban.transition', { id, transition });
      if (cards) this.listed.set(cards);
      return true;
    } catch (error) {
      this.jiraNote.set({ card: id, text: messageOf(error), openInJira: true });
      return false;
    } finally {
      this.release(id);
    }
  }

  /** Opens a Jira card's issue in Jira, in the browser. */
  openInJira(card: Card): void {
    if (card.jira?.url) this.bridge.openExternal(card.jira.url);
  }

  /** Saves a card; false when the service turned it away, and why shows. */
  save(draft: CardDraft): Promise<boolean> {
    return this.change(() => this.bridge.invoke('kanban.save', draft));
  }

  /** Moves a card into a column, before the card `before` there, or to its foot. */
  move(id: string, column: CardColumn, before?: string): Promise<boolean> {
    return this.change(() =>
      this.bridge.invoke('kanban.move', { id, column, ...(before ? { before } : {}) }),
    );
  }

  /** Takes a card off the board, or puts it back. */
  close(id: string, closed: boolean): Promise<boolean> {
    return this.change(() => this.bridge.invoke('kanban.close', { id, closed }));
  }

  /**
   * Opens a new chat in the card's folder with its title and notes
   * written in, not sent, and with what new chats begin with otherwise.
   * A Jira card has no folder: its chat begins in `folder`, the one the
   * board shows, or where new chats do. One opened from the card before
   * and still blank is turned to instead.
   */
  newChat(card: Card, folder?: string): void {
    for (const [chat, id] of this.opening) {
      if (id !== card.id) continue;
      if (this.list.has(chat)) return this.list.open(chat);
      this.opening.delete(chat);
    }
    const { agent, settings } = this.newChats.startOf();
    const cwd = card.cwd || folder || settings.cwd;
    const chat = this.list.newChat({
      agent,
      settings: { ...settings, ...(cwd ? { cwd } : {}) },
      prompt: promptOf(card),
    });
    this.opening.set(chat, card.id);
  }

  /** Turns to one of a card's chats, opening it again when it was closed. */
  async openChat(chat: CardChat): Promise<void> {
    if (this.list.has(chat.chatId)) return this.list.open(chat.chatId);
    await this.list.openChat({
      id: chat.chatId,
      agent: chat.agent,
      title: '',
      cwd: chat.cwd,
      updatedAt: chat.at,
    });
  }

  private async change(request: () => Promise<Card[]>): Promise<boolean> {
    this.failed.set(null);
    try {
      this.listed.set(await request());
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown): void {
    this.failed.set(messageOf(error));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
