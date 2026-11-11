/** Each profile's notes, with their reminders and the chat each was made in. */
export const MIGRATIONS = [
  `CREATE TABLE notes (
     id TEXT PRIMARY KEY,
     profile TEXT NOT NULL,
     text TEXT NOT NULL,
     pinned INTEGER NOT NULL,
     remind_at INTEGER,
     done_at INTEGER,
     created_at INTEGER NOT NULL,
     made_in_chat TEXT,
     made_in_agent TEXT,
     made_in_cwd TEXT
   );
   CREATE INDEX notes_profile ON notes (profile)`,
];
