import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, ChatId, ChatSettings } from '@grimoire/contract';

/** A chat open as a chapter, by session ID (ADR-009). */
export interface StoredChapter {
  chatId: ChatId;
  agent: AgentId;
  settings: ChatSettings;
}

/** The chats open as chapters, in ribbon order, kept across restarts. */
export class Chapters {
  constructor(private readonly db: DatabaseSync) {}

  list(): StoredChapter[] {
    const rows = this.db
      .prepare('SELECT chat_id, agent, settings FROM chapters ORDER BY position')
      .all() as { chat_id: string; agent: string; settings: string }[];
    return rows.map((row) => ({
      chatId: row.chat_id,
      agent: row.agent,
      settings: JSON.parse(row.settings) as ChatSettings,
    }));
  }

  /** Adds a chapter at the end, or updates its settings where it is. */
  add({ chatId, agent, settings }: StoredChapter): void {
    this.db
      .prepare(
        `INSERT INTO chapters (chat_id, agent, settings, position)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM chapters))
         ON CONFLICT (chat_id) DO UPDATE SET settings = excluded.settings`,
      )
      .run(chatId, agent, JSON.stringify(settings));
  }

  remove(chatId: ChatId): void {
    this.db.prepare('DELETE FROM chapters WHERE chat_id = ?').run(chatId);
  }
}
