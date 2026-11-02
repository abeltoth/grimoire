import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, PlanUsage, UsageWindow } from '@grimoire/contract';

/** A plan limit as it was read at one moment. */
export interface UsageReading extends UsageWindow {
  at: number;
}

/**
 * Each reading of how much of the plan's limits is used, kept so their
 * history can be drawn (ADR-009: usage stats are Grimoire's own).
 */
export class UsageReadings {
  constructor(private readonly db: DatabaseSync) {}

  record(agent: AgentId, usage: PlanUsage): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO usage_readings (agent, at, span, model, used, resets_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const window of usage.windows) {
      insert.run(agent, usage.at, window.span, window.model ?? '', window.used, window.resetsAt);
    }
  }

  /** The readings since a moment, oldest first. */
  since(agent: AgentId, from: number): UsageReading[] {
    const rows = this.db
      .prepare(
        `SELECT at, span, model, used, resets_at FROM usage_readings
         WHERE agent = ? AND at >= ? ORDER BY at, span, model`,
      )
      .all(agent, from) as {
      at: number;
      span: UsageWindow['span'];
      model: string;
      used: number | null;
      resets_at: number | null;
    }[];
    return rows.map(({ at, span, model, used, resets_at }) => ({
      at,
      span,
      ...(model ? { model } : {}),
      used,
      resetsAt: resets_at,
    }));
  }
}
