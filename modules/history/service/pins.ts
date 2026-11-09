import type { DatabaseSync } from 'node:sqlite';
import type { ChatId, Mark } from '@grimoire/contract';

/** The marks on chats: which are pinned and which starred (ADR-009). */
export class Pins {
  constructor(private readonly db: DatabaseSync) {}

  of(chatId: ChatId): Mark[] {
    const rows = this.db
      .prepare('SELECT pin FROM pins WHERE chat_id = ? ORDER BY pin')
      .all(chatId) as { pin: Mark }[];
    return rows.map((row) => row.pin);
  }

  /** Every chat's marks, by chat. */
  all(): Map<ChatId, Mark[]> {
    const rows = this.db
      .prepare('SELECT chat_id, pin FROM pins ORDER BY pin')
      .all() as { chat_id: ChatId; pin: Mark }[];
    const all = new Map<ChatId, Mark[]>();
    for (const row of rows) all.set(row.chat_id, [...(all.get(row.chat_id) ?? []), row.pin]);
    return all;
  }

  set(chatId: ChatId, mark: Mark, on: boolean): void {
    this.db
      .prepare(
        on
          ? 'INSERT OR IGNORE INTO pins (chat_id, pin) VALUES (?, ?)'
          : 'DELETE FROM pins WHERE chat_id = ? AND pin = ?',
      )
      .run(chatId, mark);
  }
}
