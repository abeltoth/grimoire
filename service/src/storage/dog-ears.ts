import type { DatabaseSync } from 'node:sqlite';
import type { ChatId, DogEar } from '@grimoire/contract';

/** The dog-ears folded down on chats: which are pinned and which starred (ADR-009). */
export class DogEars {
  constructor(private readonly db: DatabaseSync) {}

  of(chatId: ChatId): DogEar[] {
    const rows = this.db
      .prepare('SELECT dog_ear FROM dog_ears WHERE chat_id = ? ORDER BY dog_ear')
      .all(chatId) as { dog_ear: DogEar }[];
    return rows.map((row) => row.dog_ear);
  }

  set(chatId: ChatId, dogEar: DogEar, folded: boolean): void {
    this.db
      .prepare(
        folded
          ? 'INSERT OR IGNORE INTO dog_ears (chat_id, dog_ear) VALUES (?, ?)'
          : 'DELETE FROM dog_ears WHERE chat_id = ? AND dog_ear = ?',
      )
      .run(chatId, dogEar);
  }
}
