import { DatabaseSync } from 'node:sqlite';
import type { AgentId, ChatId, ExcerptPart, PassageKind, SearchHit } from '@grimoire/contract';

/** A passage to look through: a chat's title, one of your entries, or one of the agent's replies. */
export interface Passage {
  kind: PassageKind;
  text: string;
}

/** A chat as indexed: which agent it's with, and when it was last written in. */
export interface IndexedChat {
  id: ChatId;
  agent: AgentId;
  updatedAt: number;
}

/** Bump to rebuild every index: it's a cache, so it's dropped rather than migrated. */
const VERSION = 1;

const SCHEMA = `
  CREATE TABLE chats (
    chat_id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE passages USING fts5(
    text,
    chat_id UNINDEXED,
    kind UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );`;

// What the excerpt marks a match with: characters no chat writes.
const OPEN = '\u0002';
const CLOSE = '\u0003';

/** The most chats a search lists. */
const MAX_HITS = 200;

/**
 * The search index (ADR-009: Grimoire's, derived, and safe to delete): every
 * chat's passages in an SQLite full-text table. ':memory:' keeps it for this
 * run only.
 */
export class SearchIndex {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version !== VERSION) {
      this.db.exec('DROP TABLE IF EXISTS chats; DROP TABLE IF EXISTS passages;');
      this.db.exec(SCHEMA);
      this.db.exec(`PRAGMA user_version = ${VERSION}`);
    }
  }

  /** The chats indexed, with when each was last written in as it was indexed. */
  indexed(): Map<ChatId, IndexedChat> {
    const rows = this.db.prepare('SELECT chat_id, agent, updated_at FROM chats').all() as {
      chat_id: ChatId;
      agent: AgentId;
      updated_at: number;
    }[];
    return new Map(
      rows.map((row) => [
        row.chat_id,
        { id: row.chat_id, agent: row.agent, updatedAt: row.updated_at },
      ]),
    );
  }

  /** Indexes a chat's passages, in place of the ones it had. */
  put(chat: IndexedChat, passages: readonly Passage[]): void {
    this.inTransaction(() => {
      this.db.prepare('DELETE FROM passages WHERE chat_id = ?').run(chat.id);
      this.db
        .prepare('INSERT OR REPLACE INTO chats (chat_id, agent, updated_at) VALUES (?, ?, ?)')
        .run(chat.id, chat.agent, chat.updatedAt);
      const insert = this.db.prepare('INSERT INTO passages (text, chat_id, kind) VALUES (?, ?, ?)');
      for (const passage of passages) {
        if (passage.text.trim()) insert.run(passage.text, chat.id, passage.kind);
      }
    });
  }

  remove(chatId: ChatId): void {
    this.inTransaction(() => {
      this.db.prepare('DELETE FROM passages WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM chats WHERE chat_id = ?').run(chatId);
    });
  }

  /** The chats with a passage that has every word looked for, best first, each with that passage. */
  search(query: string): SearchHit[] {
    const match = matchOf(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT passages.chat_id AS chatId, chats.agent AS agent, passages.kind AS kind,
           snippet(passages, 0, ?, ?, '…', 24) AS excerpt
         FROM passages JOIN chats ON chats.chat_id = passages.chat_id
         WHERE passages MATCH ?
         ORDER BY bm25(passages)`,
      )
      .all(OPEN, CLOSE, match) as {
      chatId: ChatId;
      agent: AgentId;
      kind: PassageKind;
      excerpt: string;
    }[];
    const hits = new Map<ChatId, SearchHit>();
    for (const row of rows) {
      if (hits.size === MAX_HITS) break;
      if (hits.has(row.chatId)) continue;
      hits.set(row.chatId, {
        chatId: row.chatId,
        agent: row.agent,
        kind: row.kind,
        excerpt: partsOf(row.excerpt),
      });
    }
    return [...hits.values()];
  }

  close(): void {
    this.db.close();
  }

  private inTransaction(run: () => void): void {
    this.db.exec('BEGIN');
    try {
      run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * What you looked for as a full-text query: each word, quoted, matching
 * words that start with it, all of them in one passage. Null when there's
 * no word to look for.
 */
export function matchOf(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((word) => `"${word}"*`).join(' ') : null;
}

/** An excerpt with its marked matches, as parts. */
function partsOf(excerpt: string): ExcerptPart[] {
  const parts: ExcerptPart[] = [];
  for (const [i, piece] of excerpt.split(new RegExp(`[${OPEN}${CLOSE}]`)).entries()) {
    const text = piece.replace(/\s+/g, ' ');
    if (text) parts.push(i % 2 ? { text, match: true } : { text });
  }
  return parts;
}
