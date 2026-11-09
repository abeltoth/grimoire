import type { DatabaseSync } from 'node:sqlite';
import type { Layout } from '@grimoire/contract';
import type { CommandRegistry } from '../registry';
import { activeProfile } from '../storage/app-state';

const DEFAULTS: Layout = { current: null, beside: null, lastUsed: null, focus: false, popouts: [] };

/** How you left the main window in the profile in use, as `profile` says, kept in SQLite. */
export class LayoutStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  get(): Layout {
    const rows = this.db
      .prepare('SELECT key, value FROM layout WHERE profile = ?')
      .all(this.profile()) as {
      key: string;
      value: string;
    }[];
    const layout: Layout = { ...DEFAULTS };
    for (const { key, value } of rows) {
      if (key in DEFAULTS) Object.assign(layout, { [key]: JSON.parse(value) as unknown });
    }
    return layout;
  }

  /** Remembers the parts that changed; unknown keys are ignored. */
  set(change: Partial<Layout>): void {
    const upsert = this.db.prepare(
      `INSERT INTO layout (profile, key, value) VALUES (?, ?, ?)
       ON CONFLICT (profile, key) DO UPDATE SET value = excluded.value`,
    );
    const profile = this.profile();
    for (const [key, value] of Object.entries(change)) {
      if (key in DEFAULTS) upsert.run(profile, key, JSON.stringify(value ?? null));
    }
  }
}

export function registerLayout(registry: CommandRegistry, layout: LayoutStore): void {
  registry.register('layout.get', () => layout.get());
  registry.register('layout.set', (change) => layout.set(change));
}
