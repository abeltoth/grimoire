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
