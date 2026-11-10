import { existsSync, mkdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  type EventName,
  type EventPayload,
  PERSONAL_PROFILE,
  type Profile,
  type Profiles,
} from '@grimoire/contract';
import type { CommandRegistry } from '../registry';
import { activeProfile, setActiveProfile } from './app-state';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** The longest name a profile may have: room for it in the title bar. */
const MAX_NAME = 40;

/** What each profile keeps of its own, by table; deleting a profile clears them. */
const OWN_TABLES = ['settings', 'layout', 'presets', 'open_chats'] as const;

interface ProfileRow {
  id: string;
  name: string;
  claude_folder: string | null;
}

const fromRow = (row: ProfileRow): Profile => ({
  id: row.id,
  name: row.name,
  claudeFolder: row.claude_folder,
});

/**
 * Your profiles, kept in SQLite, and the one in use. Personal, made from
 * what Grimoire kept before profiles, leaves Claude Code in its usual
 * place; each new one gets a Claude folder of its own, where `folderOf`
 * says, made as the profile is.
 */
export class ProfileStore {
  /** `removing` deletes what the modules kept of a profile, inside its deletion's transaction. */
  constructor(
    private readonly db: DatabaseSync,
    private readonly folderOf: (id: string) => string,
    private readonly removing: (id: string) => void = () => {},
  ) {}

  list(): Profiles {
    const rows = this.db
      .prepare('SELECT id, name, claude_folder FROM profiles ORDER BY position')
      .all() as unknown as ProfileRow[];
    return { active: activeProfile(this.db), profiles: rows.map(fromRow) };
  }

  get(id: string): Profile | undefined {
    const row = this.db
      .prepare('SELECT id, name, claude_folder FROM profiles WHERE id = ?')
      .get(id) as ProfileRow | undefined;
    return row && fromRow(row);
  }

  /** The profile in use. */
  active(): Profile {
    return this.get(activeProfile(this.db)) ?? this.get(PERSONAL_PROFILE)!;
  }

  /** Makes a profile, with a Claude folder of its own, after the others. Returns them all. */
  create(name: string): Profiles {
    const named = this.named(name);
    if (this.called(named)) throw new Error(`There's a profile called "${named}" already`);
    const id = this.freeId(named);
    const folder = this.folderOf(id);
    mkdirSync(folder, { recursive: true });
    this.db
      .prepare(
        `INSERT INTO profiles (id, name, claude_folder, position)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM profiles))`,
      )
      .run(id, named, folder);
    return this.list();
  }

  /** Gives a profile another name, which no other profile may have. Returns them all. */
  rename(id: string, name: string): Profiles {
    const named = this.named(name);
    this.known(id);
    const other = this.called(named);
    if (other && other !== id) throw new Error(`There's a profile called "${named}" already`);
    this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(named, id);
    return this.list();
  }

  /**
   * Deletes a profile and what it kept of its own; its Claude folder stays
   * on disk. Personal, and the profile in use, can't be deleted. Returns
   * the profiles left.
   */
  remove(id: string): Profiles {
    const profile = this.known(id);
    if (id === PERSONAL_PROFILE) {
      throw new Error(`"${profile.name}" uses Claude Code's usual place and can't be deleted`);
    }
    if (id === activeProfile(this.db)) {
      throw new Error(`"${profile.name}" is in use; switch to another profile to delete it`);
    }
    this.db.exec('BEGIN');
    try {
      for (const table of OWN_TABLES) {
        this.db.prepare(`DELETE FROM ${table} WHERE profile = ?`).run(id);
      }
      this.removing(id);
      this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.list();
  }

  /** Makes the profile the one in use; what's open in the one before is left to the caller. */
  setActive(id: string): void {
    this.known(id);
    setActiveProfile(this.db, id);
  }

  private known(id: string): Profile {
    const profile = this.get(id);
    if (!profile) throw new Error(`There's no profile "${id}"`);
    return profile;
  }

  /** The ID of the profile with this name, whatever its case. */
  private called(name: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM profiles WHERE name = ?').get(name) as
      { id: string } | undefined;
    return row?.id;
  }

  private named(name: string): string {
    const named = name.trim();
    if (!named) throw new Error('A profile needs a name');
    if (named.length > MAX_NAME) {
      throw new Error(`A profile's name can be at most ${MAX_NAME} characters`);
    }
    return named;
  }

  /**
   * An ID from the name, for its folder: "Work" is "work", then "work-2"
   * and on when one is taken, or its folder is left from one deleted.
   */
  private freeId(name: string): string {
    const base =
      name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_NAME) || 'profile';
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!this.get(id) && !existsSync(this.folderOf(id))) return id;
    }
  }
}

/** What a switch does beyond the profiles themselves, each step in the order it's taken. */
export interface Switching {
  /** Why the open chats can't be put away now, naming them; undefined when they can. */
  busy(): string | undefined;
  /** Stops the open chats' processes and forgets them; their chats stay with their profile. */
  putAway(): void;
  /** Has the agents forget what they said, and stop their spare processes. */
  reset(): void;
  /** Points Claude Code at a Claude folder; null for its usual place. */
  useClaudeFolder(folder: string | null): void;
  /** Starts again what the core runs in the background, now in the new profile: the spare. */
  restart(): void;
  /** Tells every window what the new profile has: its settings and sign-in, and each module's state. */
  announce(): void;
}

/**
 * Puts the open chats away and makes the profile the one in use, with
 * Claude Code in its Claude folder. Refused, saying why, while a chat is
 * busy; switching to the profile in use does nothing.
 */
export function switchProfile(
  id: string,
  profiles: ProfileStore,
  steps: Switching,
  emit: Emit,
): Profiles {
  const profile = profiles.get(id);
  if (!profile) throw new Error(`There's no profile "${id}"`);
  if (id === profiles.active().id) return profiles.list();
  const busy = steps.busy();
  if (busy) throw new Error(`Can't switch to "${profile.name}" yet. ${busy}`);
  steps.putAway();
  steps.reset();
  steps.useClaudeFolder(profile.claudeFolder);
  profiles.setActive(id);
  steps.restart();
  const all = profiles.list();
  emit('profiles.changed', { profiles: all });
  steps.announce();
  return all;
}

/** Every window hears of a profile made, renamed, deleted or put in use. */
export function registerProfiles(
  registry: CommandRegistry,
  profiles: ProfileStore,
  steps: Switching,
  emit: Emit,
): void {
  const changed = (all: Profiles) => {
    emit('profiles.changed', { profiles: all });
    return all;
  };
  registry.register('profiles.list', () => profiles.list());
  registry.register('profiles.create', ({ name }) => changed(profiles.create(name)));
  registry.register('profiles.rename', ({ id, name }) => changed(profiles.rename(id, name)));
  registry.register('profiles.remove', ({ id }) => changed(profiles.remove(id)));
  registry.register('profiles.switch', ({ id }) => switchProfile(id, profiles, steps, emit));
}
