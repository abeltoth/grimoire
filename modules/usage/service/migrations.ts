/** Each reading of the agents' plan limits. */
export const MIGRATIONS = [
  `CREATE TABLE usage_readings (
     agent TEXT NOT NULL,
     at INTEGER NOT NULL,
     span TEXT NOT NULL,
     model TEXT NOT NULL,
     used REAL,
     resets_at INTEGER,
     account TEXT NOT NULL,
     PRIMARY KEY (agent, at, span, model)
   );`,
];
