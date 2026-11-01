import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/**
 * Your entries whose file changes were undone, per chat. The agent's
 * transcript doesn't record undos, so their edits stay marked as withdrawn
 * only through this.
 */
export class Withdrawn {
  constructor(private readonly db: DatabaseSync) {}

  list(chatId: ChatId): string[] {
    const rows = this.db
      .prepare('SELECT entry_id FROM withdrawn WHERE chat_id = ? ORDER BY rowid')
      .all(chatId) as { entry_id: string }[];
    return rows.map((row) => row.entry_id);
  }

  add(chatId: ChatId, entryIds: readonly string[]): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO withdrawn (chat_id, entry_id) VALUES (?, ?)',
    );
    for (const entryId of entryIds) insert.run(chatId, entryId);
  }
}
