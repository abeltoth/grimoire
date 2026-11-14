import type { DatabaseSync } from 'node:sqlite';
import type { ChatId, ContextUsage } from '@grimoire/contract';

/** A chat's context window: its size, and where the agent compacts it. */
export type ContextWindow = Omit<ContextUsage, 'used'>;

/** Each chat's context window as the agent last measured it, which its saved transcript doesn't record. */
export class ContextWindows {
  constructor(private readonly db: DatabaseSync) {}

  get(chatId: ChatId): ContextWindow | undefined {
    const row = this.db
      .prepare('SELECT context_limit, compacts_at FROM context_windows WHERE chat_id = ?')
      .get(chatId) as { context_limit: number; compacts_at: number | null } | undefined;
    if (!row) return undefined;
    return {
      limit: row.context_limit,
      ...(row.compacts_at !== null ? { compactsAt: row.compacts_at } : {}),
    };
  }

  put(chatId: ChatId, window: ContextWindow): void {
    this.db
      .prepare(
        `INSERT INTO context_windows (chat_id, context_limit, compacts_at) VALUES (?, ?, ?)
         ON CONFLICT (chat_id) DO UPDATE
         SET context_limit = excluded.context_limit, compacts_at = excluded.compacts_at`,
      )
      .run(chatId, window.limit, window.compactsAt ?? null);
  }
}
