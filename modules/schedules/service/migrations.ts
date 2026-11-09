/** The schedules, each profile's, and the record of their runs. */
export const MIGRATIONS = [
  `CREATE TABLE schedules (
     id TEXT PRIMARY KEY,
     profile TEXT NOT NULL,
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
];
