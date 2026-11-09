import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentId,
  EventName,
  EventPayload,
  GrimoireSettings,
  Preset,
} from '@grimoire/contract';
import type { CommandRegistry } from '../registry';
import { activeProfile } from '../storage/app-state';
import type { SettingsStore } from './settings';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** The presets of the profile in use, as `profile` says, kept in SQLite. */
export class PresetStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  list(): Preset[] {
    const rows = this.db
      .prepare(
        'SELECT name, agent, settings, prompt FROM presets WHERE profile = ? ORDER BY position',
      )
      .all(this.profile()) as {
      name: string;
      agent: AgentId;
      settings: string;
      prompt: string | null;
    }[];
    return rows.map(({ name, agent, settings, prompt }) => ({
      name,
      agent,
      settings: JSON.parse(settings) as Preset['settings'],
      ...(prompt ? { prompt } : {}),
    }));
  }

  /**
   * Saves a preset under its name; one with the same name keeps its place
   * and takes the new name and settings, and its first entry unless one is given.
   */
  save({ name, agent, settings, prompt }: Preset): Preset[] {
    const named = this.named(name);
    this.db
      .prepare(
        `INSERT INTO presets (profile, name, agent, settings, prompt, position)
         VALUES (?1, ?2, ?3, ?4, ?5,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM presets WHERE profile = ?1))
         ON CONFLICT (profile, name) DO UPDATE SET
           name = excluded.name, agent = excluded.agent, settings = excluded.settings,
           prompt = COALESCE(excluded.prompt, presets.prompt)`,
      )
      .run(
        this.profile(),
        named,
        agent,
        JSON.stringify(settings),
        prompt === undefined ? null : prompt.trim(),
      );
    return this.list();
  }

  /** Gives a preset another name, which no other preset may have; it keeps its place. */
  rename(from: string, to: string): Preset[] {
    const named = this.named(to);
    if (!this.has(from)) throw new Error(`There's no preset called "${from}"`);
    if (named.toLowerCase() !== from.toLowerCase() && this.has(named)) {
      throw new Error(`There's a preset called "${named}" already`);
    }
    this.db
      .prepare('UPDATE presets SET name = ? WHERE profile = ? AND name = ?')
      .run(named, this.profile(), from);
    return this.list();
  }

  remove(name: string): Preset[] {
    this.db.prepare('DELETE FROM presets WHERE profile = ? AND name = ?').run(this.profile(), name);
    return this.list();
  }

  private has(name: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM presets WHERE profile = ? AND name = ?')
      .get(this.profile(), name);
  }

  private named(name: string): string {
    const named = name.trim();
    if (!named) throw new Error('A preset needs a name');
    return named;
  }
}

/**
 * New chats that begin with a preset follow it when it's renamed, and
 * begin with your last settings again once it's removed.
 */
export function registerPresets(
  registry: CommandRegistry,
  presets: PresetStore,
  settings: SettingsStore,
  emit: Emit,
): void {
  const follow = (from: string, to: GrimoireSettings['newChat']) => {
    const start = settings.get().newChat;
    if (start.from === 'preset' && start.preset.toLowerCase() === from.toLowerCase()) {
      emit('settings.changed', { settings: settings.set({ newChat: to }) });
    }
  };
  registry.register('presets.list', () => presets.list());
  registry.register('presets.save', (preset) => presets.save(preset));
  registry.register('presets.rename', ({ from, to }) => {
    const all = presets.rename(from, to);
    follow(from, { from: 'preset', preset: to.trim() });
    return all;
  });
  registry.register('presets.remove', ({ name }) => {
    const all = presets.remove(name);
    follow(name, { from: 'last-used' });
    return all;
  });
}
