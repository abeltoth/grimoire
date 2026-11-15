import type { DatabaseSync } from 'node:sqlite';
import type { AgentId, PlanUsage, SpendReading, UsageMonth } from '@grimoire/contract';

/**
 * Each reading of the usage credits spent this month, kept so the month,
 * its days and the months before can be drawn: the agent says only the
 * month's total, so a day's spend is the difference across it.
 */
export class SpendReadings {
  constructor(private readonly db: DatabaseSync) {}

  record(agent: AgentId, usage: PlanUsage): void {
    const credits = usage.credits;
    if (!credits || credits.spent === null) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO usage_spend (agent, at, spent, spend_limit, currency, account)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(agent, usage.at, credits.spent, credits.limit, credits.currency, usage.account ?? '');
  }

  /** The readings since a moment of the account read last, oldest first. */
  since(agent: AgentId, from: number): SpendReading[] {
    const rows = this.db
      .prepare(
        `SELECT at, spent, spend_limit, currency FROM usage_spend
         WHERE agent = ? AND at >= ? AND account = ? ORDER BY at`,
      )
      .all(agent, from, this.account(agent)) as {
      at: number;
      spent: number;
      spend_limit: number | null;
      currency: string;
    }[];
    return rows.map(({ at, spent, spend_limit, currency }) => ({
      at,
      spent,
      limit: spend_limit,
      currency,
    }));
  }

  /** Every month of the account read last, local time, oldest first. */
  months(agent: AgentId): UsageMonth[] {
    const rows = this.db
      .prepare(
        `SELECT MIN(at) AS first, MAX(spent) AS spent, MAX(spend_limit) AS spend_limit,
                MAX(currency) AS currency
         FROM usage_spend WHERE agent = ? AND account = ?
         GROUP BY strftime('%Y-%m', at / 1000, 'unixepoch', 'localtime') ORDER BY first`,
      )
      .all(agent, this.account(agent)) as {
      first: number;
      spent: number;
      spend_limit: number | null;
      currency: string;
    }[];
    return rows.map(({ first, spent, spend_limit, currency }) => {
      const start = new Date(first);
      return {
        start: new Date(start.getFullYear(), start.getMonth(), 1).getTime(),
        spent,
        limit: spend_limit,
        currency,
      };
    });
  }

  /** Whose the latest reading is: another account's spend is no part of it. */
  private account(agent: AgentId): string {
    const row = this.db
      .prepare(`SELECT account FROM usage_spend WHERE agent = ? ORDER BY at DESC LIMIT 1`)
      .get(agent) as { account: string } | undefined;
    return row?.account ?? '';
  }
}
