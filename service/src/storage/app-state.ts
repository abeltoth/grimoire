import type { DatabaseSync } from 'node:sqlite';
import { PERSONAL_PROFILE } from '@grimoire/contract';

/** The profile in use, whose settings, layout, presets, schedules and chapters the stores keep. */
export function activeProfile(db: DatabaseSync): string {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'activeProfile'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? PERSONAL_PROFILE;
}

export function setActiveProfile(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO app_state (key, value) VALUES ('activeProfile', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(id);
}
