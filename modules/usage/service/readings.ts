import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, PlanUsage, UsageReading, UsageWeek, UsageWindow } from '@grimoire/contract';

/**
 * Each reading of how much of the plan's limits is used, kept so their
 * history can be drawn (usage stats are Grimoire's own).
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

  /** The latest reading of the limit for all models that says when it starts afresh: of `account`, when given. */
  latestWeek(agent: AgentId, account?: string): UsageReading | undefined {
    const row = this.db
      .prepare(
        `SELECT at, used, resets_at, account FROM usage_readings
         WHERE agent = ? AND span = 'week' AND model = '' AND resets_at IS NOT NULL
           AND (? IS NULL OR account = ?)
         ORDER BY at DESC LIMIT 1`,
      )
      .get(agent, account ?? null, account ?? null) as
      { at: number; used: number | null; resets_at: number; account: string } | undefined;
    if (!row) return undefined;
    const { at, used, resets_at } = row;
    return {
      at,
      span: 'week',
      used,
      resetsAt: resets_at,
      ...(row.account ? { account: row.account } : {}),
    };
  }

  /**
   * Every week of the limit for all models: when it starts afresh, to the
   * hour, the most of it used, and whose it is, as kept, oldest first.
   */
  weeks(agent: AgentId): { end: number; used: number; account: string }[] {
    return this.db
      .prepare(
        `SELECT CAST(ROUND(resets_at / 3600000.0) AS INTEGER) * 3600000 AS end,
                MAX(used) AS used, account
         FROM usage_readings
         WHERE agent = ? AND span = 'week' AND model = '' AND resets_at IS NOT NULL
           AND used IS NOT NULL
         GROUP BY end, account ORDER BY end`,
      )
      .all(agent) as { end: number; used: number; account: string }[];
  }
}

const HOUR = 60 * 60_000;
const WEEK = 7 * 24 * HOUR;

/** When in the week a week's limit starts afresh, to the hour: each account keeps its own. */
function weekPhase(resetsAt: number): number {
  return (((Math.round(resetsAt / HOUR) * HOUR) % WEEK) + WEEK) % WEEK;
}

/**
 * The readings of an account, by default the one the latest is of, oldest
 * first. Readings kept before the account was noted go by when their week
 * starts afresh, which differs from account to account.
 */
export function sameAccount(
  readings: readonly UsageReading[],
  account: string | undefined = readings.at(-1)?.account,
): UsageReading[] {
  const week = (r: UsageReading) => r.span === 'week' && !r.model && r.resetsAt !== null;
  if (!readings.length) return [];
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

/**
 * The weeks of the account the latest reading is of, as `sameAccount`
 * tells them: a week kept before the account was noted goes by when it
 * starts afresh. A week read under both is one.
 */
export function accountWeeks(
  weeks: readonly { end: number; used: number; account: string }[],
  latest: UsageReading | undefined,
): UsageWeek[] {
  if (!latest) return [];
  const phase = latest.resetsAt === null ? null : weekPhase(latest.resetsAt);
  const found = new Map<number, UsageWeek>();
  for (const week of weeks) {
    const ours =
      latest.account && week.account
        ? week.account === latest.account
        : phase !== null && weekPhase(week.end) === phase;
    if (!ours) continue;
    const kept = found.get(week.end);
    found.set(week.end, {
      start: week.end - WEEK,
      end: week.end,
      used: Math.max(kept?.used ?? 0, week.used),
    });
  }
  return [...found.values()].sort((a, b) => a.end - b.end);
}
