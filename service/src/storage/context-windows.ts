import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, ContextWindow } from '@grimoire/contract';

/** Each model's context window as its agent last measured it, which a saved transcript doesn't record. */
export class ContextWindows {
  constructor(private readonly db: DatabaseSync) {}

  get(agent: AgentId, model: string): ContextWindow | undefined {
    const row = this.db
      .prepare(
        'SELECT context_limit, compacts_at, fixed FROM context_windows WHERE agent = ? AND model = ?',
      )
      .get(agent, model) as
      { context_limit: number; compacts_at: number | null; fixed: string | null } | undefined;
    if (!row) return undefined;
    return {
      limit: row.context_limit,
      ...(row.compacts_at !== null ? { compactsAt: row.compacts_at } : {}),
      ...(row.fixed !== null ? { fixed: row.fixed } : {}),
    };
  }

  put(agent: AgentId, model: string, window: ContextWindow): void {
    this.db
      .prepare(
        `INSERT INTO context_windows (agent, model, context_limit, compacts_at, fixed)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (agent, model) DO UPDATE
         SET context_limit = excluded.context_limit, compacts_at = excluded.compacts_at,
           fixed = excluded.fixed`,
      )
      .run(agent, model, window.limit, window.compactsAt ?? null, window.fixed ?? null);
  }
}
