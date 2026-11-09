import type { DatabaseSync } from 'node:sqlite';
import type { ChatId, Pin } from '@grimoire/contract';

/** The pins folded down on chats: which are pinned and which starred (ADR-009). */
export class Pins {
  constructor(private readonly db: DatabaseSync) {}

  of(chatId: ChatId): Pin[] {
    const rows = this.db
      .prepare('SELECT pin FROM pins WHERE chat_id = ? ORDER BY pin')
      .all(chatId) as { pin: Pin }[];
    return rows.map((row) => row.pin);
  }

  /** Every chat's pins, by chat. */
  all(): Map<ChatId, Pin[]> {
    const rows = this.db
      .prepare('SELECT chat_id, pin FROM pins ORDER BY pin')
      .all() as { chat_id: ChatId; pin: Pin }[];
    const all = new Map<ChatId, Pin[]>();
    for (const row of rows) all.set(row.chat_id, [...(all.get(row.chat_id) ?? []), row.pin]);
    return all;
  }

  set(chatId: ChatId, pin: Pin, folded: boolean): void {
    this.db
      .prepare(
        folded
          ? 'INSERT OR IGNORE INTO pins (chat_id, pin) VALUES (?, ?)'
          : 'DELETE FROM pins WHERE chat_id = ? AND pin = ?',
      )
      .run(chatId, pin);
  }
}
