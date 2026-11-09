/** Each profile's board: its cards and the chats each began, and its Jira issues as last synced. */
export const MIGRATIONS = [
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
     closed_at INTEGER,
     made_in_chat TEXT,
     made_in_agent TEXT,
     made_in_cwd TEXT
   );
   CREATE TABLE card_chats (
     card_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     agent TEXT NOT NULL,
     cwd TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (card_id, chat_id)
   );
   CREATE TABLE jira_cards (
     id TEXT PRIMARY KEY,
     profile TEXT NOT NULL,
     issue_key TEXT NOT NULL,
     summary TEXT NOT NULL,
     description TEXT NOT NULL,
     url TEXT NOT NULL,
     issue_type TEXT NOT NULL,
     priority TEXT NOT NULL,
     status TEXT NOT NULL,
     column_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     closed_at INTEGER,
     UNIQUE (profile, issue_key)
   );
   CREATE TABLE jira_syncs (
     profile TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     error TEXT,
     synced_at INTEGER
   );`,
];
