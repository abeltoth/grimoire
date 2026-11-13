import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/** When a chat was last labelled: at how many of your messages, and the title it was given then. */
export interface Labelled {
  turns: number;
  /** The title given here; undefined when none was. */
  title?: string;
}

/** What labelling chats remembers: which were labelled, and the tags it added and you took off. */
export class LabelStore {
  constructor(private readonly db: DatabaseSync) {}

  labelled(chatId: ChatId): Labelled | undefined {
    const row = this.db
      .prepare('SELECT turns, title FROM labelled WHERE chat_id = ?')
      .get(chatId) as { turns: number; title: string | null } | undefined;
    return row && { turns: row.turns, ...(row.title !== null ? { title: row.title } : {}) };
  }

  /** Every chat ever labelled. */
  all(): Set<ChatId> {
    const rows = this.db.prepare('SELECT chat_id FROM labelled').all() as { chat_id: ChatId }[];
    return new Set(rows.map((row) => row.chat_id));
  }

  /** The chat was labelled at this many of your messages; a title given replaces the one before. */
  label(chatId: ChatId, turns: number, title?: string): void {
    this.db
      .prepare(
        `INSERT INTO labelled (chat_id, turns, title) VALUES (?, ?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET
           turns = excluded.turns,
           title = COALESCE(excluded.title, labelled.title)`,
      )
      .run(chatId, turns, title ?? null);
  }

  /** These tags were added to the chat here. */
  added(chatId: ChatId, tags: readonly string[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO added_tags (chat_id, tag) VALUES (?, ?)');
    for (const tag of tags) insert.run(chatId, tag);
  }

  /** The tags you took off the chat that were added here, never to be added to it again. */
  refused(chatId: ChatId): Set<string> {
    const rows = this.db.prepare('SELECT tag FROM refused_tags WHERE chat_id = ?').all(chatId) as {
      tag: string;
    }[];
    return new Set(rows.map((row) => row.tag.toLowerCase()));
  }

  /** The chat's tags are now these: any added here that are gone, you took off. */
  tagsNow(chatId: ChatId, tags: readonly string[]): void {
    const kept = new Set(tags.map((tag) => tag.toLowerCase()));
    const added = this.db.prepare('SELECT tag FROM added_tags WHERE chat_id = ?').all(chatId) as {
      tag: string;
    }[];
    const gone = added.filter((row) => !kept.has(row.tag.toLowerCase()));
    const refuse = this.db.prepare(
      'INSERT OR IGNORE INTO refused_tags (chat_id, tag) VALUES (?, ?)',
    );
    const forget = this.db.prepare('DELETE FROM added_tags WHERE chat_id = ? AND tag = ?');
    for (const { tag } of gone) {
      refuse.run(chatId, tag);
      forget.run(chatId, tag);
    }
  }
}
