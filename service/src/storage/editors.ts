import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';
import { activeProfile } from './app-state';

/**
 * The chat that edits each project (ADR-011), kept across restarts so the
 * same one does once the chapters reopen; the profile in use's, as
 * `profile` says.
 */
export class Editors {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  of(project: string): ChatId | undefined {
    const row = this.db
      .prepare('SELECT chat_id FROM editors WHERE profile = ? AND project = ?')
      .get(this.profile(), project) as { chat_id: ChatId } | undefined;
    return row?.chat_id;
  }

  set(project: string, chatId: ChatId): void {
    this.db
      .prepare(
        `INSERT INTO editors (profile, project, chat_id) VALUES (?, ?, ?)
         ON CONFLICT (profile, project) DO UPDATE SET chat_id = excluded.chat_id`,
      )
      .run(this.profile(), project, chatId);
  }
}
