import type { PlanUsage } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { SpendReadings } from './spend';

const at = (month: number, day: number) => new Date(2026, month, day, 12).getTime();

function setUp() {
  const db = openDatabase(':memory:');
  migrate(db, 'usage', MIGRATIONS);
  const spend = new SpendReadings(db);
  const read = (when: number, spent: number | null, account = 'me@example.com') =>
    spend.record('claude-code', {
      plan: 'enterprise',
      windows: [],
      credits: { spent, limit: 60000, currency: 'USD', used: null, resetsAt: 0 },
      account,
      at: when,
    } satisfies PlanUsage);
  return { spend, read };
}

describe('SpendReadings', () => {
  it('keeps each reading of the credits spent, of the account read last', () => {
    const { spend, read } = setUp();
    read(at(9, 20), 9000, 'other@example.com');
    read(at(10, 2), 1000);
    read(at(10, 3), 2500);
    read(at(10, 4), null);
    expect(spend.since('claude-code', at(10, 1))).toEqual([
      { at: at(10, 2), spent: 1000, limit: 60000, currency: 'USD' },
      { at: at(10, 3), spent: 2500, limit: 60000, currency: 'USD' },
    ]);
  });

  it('keeps nothing without credits', () => {
    const { spend } = setUp();
    spend.record('claude-code', { plan: 'max', windows: [], at: 1000 });
    expect(spend.since('claude-code', 0)).toEqual([]);
  });

  it('tells each month by the most spent in it', () => {
    const { spend, read } = setUp();
    read(at(9, 10), 20000);
    read(at(9, 28), 55000);
    read(at(10, 3), 4000);
    expect(spend.months('claude-code')).toEqual([
      { start: new Date(2026, 9, 1).getTime(), spent: 55000, limit: 60000, currency: 'USD' },
      { start: new Date(2026, 10, 1).getTime(), spent: 4000, limit: 60000, currency: 'USD' },
    ]);
  });
});
