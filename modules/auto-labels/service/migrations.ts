/**
 * Which chats were labelled, at how many of your messages, and the title
 * given; the tags added to each, and those you took off again, never added
 * again; and the chats you named, never renamed.
 */
export const MIGRATIONS = [
  `CREATE TABLE labelled (
     chat_id TEXT NOT NULL PRIMARY KEY,
     turns INTEGER NOT NULL,
     title TEXT
   );
   CREATE TABLE added_tags (
     chat_id TEXT NOT NULL,
     tag TEXT NOT NULL COLLATE NOCASE,
     PRIMARY KEY (chat_id, tag)
   );
   CREATE TABLE refused_tags (
     chat_id TEXT NOT NULL,
     tag TEXT NOT NULL COLLATE NOCASE,
     PRIMARY KEY (chat_id, tag)
   );`,
  `CREATE TABLE named_by_you (
     chat_id TEXT NOT NULL PRIMARY KEY
   );`,
];
