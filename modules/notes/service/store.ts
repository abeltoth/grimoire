import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Note, NoteChat, NoteDraft } from '@grimoire/contract';
import { activeProfile } from '@grimoire/service/core/app-state';

interface NoteRow {
  id: string;
  text: string;
  pinned: number;
  remind_at: number | null;
  done_at: number | null;
  created_at: number;
  made_in_chat: string | null;
  made_in_agent: string | null;
  made_in_cwd: string | null;
}

/**
 * The notes, kept in SQLite. Each belongs to the profile it was made in;
 * the notes listed are the profile in use's, as `profile` says. A note is
 * due once its reminder's time has come, until it's done.
 */
export class NoteStore {
  constructor(
    private readonly db: DatabaseSync,
    readonly profile: () => string = () => activeProfile(db),
    private readonly now: () => number = Date.now,
  ) {}

  /** Every note, done ones too, newest first. */
  list(): Note[] {
    const now = this.now();
    const rows = this.db
      .prepare('SELECT * FROM notes WHERE profile = ? ORDER BY created_at DESC, rowid DESC')
      .all(this.profile()) as unknown as NoteRow[];
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      pinned: row.pinned === 1,
      ...(row.remind_at !== null ? { remindAt: row.remind_at } : {}),
      due: row.remind_at !== null && row.remind_at <= now && row.done_at === null,
      ...(row.done_at !== null ? { doneAt: row.done_at } : {}),
      ...(row.made_in_chat !== null
        ? { madeIn: { chatId: row.made_in_chat, agent: row.made_in_agent!, cwd: row.made_in_cwd! } }
        : {}),
    }));
  }

  /** Saves a note's text, pin and reminder; a new one notes the chat it was made in, when an agent made it. */
  save(draft: NoteDraft, madeIn?: NoteChat): Note[] {
    const text = draft.text.trim();
    if (!text) throw new Error('A note needs some text');
    const remindAt = draft.remindAt ?? null;
    if (remindAt !== null && !Number.isFinite(remindAt))
      throw new Error('That reminder time isn’t a time');
    if (draft.id) {
      this.known(draft.id);
      this.db
        .prepare('UPDATE notes SET text = ?, pinned = ?, remind_at = ? WHERE id = ?')
        .run(text, draft.pinned ? 1 : 0, remindAt, draft.id);
    } else {
      this.db
        .prepare(
          `INSERT INTO notes (id, profile, text, pinned, remind_at, created_at,
             made_in_chat, made_in_agent, made_in_cwd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.profile(),
          text,
          draft.pinned ? 1 : 0,
          remindAt,
          this.now(),
          madeIn?.chatId ?? null,
          madeIn?.agent ?? null,
          madeIn?.cwd ?? null,
        );
    }
    return this.list();
  }

  /** Marks a note done, or not done again; its reminder stays, but isn't due while it's done. */
  done(id: string, done: boolean): Note[] {
    const note = this.known(id);
    if (done && note.done_at === null) {
      this.db.prepare('UPDATE notes SET done_at = ? WHERE id = ?').run(this.now(), id);
    } else if (!done && note.done_at !== null) {
      this.db.prepare('UPDATE notes SET done_at = NULL WHERE id = ?').run(id);
    }
    return this.list();
  }

  remove(id: string): Note[] {
    this.known(id);
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return this.list();
  }

  /** Deletes a profile's notes. */
  removeProfile(profile: string): void {
    this.db.prepare('DELETE FROM notes WHERE profile = ?').run(profile);
  }

  /** The note, if it's the profile in use's. */
  private known(id: string): NoteRow {
    const row = this.db
      .prepare('SELECT * FROM notes WHERE id = ? AND profile = ?')
      .get(id, this.profile()) as NoteRow | undefined;
    if (!row) throw new Error('There is no such note');
    return row;
  }
}
