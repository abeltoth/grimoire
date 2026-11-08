import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { CARD_COLUMNS, type Card, type CardChat, type CardColumn, type CardDraft } from '@grimoire/contract';
import { activeProfile } from '../storage/app-state';

interface CardRow {
  id: string;
  kind: Card['kind'];
  title: string;
  notes: string;
  cwd: string;
  column_id: CardColumn;
  created_at: number;
  closed_at: number | null;
  made_in_chat: string | null;
  made_in_agent: string | null;
  made_in_cwd: string | null;
}

interface ChatRow {
  card_id: string;
  chat_id: string;
  agent: string;
  cwd: string;
  at: number;
}

/**
 * The Kanban board's cards and the chats each began, kept in SQLite. Each
 * card has its place in its column; a closed card keeps its column, off the
 * board, until it's opened again. Each belongs to the profile it was made
 * in; the board is the profile in use's, as `profile` says.
 */
export class CardStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
    private readonly now: () => number = Date.now,
  ) {}

  /** Every card, on the board or closed, column by column, each column in its order. */
  list(): Card[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM cards WHERE profile = ?
         ORDER BY CASE column_id WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, position`,
      )
      .all(this.profile()) as unknown as CardRow[];
    const chats = this.db
      .prepare(
        `SELECT card_chats.* FROM card_chats JOIN cards ON cards.id = card_chats.card_id
         WHERE cards.profile = ? ORDER BY card_chats.at`,
      )
      .all(this.profile()) as unknown as ChatRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      notes: row.notes,
      cwd: row.cwd,
      column: row.column_id,
      createdAt: row.created_at,
      ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
      chats: chats
        .filter((chat) => chat.card_id === row.id)
        .map(({ chat_id, agent, cwd, at }): CardChat => ({ chatId: chat_id, agent, cwd, at })),
      ...(row.made_in_chat !== null
        ? { madeIn: { chatId: row.made_in_chat, agent: row.made_in_agent!, cwd: row.made_in_cwd! } }
        : {}),
    }));
  }

  /**
   * Saves a card's title, notes and folder; a new one goes at the foot of
   * To do, noting the chat it was added in, when an agent added it.
   */
  save(draft: CardDraft, madeIn?: Card['madeIn']): Card[] {
    const title = draft.title.trim();
    const notes = draft.notes.trim();
    const cwd = draft.cwd.trim();
    if (!title) throw new Error('A card needs a title');
    if (!cwd) throw new Error('A card needs a folder');
    if (draft.id) {
      this.known(draft.id);
      this.db
        .prepare('UPDATE cards SET title = ?, notes = ?, cwd = ? WHERE id = ?')
        .run(title, notes, cwd, draft.id);
    } else {
      this.db
        .prepare(
          `INSERT INTO cards (id, profile, kind, title, notes, cwd, column_id, position, created_at,
             made_in_chat, made_in_agent, made_in_cwd)
           VALUES (?, ?, 'task', ?, ?, ?, 'todo', ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.profile(),
          title,
          notes,
          cwd,
          this.foot('todo'),
          this.now(),
          madeIn?.chatId ?? null,
          madeIn?.agent ?? null,
          madeIn?.cwd ?? null,
        );
    }
    return this.list();
  }

  /** Moves a card into a column, before the card `before` there, or to its foot. */
  move(id: string, column: CardColumn, before?: string): Card[] {
    this.known(id);
    if (!CARD_COLUMNS.includes(column)) throw new Error(`There's no column "${column}"`);
    const order = (
      this.db
        .prepare('SELECT id FROM cards WHERE profile = ? AND column_id = ? AND id != ? ORDER BY position')
        .all(this.profile(), column, id) as { id: string }[]
    ).map((row) => row.id);
    const at = before === undefined ? -1 : order.indexOf(before);
    order.splice(at === -1 ? order.length : at, 0, id);
    const place = this.db.prepare('UPDATE cards SET column_id = ?, position = ? WHERE id = ?');
    this.db.exec('BEGIN');
    try {
      order.forEach((card, position) => place.run(column, position, card));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.list();
  }

  /** Takes a card off the board, keeping it; or puts it back, at the foot of its column. */
  close(id: string, closed: boolean): Card[] {
    const card = this.known(id);
    if (closed) {
      if (card.closed_at === null) {
        this.db.prepare('UPDATE cards SET closed_at = ? WHERE id = ?').run(this.now(), id);
      }
    } else if (card.closed_at !== null) {
      this.db
        .prepare('UPDATE cards SET closed_at = NULL, position = ? WHERE id = ?')
        .run(this.foot(card.column_id), id);
    }
    return this.list();
  }

  /** Notes a chat begun from a card; a card still to do is now in progress, at the foot of it. */
  link(id: string, chat: Omit<CardChat, 'at'>): Card[] {
    const card = this.known(id);
    this.db
      .prepare(
        `INSERT INTO card_chats (card_id, chat_id, agent, cwd, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (card_id, chat_id) DO NOTHING`,
      )
      .run(id, chat.chatId, chat.agent, chat.cwd, this.now());
    if (card.column_id === 'todo') return this.move(id, 'doing');
    return this.list();
  }

  /** The card, if it's the profile in use's. */
  private known(id: string): CardRow {
    const row = this.db
      .prepare('SELECT * FROM cards WHERE id = ? AND profile = ?')
      .get(id, this.profile()) as CardRow | undefined;
    if (!row) throw new Error('There is no such card');
    return row;
  }

  /** The place after the last card in a column. */
  private foot(column: CardColumn): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE profile = ? AND column_id = ?')
      .get(this.profile(), column) as { next: number };
    return row.next;
  }
}
