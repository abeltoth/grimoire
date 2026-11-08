import { Injectable, computed, inject, signal } from '@angular/core';
import type { Card, CardChat, CardColumn, CardDraft } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';

/** The board's columns, in order, as they're headed. */
export const COLUMNS: readonly { column: CardColumn; label: string }[] = [
  { column: 'todo', label: 'To do' },
  { column: 'doing', label: 'In progress' },
  { column: 'done', label: 'Done' },
];

/** What a card's new chat begins with, written in: its title, and its notes under it. */
export function promptOf(card: Pick<Card, 'title' | 'notes'>): string {
  return card.notes ? `${card.title}\n\n${card.notes}` : card.title;
}

/**
 * The Kanban board, as the window sees it: a mirror of the service's
 * cards, kept current by its events. A card's new chat opens as a blank
 * chapter with the task written in; once its first message is sent, the
 * chat is noted on the card, and a card still to do is in progress.
 */
@Injectable({ providedIn: 'root' })
export class Board {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  /** The blank chapters opened from cards and not begun yet, each with its card's ID. */
  private readonly opening = new Map<string, string>();

  /** Every card, on the board or closed; undefined until the service has listed them. */
  readonly all = signal<readonly Card[] | undefined>(undefined);
  /** Why the last change failed, until the next one. */
  readonly failed = signal<string | null>(null);
  /** The cards on the board, not closed. */
  readonly open = computed(() => (this.all() ?? []).filter((card) => card.closedAt === undefined));
  /** The card on the board the chapter you're on began from, if any. */
  readonly current = computed(() => {
    const id = this.chats.currentId();
    return id ? this.open().find((card) => card.chats.some((chat) => chat.chatId === id)) : undefined;
  });

  constructor() {
    this.bridge.on('kanban.changed', ({ cards }) => this.all.set(cards));
    this.chats.onBegun((blankId, chat) => {
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
      if (cards) this.all.set(cards);
    } catch (error) {
      this.fail(error);
    }
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
   * Opens a new chapter in the card's folder with its title and notes
   * written in, not sent, and with what new chapters begin with otherwise.
   * One opened from the card before and still blank is turned to instead.
   */
  newChat(card: Card): void {
    for (const [chapter, id] of this.opening) {
      if (id !== card.id) continue;
      if (this.chats.has(chapter)) return this.chats.open(chapter);
      this.opening.delete(chapter);
    }
    const { agent, settings } = this.chats.startOf();
    const chapter = this.chats.newChapter({
      agent,
      settings: { ...settings, cwd: card.cwd },
      prompt: promptOf(card),
    });
    this.opening.set(chapter, card.id);
  }

  /** Turns to one of a card's chats, opening it again when it was closed. */
  async openChat(chat: CardChat): Promise<void> {
    if (this.chats.has(chat.chatId)) return this.chats.open(chat.chatId);
    await this.chats.openChat({
      id: chat.chatId,
      agent: chat.agent,
      title: '',
      cwd: chat.cwd,
      updatedAt: chat.at,
      dogEars: [],
      tags: [],
    });
  }

  private async change(request: () => Promise<Card[]>): Promise<boolean> {
    this.failed.set(null);
    try {
      this.all.set(await request());
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown): void {
    this.failed.set(error instanceof Error ? error.message : String(error));
  }
}
