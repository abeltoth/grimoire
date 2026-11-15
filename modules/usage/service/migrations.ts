/** Each reading of the agents' plan limits, and of the usage credits spent. */
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
  `CREATE TABLE usage_spend (
     agent TEXT NOT NULL,
     at INTEGER NOT NULL,
     spent INTEGER NOT NULL,
     spend_limit INTEGER,
     currency TEXT NOT NULL,
     account TEXT NOT NULL,
     PRIMARY KEY (agent, at)
   );`,
];
