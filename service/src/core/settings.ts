import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_SETTINGS,
  type EventName,
  type EventPayload,
  type GrimoireSettings,
} from '@grimoire/contract';
import type { CommandRegistry } from '../registry';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** Whether a value is one a setting takes; anything else is left out. */
const VALID: { [K in keyof GrimoireSettings]: (value: unknown) => boolean } = {
  wording: (value) => value === 'book' || value === 'plain',
  drawings: (value) => typeof value === 'boolean',
  defaultAgent: (value) => value === null || (typeof value === 'string' && value !== ''),
  newChapter: (value) => {
    const start = value as GrimoireSettings['newChapter'] | null;
    return (
      start?.from === 'last-used' ||
      (start?.from === 'preset' && typeof start.preset === 'string' && start.preset !== '')
    );
  },
};

const known = (key: string): key is keyof GrimoireSettings => key in VALID;

/** Grimoire's settings (ADR-009), kept in SQLite; a setting never set has its default. */
export class SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): GrimoireSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const settings: GrimoireSettings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of rows) {
      const parsed = JSON.parse(value) as unknown;
      if (known(key) && VALID[key](parsed)) Object.assign(settings, { [key]: parsed });
    }
    return settings;
  }

  /** Changes the settings given; unknown ones and values a setting doesn't take are refused. */
  set(change: Partial<GrimoireSettings>): GrimoireSettings {
    for (const [key, value] of Object.entries(change)) {
      if (!known(key)) throw new Error(`There's no setting "${key}"`);
      if (!VALID[key](value)) throw new Error(`"${key}" can't be ${JSON.stringify(value)}`);
    }
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of Object.entries(change)) upsert.run(key, JSON.stringify(value));
    return this.get();
  }
}

/** Every window hears of a change, so they all show the same settings (ADR-007). */
export function registerSettings(
  registry: CommandRegistry,
  settings: SettingsStore,
  emit: Emit,
): void {
  registry.register('settings.get', () => settings.get());
  registry.register('settings.set', (change) => {
    const all = settings.set(change);
    emit('settings.changed', { settings: all });
    return all;
  });
}
