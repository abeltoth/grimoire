import { DatabaseSync } from 'node:sqlite';
import {
  type AgentId,
  type ChatId,
  type ExcerptPart,
  type PassageKind,
  type SearchHit,
  type TokenTotals,
  type TokenUse,
  type ToolCall,
  type UsedTool,
} from '@grimoire/contract';
import { type TurnRow, totalsOf } from './token-totals';

/** A passage to look through: a chat's title, one of your messages, or one of the agent's replies. */
export interface Passage {
  kind: PassageKind;
  text: string;
}

/** A chat as indexed: which agent it's with, when it was last written in, its title and folder. */
export interface IndexedChat {
  id: ChatId;
  agent: AgentId;
  updatedAt: number;
  title?: string;
  cwd?: string;
}

/** One model's tokens in one of a chat's turns. */
export interface TurnUse extends TokenUse {
  /** When the turn began, in ms since the epoch. */
  at: number;
}

/** A tool the agent called, or a skill it ran or you wrote as /name, in one of a chat's turns. */
export interface ToolUse {
  /** When, in ms since the epoch. */
  at: number;
  kind: 'tool' | 'skill';
  name: string;
  /** What a tool ran on, such as a file or command, when the agent says. */
  target?: string;
  /** The tokens a tool's result added to the chat's context, when the agent can tell. */
  context?: number;
}

/** Bump to rebuild every index: it's a cache, so it's dropped rather than migrated. */
const VERSION = 6;

/** The most calls of a tool listed as its heaviest. */
const MAX_CALLS = 10;

const SCHEMA = `
  CREATE TABLE chats (
    chat_id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    cwd TEXT
  );
  CREATE TABLE turns (
    chat_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    model TEXT NOT NULL,
    subagent INTEGER NOT NULL,
    input INTEGER NOT NULL,
    cache_written INTEGER NOT NULL,
    cache_written_long INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cost_input REAL,
    cost_cache_written REAL,
    cost_cache_written_long REAL,
    cost_cache_read REAL,
    cost_output REAL,
    source_kind TEXT,
    source_name TEXT
  );
  CREATE TABLE uses (
    chat_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    target TEXT,
    context INTEGER
  );
  CREATE INDEX uses_at ON uses (at);
  CREATE INDEX uses_chat ON uses (chat_id);
  CREATE INDEX turns_at ON turns (at);
  CREATE INDEX turns_chat ON turns (chat_id);
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
 * The search index (Grimoire's, derived, and safe to delete): every
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
      this.db.exec(
        'DROP TABLE IF EXISTS chats; DROP TABLE IF EXISTS passages; DROP TABLE IF EXISTS turns; DROP TABLE IF EXISTS uses;',
      );
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

  /** Indexes a chat's passages, what its turns spent and the tools and skills used, in place of the ones it had. */
  put(
    chat: IndexedChat,
    passages: readonly Passage[],
    turns: readonly TurnUse[] = [],
    uses: readonly ToolUse[] = [],
  ): void {
    this.inTransaction(() => {
      this.db.prepare('DELETE FROM passages WHERE chat_id = ?').run(chat.id);
      this.db.prepare('DELETE FROM turns WHERE chat_id = ?').run(chat.id);
      this.db.prepare('DELETE FROM uses WHERE chat_id = ?').run(chat.id);
      this.db
        .prepare(
          'INSERT OR REPLACE INTO chats (chat_id, agent, updated_at, title, cwd) VALUES (?, ?, ?, ?, ?)',
        )
        .run(chat.id, chat.agent, chat.updatedAt, chat.title ?? '', chat.cwd ?? null);
      const insert = this.db.prepare('INSERT INTO passages (text, chat_id, kind) VALUES (?, ?, ?)');
      for (const passage of passages) {
        if (passage.text.trim()) insert.run(passage.text, chat.id, passage.kind);
      }
      const spent = this.db.prepare(
        `INSERT INTO turns (chat_id, at, model, subagent, input, cache_written, cache_written_long,
           cache_read, output, cost_input, cost_cache_written, cost_cache_written_long, cost_cache_read, cost_output,
           source_kind, source_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const turn of turns) {
        spent.run(
          chat.id,
          turn.at,
          turn.model,
          turn.subagent ? 1 : 0,
          turn.input,
          turn.cacheWritten,
          turn.cacheWrittenLong,
          turn.cacheRead,
          turn.output,
          turn.cost?.input ?? null,
          turn.cost?.cacheWritten ?? null,
          turn.cost?.cacheWrittenLong ?? null,
          turn.cost?.cacheRead ?? null,
          turn.cost?.output ?? null,
          turn.source?.kind ?? null,
          turn.source?.name ?? null,
        );
      }
      const used = this.db.prepare(
        'INSERT INTO uses (chat_id, at, kind, name, target, context) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const use of uses)
        used.run(chat.id, use.at, use.kind, use.name, use.target ?? null, use.context ?? null);
    });
  }

  remove(chatId: ChatId): void {
    this.inTransaction(() => {
      this.db.prepare('DELETE FROM passages WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM turns WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM uses WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM chats WHERE chat_id = ?').run(chatId);
    });
  }

  /**
   * Where the tokens went in the turns begun since a time: by day, model,
   * folder, chat, and skill or subagent; and the tools and skills used.
   */
  tokens(since: number): TokenTotals {
    const rows = this.db
      .prepare(
        `SELECT turns.chat_id AS id, turns.at AS at, turns.model AS model, turns.subagent AS subagent,
           turns.input AS input, turns.cache_written AS cacheWritten,
           turns.cache_written_long AS cacheWrittenLong, turns.cache_read AS cacheRead,
           turns.output AS output, turns.cost_input AS costInput,
           turns.cost_cache_written AS costCacheWritten,
           turns.cost_cache_written_long AS costCacheWrittenLong,
           turns.cost_cache_read AS costCacheRead, turns.cost_output AS costOutput,
           turns.source_kind AS sourceKind, turns.source_name AS sourceName,
           chats.agent AS agent, chats.title AS title, chats.cwd AS cwd
         FROM turns JOIN chats ON chats.chat_id = turns.chat_id
         WHERE turns.at >= ?
         ORDER BY turns.at`,
      )
      .all(since) as TurnRow[];
    return {
      ...totalsOf(since, rows),
      tools: this.used('tool', since),
      skills: this.used('skill', since).map(({ name, uses }) => ({ name, uses })),
    };
  }

  /**
   * The tools, or skills, used since a time, of chats still indexed, each
   * with the context its results added; most used first, then by name.
   */
  private used(kind: ToolUse['kind'], since: number): UsedTool[] {
    return this.db
      .prepare(
        `SELECT uses.name AS name, COUNT(*) AS uses, COALESCE(SUM(uses.context), 0) AS context
         FROM uses JOIN chats ON chats.chat_id = uses.chat_id
         WHERE uses.kind = ? AND uses.at >= ?
         GROUP BY uses.name
         ORDER BY uses DESC, uses.name`,
      )
      .all(kind, since) as unknown as UsedTool[];
  }

  /** The calls of some tools since a time that added the most to their chat's context, the most first. */
  toolCalls(since: number, tools: readonly string[]): ToolCall[] {
    if (!tools.length) return [];
    return this.db
      .prepare(
        `SELECT uses.chat_id AS chatId, chats.agent AS agent, chats.title AS title, chats.cwd AS cwd,
           uses.name AS tool, uses.at AS at, uses.target AS target, uses.context AS context
         FROM uses JOIN chats ON chats.chat_id = uses.chat_id
         WHERE uses.kind = 'tool' AND uses.name IN (${tools.map(() => '?').join(', ')})
           AND uses.at >= ? AND uses.context > 0
         ORDER BY uses.context DESC, uses.at DESC
         LIMIT ?`,
      )
      .all(...tools, since, MAX_CALLS)
      .map((row) => {
        const { cwd, target, ...call } = row as unknown as ToolCall & {
          cwd: string | null;
          target: string | null;
        };
        return { ...call, ...(cwd ? { cwd } : {}), ...(target ? { target } : {}) };
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
