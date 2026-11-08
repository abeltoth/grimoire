import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, ChatId, ChatSettings } from '@grimoire/contract';
import { activeProfile } from './app-state';

/** A chat open as a chapter, by session ID (ADR-009). */
export interface StoredChapter {
  chatId: ChatId;
  agent: AgentId;
  settings: ChatSettings;
}

/**
 * The chats open as chapters, in ribbon order, kept across restarts; the
 * profile in use's, as `profile` says.
 */
export class Chapters {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  list(): StoredChapter[] {
    const rows = this.db
      .prepare('SELECT chat_id, agent, settings FROM chapters WHERE profile = ? ORDER BY position')
      .all(this.profile()) as { chat_id: string; agent: string; settings: string }[];
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
        `INSERT INTO chapters (chat_id, agent, settings, profile, position)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM chapters))
         ON CONFLICT (chat_id) DO UPDATE SET settings = excluded.settings`,
      )
      .run(chatId, agent, JSON.stringify(settings), this.profile());
  }

  remove(chatId: ChatId): void {
    this.db.prepare('DELETE FROM chapters WHERE chat_id = ?').run(chatId);
  }
}
