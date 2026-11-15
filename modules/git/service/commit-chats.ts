import type { DatabaseSync } from 'node:sqlite';
import type { CommitChat } from '@grimoire/contract';
import { type Git, type Run, runTool } from './git';

/** How many commits one turn can be credited with, so a branch switch can't flood the table. */
const MOST_PER_TURN = 100;

/** Where a turn began: its repository, the commit checked out then (null before the first), and when. */
interface Start {
  root: string;
  head: string | null;
  at: number;
}

/**
 * Links each commit to the chat whose turn made it: the commits on HEAD at
 * a turn's end that weren't at its start and were made after it. Two chats committing in one
 * repository in overlapping turns can't be told apart; the first turn to
 * end is credited.
 */
export class CommitChats {
  private readonly started = new Map<string, Promise<Start | null>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly git: Git,
    private readonly now: () => number,
    private readonly run: Run = runTool,
  ) {}

  /** A chat's turn began in the folder; only the first call of a turn counts. Settles once it's read. */
  async turnStarted(chatId: string, cwd: string): Promise<void> {
    if (!this.started.has(chatId)) this.started.set(chatId, this.startOf(cwd));
    await this.started.get(chatId);
  }

  /** A chat's turn ended: the commits made since it began are credited to it. Gives how many. */
  async turnEnded(chatId: string, chat: Omit<CommitChat, 'id'>): Promise<number> {
    const start = await this.started.get(chatId);
    this.started.delete(chatId);
    if (!start) return 0;
    const out = await this.run(
      'git',
      [
        'rev-list',
        `--max-count=${MOST_PER_TURN}`,
        // Older commits came with a branch switched to, not from the turn.
        `--max-age=${Math.max(0, Math.floor(start.at / 1000) - 1)}`,
        'HEAD',
        ...(start.head ? ['--not', start.head] : []),
      ],
      start.root,
    ).catch(() => '');
    const shas = out.split(/\s+/).filter(Boolean);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO commit_chats (sha, root, chat_id, agent, title, cwd, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const sha of shas) {
      insert.run(sha, start.root, chatId, chat.agent, chat.title, chat.cwd, this.now());
    }
    return shas.length;
  }

  /** The chat was renamed: its commits show the new title. */
  renamed(chatId: string, title: string): void {
    this.db.prepare('UPDATE commit_chats SET title = ? WHERE chat_id = ?').run(title, chatId);
  }

  /** The chats that made the commits, by sha; commits no chat made are left out. */
  chatsOf(shas: string[]): Map<string, CommitChat> {
    const chats = new Map<string, CommitChat>();
    if (!shas.length) return chats;
    const rows = this.db
      .prepare(
        `SELECT sha, chat_id, agent, title, cwd FROM commit_chats
         WHERE sha IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(shas)) as {
      sha: string;
      chat_id: string;
      agent: string;
      title: string;
      cwd: string;
    }[];
    for (const row of rows) {
      chats.set(row.sha, { id: row.chat_id, agent: row.agent, title: row.title, cwd: row.cwd });
    }
    return chats;
  }

  private async startOf(cwd: string): Promise<Start | null> {
    const at = this.now();
    const root = await this.git.root(cwd);
    if (!root) return null;
    const head = await this.run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], root).catch(
      () => '',
    );
    return { root, head: head.trim() || null, at };
  }
}
