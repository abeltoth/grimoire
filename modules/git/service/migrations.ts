/** Which chat's turn made each commit, kept so the history can name it after the chat closes. */
export const MIGRATIONS = [
  `CREATE TABLE commit_chats (
     sha TEXT NOT NULL PRIMARY KEY,
     root TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     agent TEXT NOT NULL,
     title TEXT NOT NULL,
     cwd TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX commit_chats_chat ON commit_chats (chat_id);`,
];
