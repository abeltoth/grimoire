import type { DatabaseSync } from 'node:sqlite';
import type { BrowserTabs } from '@grimoire/contract';
import { activeProfile } from '@grimoire/service/core/app-state';

interface TabRow {
  url: string;
  title: string;
  shown: number;
}

/** The browser's tabs, kept in SQLite for each profile; those read and saved are the profile in use's. */
export class BrowserTabStore {
  constructor(
    private readonly db: DatabaseSync,
    readonly profile: () => string = () => activeProfile(db),
  ) {}

  tabs(): BrowserTabs {
    const rows = this.db
      .prepare('SELECT url, title, shown FROM browser_tabs WHERE profile = ? ORDER BY position')
      .all(this.profile()) as unknown as TabRow[];
    return {
      tabs: rows.map(({ url, title }) => ({ url, title })),
      shown: Math.max(
        0,
        rows.findIndex((row) => row.shown === 1),
      ),
    };
  }

  save({ tabs, shown }: BrowserTabs): void {
    const profile = this.profile();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM browser_tabs WHERE profile = ?').run(profile);
      const insert = this.db.prepare(
        'INSERT INTO browser_tabs (profile, position, url, title, shown) VALUES (?, ?, ?, ?, ?)',
      );
      tabs.forEach((tab, position) =>
        insert.run(
          profile,
          position,
          String(tab.url),
          String(tab.title),
          position === shown ? 1 : 0,
        ),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Deletes a profile's tabs. */
  removeProfile(profile: string): void {
    this.db.prepare('DELETE FROM browser_tabs WHERE profile = ?').run(profile);
  }
}
