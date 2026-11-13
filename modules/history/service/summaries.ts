import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/** The longest summary kept: a line, with room to spare. */
const MAX_SUMMARY = 500;

/** Each chat's summary: a line on what it's about. */
export class Summaries {
  constructor(private readonly db: DatabaseSync) {}

  /** Every chat's summary, by chat. */
  all(): Map<ChatId, string> {
    const rows = this.db.prepare('SELECT chat_id, summary FROM summaries').all() as {
      chat_id: ChatId;
      summary: string;
    }[];
    return new Map(rows.map((row) => [row.chat_id, row.summary]));
  }

  /** Keeps a chat's summary, trimmed and cut short; gives what's kept, blank when it's taken away. */
  set(chatId: ChatId, summary: string): string {
    const kept = summary.trim().slice(0, MAX_SUMMARY);
    if (kept) {
      this.db
        .prepare(
          `INSERT INTO summaries (chat_id, summary) VALUES (?, ?)
           ON CONFLICT (chat_id) DO UPDATE SET summary = excluded.summary`,
        )
        .run(chatId, kept);
    } else {
      this.db.prepare('DELETE FROM summaries WHERE chat_id = ?').run(chatId);
    }
    return kept;
  }
}
