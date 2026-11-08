import type { DatabaseSync } from 'node:sqlite';
import type { Card, CardColumn, JiraSync } from '@grimoire/contract';
import type { FetchedIssue } from './jira';

interface JiraRow {
  id: string;
  issue_key: string;
  summary: string;
  description: string;
  url: string;
  issue_type: string;
  priority: string;
  status: string;
  column_id: CardColumn;
  created_at: number;
  closed_at: number | null;
}

interface SyncRow {
  status: JiraSync['status'];
  error: string | null;
  synced_at: number | null;
}

/**
 * The Jira issues on each profile's board, as last synced, in Jira's
 * order, and how each profile's last sync went. Each sync replaces them:
 * an issue the query no longer finds goes, and one closed on the board
 * stays closed while it's found.
 */
export class JiraCards {
  /** When each card's issue was last updated on its own, as its status changed, by card ID. */
  private readonly updated = new Map<string, number>();

  constructor(private readonly db: DatabaseSync) {}

  /** A profile's Jira cards, column by column, each column in Jira's order, without their chats. */
  list(profile: string): Omit<Card, 'chats'>[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM jira_cards WHERE profile = ?
         ORDER BY CASE column_id WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, position`,
      )
      .all(profile) as unknown as JiraRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: 'jira',
      title: row.summary,
      notes: row.description,
      cwd: '',
      column: row.column_id,
      createdAt: row.created_at,
      ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
      jira: {
        key: row.issue_key,
        url: row.url,
        type: row.issue_type,
        priority: row.priority,
        status: row.status,
      },
    }));
  }

  /** Whether the card is one of the profile's Jira cards. */
  has(profile: string, id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM jira_cards WHERE id = ? AND profile = ?').get(id, profile);
  }

  /** The issue's key, when the card is one of the profile's Jira cards. */
  keyOf(profile: string, id: string): string | undefined {
    const row = this.db
      .prepare('SELECT issue_key FROM jira_cards WHERE id = ? AND profile = ?')
      .get(id, profile) as { issue_key: string } | undefined;
    return row?.issue_key;
  }

  /**
   * Puts what Jira says of an issue now on its card, once its status
   * changed: all of it when it was read again, or the status it was
   * changed to only when it couldn't be. It stays in its place in Jira's
   * order; a sync begun before keeps what's put here.
   */
  update(
    profile: string,
    issue: Pick<FetchedIssue, 'key' | 'status' | 'column'> & Partial<FetchedIssue>,
    at: number,
  ): void {
    this.db
      .prepare(
        `UPDATE jira_cards SET summary = COALESCE(?, summary), description = COALESCE(?, description),
           url = COALESCE(?, url), issue_type = COALESCE(?, issue_type), priority = COALESCE(?, priority),
           status = ?, column_id = ?
         WHERE profile = ? AND issue_key = ?`,
      )
      .run(
        issue.summary ?? null,
        issue.description ?? null,
        issue.url ?? null,
        issue.type ?? null,
        issue.priority ?? null,
        issue.status,
        issue.column,
        profile,
        issue.key,
      );
    this.updated.set(jiraCardId(profile, issue.key), at);
  }

  /** Takes a Jira card off the board, or puts it back; it stays where Jira has it. */
  close(profile: string, id: string, closed: boolean, at: number): void {
    this.db
      .prepare(
        `UPDATE jira_cards SET closed_at = CASE WHEN ? THEN COALESCE(closed_at, ?) ELSE NULL END
         WHERE id = ? AND profile = ?`,
      )
      .run(closed ? 1 : 0, at, id, profile);
  }

  /**
   * Puts the issues a sync found on the profile's board in place of those
   * there, in their order, keeping when each was first seen and whether it
   * was closed, and notes the sync. One updated since the sync `began`,
   * as its status changed, keeps what Jira said of it then: the sync may
   * have found it as it was before.
   */
  replace(profile: string, issues: readonly FetchedIssue[], at: number, began: number = at): void {
    const upsert = this.db.prepare(
      `INSERT INTO jira_cards (id, profile, issue_key, summary, description, url, issue_type, priority,
         status, column_id, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile, issue_key) DO UPDATE SET summary = excluded.summary,
         description = excluded.description, url = excluded.url, issue_type = excluded.issue_type,
         priority = excluded.priority, status = excluded.status, column_id = excluded.column_id,
         position = excluded.position`,
    );
    const place = this.db.prepare('UPDATE jira_cards SET position = ? WHERE profile = ? AND issue_key = ?');
    const keys = issues.map((issue) => issue.key);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `DELETE FROM jira_cards WHERE profile = ?
           AND issue_key NOT IN (SELECT value FROM json_each(?))`,
        )
        .run(profile, JSON.stringify(keys));
      issues.forEach((issue, position) => {
        const id = jiraCardId(profile, issue.key);
        if ((this.updated.get(id) ?? -Infinity) >= began) {
          place.run(position, profile, issue.key);
          return;
        }
        upsert.run(
          id,
          profile,
          issue.key,
          issue.summary,
          issue.description,
          issue.url,
          issue.type,
          issue.priority,
          issue.status,
          issue.column,
          position,
          at,
        );
      });
      this.note(profile, 'synced', undefined, at);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Notes how a profile's sync went, when it found no issues to put on the board; its issues stay. */
  note(profile: string, status: JiraSync['status'], error?: string, at?: number): void {
    this.db
      .prepare(
        `INSERT INTO jira_syncs (profile, status, error, synced_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (profile) DO UPDATE SET status = excluded.status, error = excluded.error,
           synced_at = COALESCE(excluded.synced_at, synced_at)`,
      )
      .run(profile, status, error ?? null, at ?? null);
  }

  /** How a profile's last sync went; `none` before its first. */
  state(profile: string): Omit<JiraSync, 'syncing'> {
    const row = this.db.prepare('SELECT * FROM jira_syncs WHERE profile = ?').get(profile) as
      | SyncRow
      | undefined;
    if (!row) return { status: 'none' };
    return {
      status: row.status,
      ...(row.error !== null ? { error: row.error } : {}),
      ...(row.synced_at !== null ? { syncedAt: row.synced_at } : {}),
    };
  }
}

/**
 * A Jira card's ID: the same each sync, so its chats and whether it's
 * closed carry over, and apart in each profile.
 */
export function jiraCardId(profile: string, key: string): string {
  return `jira:${profile}:${key}`;
}
