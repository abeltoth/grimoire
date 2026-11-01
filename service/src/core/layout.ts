import type { DatabaseSync } from 'node:sqlite';
import type { Layout } from '@grimoire/contract';
import type { CommandRegistry } from '../registry';

const DEFAULTS: Layout = { current: null };

/** How you left the book, kept in SQLite. */
export class LayoutStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): Layout {
    const rows = this.db.prepare('SELECT key, value FROM layout').all() as {
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
      `INSERT INTO layout (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of Object.entries(change)) {
      if (key in DEFAULTS) upsert.run(key, JSON.stringify(value ?? null));
    }
  }
}

export function registerLayout(registry: CommandRegistry, layout: LayoutStore): void {
  registry.register('layout.get', () => layout.get());
  registry.register('layout.set', (change) => layout.set(change));
}
