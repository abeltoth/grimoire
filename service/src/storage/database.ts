import { DatabaseSync } from 'node:sqlite';

/** Each migration moves the database up one version. Append new ones; never edit old ones. */
const MIGRATIONS = [
  `CREATE TABLE chapters (
     chat_id TEXT PRIMARY KEY,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE layout (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE withdrawn (
     chat_id TEXT NOT NULL,
     entry_id TEXT NOT NULL,
     PRIMARY KEY (chat_id, entry_id)
   );`,
  `CREATE TABLE dog_ears (
     chat_id TEXT NOT NULL,
     dog_ear TEXT NOT NULL,
     PRIMARY KEY (chat_id, dog_ear)
   );`,
  `CREATE TABLE copied (
     chat_id TEXT NOT NULL,
     entry_id TEXT NOT NULL,
     PRIMARY KEY (chat_id, entry_id)
   );`,
  `CREATE TABLE tags (
     chat_id TEXT NOT NULL,
     tag TEXT NOT NULL,
     position INTEGER NOT NULL,
     PRIMARY KEY (chat_id, tag)
   );`,
  `CREATE TABLE presets (
     name TEXT PRIMARY KEY COLLATE NOCASE,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     position INTEGER NOT NULL
   );`,
  `CREATE TABLE usage_readings (
     agent TEXT NOT NULL,
     at INTEGER NOT NULL,
     span TEXT NOT NULL,
     model TEXT NOT NULL,
     used REAL,
     resets_at INTEGER,
     PRIMARY KEY (agent, at, span, model)
   );`,
  `CREATE TABLE worktrees (
     path TEXT PRIMARY KEY,
     repo TEXT NOT NULL,
     branch TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE schedules (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     prompt TEXT NOT NULL,
     days TEXT NOT NULL,
     time TEXT NOT NULL,
     enabled INTEGER NOT NULL,
     handled_until INTEGER NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE schedule_runs (
     schedule_id TEXT NOT NULL,
     due_at INTEGER NOT NULL,
     outcome TEXT NOT NULL,
     ran_at INTEGER,
     chat_id TEXT,
     cwd TEXT,
     error TEXT,
     PRIMARY KEY (schedule_id, due_at)
   );`,
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `ALTER TABLE presets ADD COLUMN prompt TEXT;`,
  `ALTER TABLE usage_readings ADD COLUMN account TEXT NOT NULL DEFAULT '';`,
  // Profiles: what was kept before them becomes Personal's.
  `CREATE TABLE profiles (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL COLLATE NOCASE,
     claude_folder TEXT,
     position INTEGER NOT NULL
   );
   INSERT INTO profiles (id, name, claude_folder, position) VALUES ('personal', 'Personal', NULL, 1);
   CREATE TABLE app_state (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   INSERT INTO app_state (key, value) VALUES ('activeProfile', 'personal');
   CREATE TABLE profile_settings (
     profile TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (profile, key)
   );
   INSERT INTO profile_settings (profile, key, value) SELECT 'personal', key, value FROM settings;
   DROP TABLE settings;
   ALTER TABLE profile_settings RENAME TO settings;
   CREATE TABLE profile_layout (
     profile TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (profile, key)
   );
   INSERT INTO profile_layout (profile, key, value) SELECT 'personal', key, value FROM layout;
   DROP TABLE layout;
   ALTER TABLE profile_layout RENAME TO layout;
   CREATE TABLE profile_presets (
     profile TEXT NOT NULL,
     name TEXT NOT NULL COLLATE NOCASE,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     position INTEGER NOT NULL,
     prompt TEXT,
     PRIMARY KEY (profile, name)
   );
   INSERT INTO profile_presets (profile, name, agent, settings, position, prompt)
     SELECT 'personal', name, agent, settings, position, prompt FROM presets;
   DROP TABLE presets;
   ALTER TABLE profile_presets RENAME TO presets;
   ALTER TABLE chapters ADD COLUMN profile TEXT NOT NULL DEFAULT 'personal';
   ALTER TABLE schedules ADD COLUMN profile TEXT NOT NULL DEFAULT 'personal';`,
  // The Kanban board: each profile's cards, and the chats each began.
  `CREATE TABLE cards (
     id TEXT PRIMARY KEY,
     profile TEXT NOT NULL,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     notes TEXT NOT NULL,
     cwd TEXT NOT NULL,
     column_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     closed_at INTEGER
   );
   CREATE TABLE card_chats (
     card_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     agent TEXT NOT NULL,
     cwd TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (card_id, chat_id)
   );`,
];

/**
 * Grimoire's own data (ADR-009) in one SQLite file, migrated to the latest
 * version, or to `latest` for a test of what an older one becomes.
 * ':memory:' keeps it for this run only.
 */
export function openDatabase(file: string, latest = MIGRATIONS.length): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  MIGRATIONS.slice(version, latest).forEach((sql, i) => {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  return db;
}
