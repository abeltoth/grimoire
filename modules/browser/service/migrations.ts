/** Each profile's browser tabs, in order, with the one that shows. */
export const MIGRATIONS = [
  `CREATE TABLE browser_tabs (
     profile TEXT NOT NULL,
     position INTEGER NOT NULL,
     url TEXT NOT NULL,
     title TEXT NOT NULL,
     shown INTEGER NOT NULL,
     PRIMARY KEY (profile, position)
   )`,
];
