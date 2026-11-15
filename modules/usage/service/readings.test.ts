import type { UsageReading } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { UsageReadings, sameAccount, weeks } from './readings';

const HOUR = 60 * 60_000;
/** Thursday 15:00 and Saturday 00:00, a week on: two accounts' weeks. */
const THURSDAY = Date.UTC(2026, 10, 12, 15);
const SATURDAY = Date.UTC(2026, 10, 14, 0);

const read = (at: number, used: number, resetsAt: number, account?: string): UsageReading[] => [
  { at, span: 'session', used, resetsAt: at + HOUR, ...(account ? { account } : {}) },
  { at, span: 'week', used, resetsAt, ...(account ? { account } : {}) },
];

describe('UsageReadings', () => {
  it('keeps the account each reading is of', () => {
    const db = openDatabase(':memory:');
    migrate(db, 'usage', MIGRATIONS);
    const readings = new UsageReadings(db);
    readings.record('claude-code', {
      plan: 'max',
      windows: [{ span: 'week', used: 40, resetsAt: THURSDAY }],
      account: 'me@example.com',
      at: 1000,
    });
    readings.record('claude-code', {
      plan: 'max',
      windows: [{ span: 'week', used: 41, resetsAt: THURSDAY }],
      at: 2000,
    });
    expect(readings.since('claude-code', 0).map((r) => r.account)).toEqual([
      'me@example.com',
      undefined,
    ]);
  });
});

describe('sameAccount', () => {
  it('keeps the readings of the account read last', () => {
    const history = [
      ...read(1000, 38, THURSDAY, 'work@example.com'),
      ...read(2000, 6, SATURDAY, 'home@example.com'),
      ...read(3000, 39, THURSDAY, 'work@example.com'),
    ];
    expect(sameAccount(history).map((r) => [r.at, r.used])).toEqual([
      [1000, 38],
      [1000, 38],
      [3000, 39],
      [3000, 39],
    ]);
  });

  it('tells the readings kept before the account was noted apart by when their week starts afresh', () => {
    const history = [
      ...read(1000, 38, THURSDAY),
      ...read(2000, 6, SATURDAY),
      // A minute off, and the week after: the same account's week.
      ...read(3000, 39, THURSDAY - 60_000 + 7 * 24 * HOUR),
      ...read(4000, 40, THURSDAY, 'work@example.com'),
    ];
    expect(sameAccount(history).map((r) => r.at)).toEqual([1000, 1000, 3000, 3000, 4000, 4000]);
  });

  it('has nothing to keep with no readings', () => {
    expect(sameAccount([])).toEqual([]);
  });
});

describe('weeks', () => {
  it('tells each week of the limit for all models by when it starts afresh, and when it was first full', () => {
    const next = THURSDAY + 7 * 24 * HOUR;
    const history: UsageReading[] = [
      { at: 1000, span: 'week', used: 90, resetsAt: THURSDAY },
      { at: 2000, span: 'week', used: 100, resetsAt: THURSDAY + 60_000 },
      { at: 3000, span: 'week', used: 100, resetsAt: THURSDAY },
      { at: 3000, span: 'week', model: 'Opus', used: 100, resetsAt: THURSDAY },
      { at: 3000, span: 'session', used: 100, resetsAt: 4000 },
      { at: 4000, span: 'week', used: 12, resetsAt: next },
      { at: 5000, span: 'week', used: null, resetsAt: next },
    ];
    expect(weeks(history)).toEqual([
      { start: THURSDAY - 7 * 24 * HOUR, end: THURSDAY, peak: 100, fullAt: 2000 },
      { start: THURSDAY, end: next, peak: 12, fullAt: null },
    ]);
  });
});
