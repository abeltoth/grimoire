import type { DatabaseSync } from 'node:sqlite';
import type { ChatId } from '@grimoire/contract';

/**
 * The chats sent one entry in parallel (ADR-011), kept across restarts:
 * each copy's group, named by the chat it was first sent alongside, and the
 * chat that edits each group, so the same one does once the chapters reopen.
 * A chat in no group is its own.
 */
export class Parallels {
  constructor(private readonly db: DatabaseSync) {}

  /** The chat's group: the one it joined, else its own ID. */
  groupOf(chatId: ChatId): string {
    const row = this.db.prepare('SELECT group_id FROM parallels WHERE chat_id = ?').get(chatId) as
      | { group_id: string }
      | undefined;
    return row?.group_id ?? chatId;
  }

  /** Puts a chat in the group of the one it was sent alongside. */
  join(chatId: ChatId, alongside: ChatId): void {
    this.db
      .prepare(
        `INSERT INTO parallels (chat_id, group_id) VALUES (?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET group_id = excluded.group_id`,
      )
      .run(chatId, this.groupOf(alongside));
  }

  editorOf(group: string): ChatId | undefined {
    const row = this.db.prepare('SELECT chat_id FROM parallel_editors WHERE group_id = ?').get(group) as
      | { chat_id: ChatId }
      | undefined;
    return row?.chat_id;
  }

  setEditor(group: string, chatId: ChatId): void {
    this.db
      .prepare(
        `INSERT INTO parallel_editors (group_id, chat_id) VALUES (?, ?)
         ON CONFLICT (group_id) DO UPDATE SET chat_id = excluded.chat_id`,
      )
      .run(group, chatId);
  }
}
