import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, PlanUsage, UsageReading, UsageWindow } from '@grimoire/contract';

/**
 * Each reading of how much of the plan's limits is used, kept so their
 * history can be drawn (ADR-009: usage stats are Grimoire's own).
 */
export class UsageReadings {
  constructor(private readonly db: DatabaseSync) {}

  record(agent: AgentId, usage: PlanUsage): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO usage_readings (agent, at, span, model, used, resets_at, account)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const window of usage.windows) {
      insert.run(
        agent,
        usage.at,
        window.span,
        window.model ?? '',
        window.used,
        window.resetsAt,
        usage.account ?? '',
      );
    }
  }

  /** The readings since a moment, oldest first. */
  since(agent: AgentId, from: number): UsageReading[] {
    const rows = this.db
      .prepare(
        `SELECT at, span, model, used, resets_at, account FROM usage_readings
         WHERE agent = ? AND at >= ? ORDER BY at, span, model`,
      )
      .all(agent, from) as {
      at: number;
      span: UsageWindow['span'];
      model: string;
      used: number | null;
      resets_at: number | null;
      account: string;
    }[];
    return rows.map(({ at, span, model, used, resets_at, account }) => ({
      at,
      span,
      ...(model ? { model } : {}),
      used,
      resetsAt: resets_at,
      ...(account ? { account } : {}),
    }));
  }
}

const HOUR = 60 * 60_000;
const WEEK = 7 * 24 * HOUR;

/** When in the week a week's limit starts afresh, to the hour: each account keeps its own. */
function weekPhase(resetsAt: number): number {
  return (((Math.round(resetsAt / HOUR) * HOUR) % WEEK) + WEEK) % WEEK;
}

/**
 * The readings of the account the latest one is of, oldest first. Readings
 * kept before the account was noted go by when their week starts afresh,
 * which differs from account to account.
 */
export function sameAccount(readings: readonly UsageReading[]): UsageReading[] {
  const week = (r: UsageReading) => r.span === 'week' && !r.model && r.resetsAt !== null;
  const latest = readings[readings.length - 1];
  if (!latest) return [];
  const account = latest.account;
  const latestWeek = [...readings]
    .reverse()
    .find((r) => week(r) && (!account || r.account === account));
  const phase = latestWeek ? weekPhase(latestWeek.resetsAt!) : null;
  // A reading's moment says which week it belongs with: those read together share it.
  const phases = new Map<number, number>();
  for (const r of readings) if (week(r)) phases.set(r.at, weekPhase(r.resetsAt!));
  return readings.filter((r) =>
    account && r.account ? r.account === account : phase !== null && phases.get(r.at) === phase,
  );
}
