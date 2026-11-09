import { DatabaseSync } from 'node:sqlite';

/** The core's tables: profiles, settings, layout, presets, and the open chats with what the hub keeps of them. */
const CORE_MIGRATIONS = [
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
   CREATE TABLE settings (
     profile TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (profile, key)
   );
   CREATE TABLE layout (
     profile TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (profile, key)
   );
   CREATE TABLE presets (
     profile TEXT NOT NULL,
     name TEXT NOT NULL COLLATE NOCASE,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     position INTEGER NOT NULL,
     prompt TEXT,
     PRIMARY KEY (profile, name)
   );
   CREATE TABLE open_chats (
     chat_id TEXT PRIMARY KEY,
     agent TEXT NOT NULL,
     settings TEXT NOT NULL,
     profile TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE withdrawn (
     chat_id TEXT NOT NULL,
     entry_id TEXT NOT NULL,
     PRIMARY KEY (chat_id, entry_id)
   );
   CREATE TABLE copied (
     chat_id TEXT NOT NULL,
     entry_id TEXT NOT NULL,
     PRIMARY KEY (chat_id, entry_id)
   );
   CREATE TABLE parallels (
     chat_id TEXT PRIMARY KEY,
     group_id TEXT NOT NULL
   );
   CREATE TABLE parallel_editors (
     group_id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL
   );
   CREATE TABLE pins (
     chat_id TEXT NOT NULL,
     pin TEXT NOT NULL,
     PRIMARY KEY (chat_id, pin)
   );
   CREATE TABLE tags (
     chat_id TEXT NOT NULL,
     tag TEXT NOT NULL,
     position INTEGER NOT NULL,
     PRIMARY KEY (chat_id, tag)
   );
   CREATE TABLE usage_readings (
     agent TEXT NOT NULL,
     at INTEGER NOT NULL,
     span TEXT NOT NULL,
     model TEXT NOT NULL,
     used REAL,
     resets_at INTEGER,
     account TEXT NOT NULL,
     PRIMARY KEY (agent, at, span, model)
   );`,
  // The usage module keeps the plan's readings.
  `DROP TABLE usage_readings;`,
  // The history module keeps the pins and tags.
  `DROP TABLE pins;
   DROP TABLE tags;`,
];

/**
 * Grimoire's own data (ADR-009) in one SQLite file, with the core's tables
 * migrated; each module migrates its own with migrate(). ':memory:' keeps
 * it for this run only.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  emptyIfVersionedWhole(db);
  migrate(db, 'core', CORE_MIGRATIONS);
  return db;
}

/**
 * Moves an owner's tables (the core's or a module's) up to the latest of
 * its migrations, or to `latest` for a test of what an older version
 * becomes. Each migration moves them up one version: append new ones;
 * never edit old ones.
 */
export function migrate(
  db: DatabaseSync,
  owner: string,
  migrations: readonly string[],
  latest = migrations.length,
): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_versions (owner TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_versions WHERE owner = ?').get(owner) as
    | { version: number }
    | undefined;
  const version = row?.version ?? 0;
  migrations.slice(version, latest).forEach((sql, i) => {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        `INSERT INTO schema_versions (owner, version) VALUES (?, ?)
         ON CONFLICT (owner) DO UPDATE SET version = excluded.version`,
      ).run(owner, version + i + 1);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
}

/** A database versioned as one whole, by PRAGMA user_version, has a layout no owner knows, so it starts again empty. */
function emptyIfVersionedWhole(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version === 0) return;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  db.exec('BEGIN');
  for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
  db.exec('PRAGMA user_version = 0');
  db.exec('COMMIT');
}
