import type { AgentId, ChatId } from './agents';

/**
 * The Kanban board: your own tasks as cards in three columns, each card
 * able to begin chats in its folder (ADR-009: Grimoire's own data). Each
 * profile has a board of its own.
 */

/** The board's columns, in order: to do, in progress, done. */
export const CARD_COLUMNS = ['todo', 'doing', 'done'] as const;
export type CardColumn = (typeof CARD_COLUMNS)[number];

/**
 * What a card is: a task you wrote. Other kinds, such as an issue from
 * another tracker with statuses of its own, can join with a look of their own.
 */
export type CardKind = 'task';

/** A chat begun from a card, as it was begun: to open it again. */
export interface CardChat {
  chatId: ChatId;
  agent: AgentId;
  /** The folder the chat works in. */
  cwd: string;
  /** When it began, in ms since the epoch. */
  at: number;
}

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  /** More about the task; empty when there's none. */
  notes: string;
  /** The project folder its chats begin in. */
  cwd: string;
  column: CardColumn;
  /** When it was made, in ms since the epoch. */
  createdAt: number;
  /**
   * When it was closed: it's off the board, but kept, and can be opened
   * again. Missing while it's on the board.
   */
  closedAt?: number;
  /** The chats begun from it, oldest first. */
  chats: CardChat[];
  /**
   * The chat whose agent added it to the board, when one did: to open it
   * again. It isn't among the chats begun from it.
   */
  madeIn?: Omit<CardChat, 'at'>;
}

/** A card as you write it: a new one has no ID yet, and goes at the foot of To do. */
export interface CardDraft {
  id?: string;
  title: string;
  notes: string;
  cwd: string;
}

declare module './commands' {
  interface CommandMap {
    /** Every card, on the board or closed, column by column, each column in its order. */
    'kanban.list': { request: Record<string, never>; response: Card[] };
    /** Saves a card's title, notes and folder; a new one when it has no ID. Returns them all. */
    'kanban.save': { request: CardDraft; response: Card[] };
    /**
     * Moves a card into a column, before the card `before` there, or to its
     * foot when that's left out. Returns them all.
     */
    'kanban.move': {
      request: { id: string; column: CardColumn; before?: string };
      response: Card[];
    };
    /** Takes a card off the board, keeping it; `closed: false` puts it back, at the foot of its column. */
    'kanban.close': { request: { id: string; closed: boolean }; response: Card[] };
    /**
     * Notes a chat begun from a card, as its first message is sent. A card
     * still to do is now in progress. Returns them all.
     */
    'kanban.link': { request: { id: string } & Omit<CardChat, 'at'>; response: Card[] };
  }
}

declare module './events' {
  interface EventMap {
    /** The cards, after one was saved, moved, closed or opened again, or began a chat. */
    'kanban.changed': { cards: Card[] };
  }
}
