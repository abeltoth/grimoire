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
];

/**
 * Grimoire's own data (ADR-009) in one SQLite file, migrated to the latest
 * version. ':memory:' keeps it for this run only.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  MIGRATIONS.slice(version).forEach((sql, i) => {
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
