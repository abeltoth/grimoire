/** Each chat's marks, your tags for it in the order you added them, your tag list, and each chat's summary. */
export const MIGRATIONS = [
  `CREATE TABLE pins (
     chat_id TEXT NOT NULL,
     pin TEXT NOT NULL,
     PRIMARY KEY (chat_id, pin)
   );
   CREATE TABLE tags (
     chat_id TEXT NOT NULL,
     tag TEXT NOT NULL,
     position INTEGER NOT NULL,
     PRIMARY KEY (chat_id, tag)
   );`,
  `CREATE TABLE tag_list (
     tag TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
     position INTEGER NOT NULL
   );`,
  `CREATE TABLE summaries (
     chat_id TEXT NOT NULL PRIMARY KEY,
     summary TEXT NOT NULL
   );`,
];
