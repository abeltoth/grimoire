import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/**
 * A list of your entries per chat, which the agent's transcript doesn't
 * record: those whose edits were undone ('withdrawn'), and those a fork
 * copied from the chat it was forked from ('copied').
 */
export class EntryIds {
  constructor(
    private readonly db: DatabaseSync,
    private readonly table: 'withdrawn' | 'copied',
  ) {}

  list(chatId: ChatId): string[] {
    const rows = this.db
      .prepare(`SELECT entry_id FROM ${this.table} WHERE chat_id = ? ORDER BY rowid`)
      .all(chatId) as { entry_id: string }[];
    return rows.map((row) => row.entry_id);
  }

  add(chatId: ChatId, entryIds: readonly string[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO ${this.table} (chat_id, entry_id) VALUES (?, ?)`,
    );
    for (const entryId of entryIds) insert.run(chatId, entryId);
  }
}
