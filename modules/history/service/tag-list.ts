import type { DatabaseSync } from 'node:sqlite';
import { keptTags } from './tags';

/** Your tag list: the tags you mean to use, in your order, each once whatever its case. */
export class TagList {
  constructor(private readonly db: DatabaseSync) {}

  all(): string[] {
    const rows = this.db.prepare('SELECT tag FROM tag_list ORDER BY position').all() as {
      tag: string;
    }[];
    return rows.map((row) => row.tag);
  }

  /** Puts these tags in place of the list, as they're kept; gives the list kept. */
  set(tags: readonly string[]): string[] {
    const kept = keptTags(tags);
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM tag_list');
      const insert = this.db.prepare('INSERT INTO tag_list (tag, position) VALUES (?, ?)');
      kept.forEach((tag, position) => insert.run(tag, position));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return kept;
  }

  /** Puts these tags at the end of the list where it hasn't them; gives the list, or null when nothing was added. */
  add(tags: readonly string[]): string[] | null {
    const listed = this.all();
    const has = new Set(listed.map((tag) => tag.toLowerCase()));
    const fresh = keptTags(tags).filter((tag) => !has.has(tag.toLowerCase()));
    return fresh.length ? this.set([...listed, ...fresh]) : null;
  }
}
