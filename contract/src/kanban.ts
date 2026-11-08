import type { AgentId, ChatId } from './agents';

/**
 * The Kanban board: your own tasks as cards in three columns, each card
 * able to begin chats in its folder (ADR-009: Grimoire's own data), and
 * your Jira issues beside them, as last synced. Each profile has a board
 * of its own.
 */

/** The board's columns, in order: to do, in progress, done. */
export const CARD_COLUMNS = ['todo', 'doing', 'done'] as const;
export type CardColumn = (typeof CARD_COLUMNS)[number];

/**
 * What a card is: a task you wrote, or an issue from Jira, with statuses of
 * its own, synced from your claude.ai Atlassian connector.
 */
export type CardKind = 'task' | 'jira';

/** What a Jira card shows of its issue, beside its summary and description. */
export interface JiraIssue {
  /** Its key, such as PROJ-123. */
  key: string;
  /** Where it opens in Jira, such as https://acme.atlassian.net/browse/PROJ-123; empty when the site isn't known. */
  url: string;
  /** Its issue type, such as Bug; empty when Jira didn't say. */
  type: string;
  /** Its priority, such as High; empty when it has none. */
  priority: string;
  /** Its status as Jira names it, such as In Review; its column comes from the status's category. */
  status: string;
}

/**
 * Where the board's Jira issues stand: `none` while there's no Atlassian
 * connector here, or none was ever reached; `needs-auth` when the
 * connector asks to be connected again on claude.ai; `failed` when the
 * last sync couldn't finish, and why.
 */
export interface JiraSync {
  status: 'none' | 'synced' | 'needs-auth' | 'failed';
  error?: string;
  /** When the issues on the board were last fetched, in ms since the epoch; missing when never. */
  syncedAt?: number;
  /** Whether a sync is running now. */
  syncing: boolean;
}

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
  /** The task, or the issue's summary. */
  title: string;
  /** More about the task, or the issue's description as plain text; empty when there's none. */
  notes: string;
  /**
   * The project folder its chats begin in; empty for a Jira card, whose
   * chats begin where new chats do.
   */
  cwd: string;
  /** Its column: for a Jira card, as its status's category says, which only Jira changes. */
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
  /** The issue, for a Jira card. */
  jira?: JiraIssue;
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
    /** Saves a task's title, notes and folder; a new one when it has no ID. Returns them all. */
    'kanban.save': { request: CardDraft; response: Card[] };
    /**
     * Moves a card into a column, before the card `before` there, or to its
     * foot when that's left out. Returns them all. A Jira card moves in Jira.
     */
    'kanban.move': {
      request: { id: string; column: CardColumn; before?: string };
      response: Card[];
    };
    /**
     * Takes a card off the board, keeping it; `closed: false` puts it back,
     * at the foot of its column. A Jira card stays closed across syncs.
     */
    'kanban.close': { request: { id: string; closed: boolean }; response: Card[] };
    /**
     * Notes a chat begun from a card, as its first message is sent. A task
     * still to do is now in progress; a Jira card stays where Jira has it.
     * Returns them all.
     */
    'kanban.link': { request: { id: string } & Omit<CardChat, 'at'>; response: Card[] };
    /** Where the board's Jira issues stand. */
    'kanban.jira': { request: Record<string, never>; response: JiraSync };
    /**
     * Fetches the Jira issues the query in the settings finds, through your
     * claude.ai Atlassian connector, in place of those on the board; one
     * running already is waited for. `ifOlderThan` skips it when the last
     * sync began less than that many ms ago. Returns where they stand.
     */
    'kanban.syncJira': { request: { ifOlderThan?: number }; response: JiraSync };
  }
}

declare module './events' {
  interface EventMap {
    /** The cards, after one was saved, moved, closed or opened again, or began a chat. */
    'kanban.changed': { cards: Card[] };
    /** Where the board's Jira issues stand, as a sync begins and ends. */
    'kanban.jira': { jira: JiraSync };
  }
}
