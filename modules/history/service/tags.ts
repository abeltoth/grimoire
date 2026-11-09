import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/** Your tags for chats, in the order you added them (ADR-009). */
export class Tags {
  constructor(private readonly db: DatabaseSync) {}

  of(chatId: ChatId): string[] {
    const rows = this.db
      .prepare('SELECT tag FROM tags WHERE chat_id = ? ORDER BY position')
      .all(chatId) as { tag: string }[];
    return rows.map((row) => row.tag);
  }

  /** Every chat's tags, by chat. */
  all(): Map<ChatId, string[]> {
    const rows = this.db
      .prepare('SELECT chat_id, tag FROM tags ORDER BY chat_id, position')
      .all() as { chat_id: ChatId; tag: string }[];
    const all = new Map<ChatId, string[]>();
    for (const row of rows) all.set(row.chat_id, [...(all.get(row.chat_id) ?? []), row.tag]);
    return all;
  }

  set(chatId: ChatId, tags: readonly string[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM tags WHERE chat_id = ?').run(chatId);
      const insert = this.db.prepare('INSERT INTO tags (chat_id, tag, position) VALUES (?, ?, ?)');
      tags.forEach((tag, position) => insert.run(chatId, tag, position));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Tags trimmed, without blanks, and each once whatever its case. */
export function keptTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
}
