import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, Preset } from '@grimoire/contract';
import type { CommandRegistry } from '../registry';

/** The presets, kept in SQLite. */
export class PresetStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): Preset[] {
    const rows = this.db
      .prepare('SELECT name, agent, settings FROM presets ORDER BY position')
      .all() as { name: string; agent: AgentId; settings: string }[];
    return rows.map(({ name, agent, settings }) => ({
      name,
      agent,
      settings: JSON.parse(settings) as Preset['settings'],
    }));
  }

  /** Saves a preset under its name; one with the same name keeps its place and takes the new name and settings. */
  save({ name, agent, settings }: Preset): Preset[] {
    const named = name.trim();
    if (!named) throw new Error('A preset needs a name');
    this.db
      .prepare(
        `INSERT INTO presets (name, agent, settings, position)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM presets))
         ON CONFLICT (name) DO UPDATE SET
           name = excluded.name, agent = excluded.agent, settings = excluded.settings`,
      )
      .run(named, agent, JSON.stringify(settings));
    return this.list();
  }
}

export function registerPresets(registry: CommandRegistry, presets: PresetStore): void {
  registry.register('presets.list', () => presets.list());
  registry.register('presets.save', (preset) => presets.save(preset));
}
