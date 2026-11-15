import type { UsageReading } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { UsageReadings, accountWeeks, sameAccount } from './readings';

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

  it('keeps the readings of the account asked for, and none of one with no readings', () => {
    const history = [
      ...read(1000, 38, THURSDAY, 'work@example.com'),
      ...read(2000, 6, SATURDAY, 'home@example.com'),
    ];
    expect(sameAccount(history, 'work@example.com').map((r) => r.at)).toEqual([1000, 1000]);
    expect(sameAccount(history, 'enterprise@example.com')).toEqual([]);
  });

  it('has nothing to keep with no readings', () => {
    expect(sameAccount([])).toEqual([]);
  });
});

describe('weeks', () => {
  it('tells every week of the account read last, by when it starts afresh, at the most used', () => {
    const db = openDatabase(':memory:');
    migrate(db, 'usage', MIGRATIONS);
    const readings = new UsageReadings(db);
    const week = (at: number, used: number, resetsAt: number, account?: string) =>
      readings.record('claude-code', {
        plan: 'max',
        windows: [
          { span: 'week', used, resetsAt },
          { span: 'week', model: 'Opus', used: 100, resetsAt },
        ],
        ...(account ? { account } : {}),
        at,
      });
    const next = THURSDAY + 7 * 24 * HOUR;
    // Kept before the account was noted, then under it: one week.
    week(1000, 60, THURSDAY);
    week(2000, 90, THURSDAY + 60_000, 'work@example.com');
    week(3000, 40, SATURDAY, 'home@example.com');
    week(4000, 10, next, 'work@example.com');
    expect(accountWeeks(readings.weeks('claude-code'), readings.latestWeek('claude-code'))).toEqual(
      [
        { start: THURSDAY - 7 * 24 * HOUR, end: THURSDAY, used: 90 },
        { start: THURSDAY, end: next, used: 10 },
      ],
    );
    expect(accountWeeks([], undefined)).toEqual([]);
    // Asked for another account: that one's weeks, or none.
    expect(
      accountWeeks(
        readings.weeks('claude-code'),
        readings.latestWeek('claude-code', 'home@example.com'),
      ),
    ).toEqual([{ start: SATURDAY - 7 * 24 * HOUR, end: SATURDAY, used: 40 }]);
    expect(readings.latestWeek('claude-code', 'enterprise@example.com')).toBeUndefined();
  });
});
