import type { DatabaseSync } from 'node:sqlite';

/** A worktree Grimoire made for a chat: its folder, the repository it's of, and its branch. */
export interface WorktreeRecord {
  path: string;
  repo: string;
  branch: string;
}

/**
 * The worktrees Grimoire made for chats (ADR-009), kept after they're
 * removed so a chat's worktree can be put back when you reopen it.
 */
export class WorktreeRecords {
  constructor(private readonly db: DatabaseSync) {}

  add(record: WorktreeRecord): void {
    this.db
      .prepare('INSERT OR REPLACE INTO worktrees (path, repo, branch, created_at) VALUES (?, ?, ?, ?)')
      .run(record.path, record.repo, record.branch, Date.now());
  }

  all(): WorktreeRecord[] {
    return this.db.prepare('SELECT path, repo, branch FROM worktrees').all() as unknown as WorktreeRecord[];
  }
}
