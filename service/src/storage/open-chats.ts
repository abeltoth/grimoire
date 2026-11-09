import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, ChatId, ChatSettings } from '@grimoire/contract';
import { activeProfile } from './app-state';

/** An open chat, by session ID (ADR-009). */
export interface StoredOpenChat {
  chatId: ChatId;
  agent: AgentId;
  settings: ChatSettings;
}

/**
 * The open chats, in chat tab order, kept across restarts; the
 * profile in use's, as `profile` says.
 */
export class OpenChats {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  list(): StoredOpenChat[] {
    const rows = this.db
      .prepare(
        'SELECT chat_id, agent, settings FROM open_chats WHERE profile = ? ORDER BY position',
      )
      .all(this.profile()) as { chat_id: string; agent: string; settings: string }[];
    return rows.map((row) => ({
      chatId: row.chat_id,
      agent: row.agent,
      settings: JSON.parse(row.settings) as ChatSettings,
    }));
  }

  /** Adds a chat at the end, or updates its settings where it is. */
  add({ chatId, agent, settings }: StoredOpenChat): void {
    this.db
      .prepare(
        `INSERT INTO open_chats (chat_id, agent, settings, profile, position)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM open_chats))
         ON CONFLICT (chat_id) DO UPDATE SET settings = excluded.settings`,
      )
      .run(chatId, agent, JSON.stringify(settings), this.profile());
  }

  remove(chatId: ChatId): void {
    this.db.prepare('DELETE FROM open_chats WHERE chat_id = ?').run(chatId);
  }
}
