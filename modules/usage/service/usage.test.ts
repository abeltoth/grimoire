import type { PlanUsage } from '@grimoire/contract';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIGRATIONS } from './migrations';
import { UsageReadings } from './readings';
import type { UsageSource } from './sources';
import { Usage } from './usage';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function setUp() {
  const db = openDatabase(':memory:');
  migrate(db, 'usage', MIGRATIONS);
  const readings = new UsageReadings(db);
  let used = 10;
  const source: UsageSource = {
    plan: async (): Promise<PlanUsage> => ({
      plan: 'max',
      windows: [{ span: 'session', used: used++, resetsAt: 5000 }],
      account: 'me@example.com',
      at: vi.getMockedSystemTime()!.getTime(),
    }),
    breakdown: async () => null,
  };
  const usage = new Usage(readings, new Map([['fake', source]]), () => ['fake', 'plain']);
  return { usage, readings };
}

describe('Usage', () => {
  it('reads the plan limits now and every so often, and keeps each reading', async () => {
    const { usage, readings } = setUp();
    expect(await usage.plan('fake')).toMatchObject({ plan: 'max', windows: [{ used: 10 }] });

    await vi.advanceTimersByTimeAsync(1000);
    const stop = usage.readEvery(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readings.since('fake', 0).map(({ span, used }) => ({ span, used }))).toEqual([
      { span: 'session', used: 10 },
      { span: 'session', used: 11 },
      { span: 'session', used: 12 },
    ]);
    const [, second] = readings.since('fake', 0);
    expect(usage.history('fake', second!.at).map(({ used }) => used)).toEqual([11, 12]);
  });

  it('has no plan limits, nor where they went, for an agent without a plan', async () => {
    const { usage } = setUp();
    expect(await usage.plan('plain')).toBeNull();
    expect(await usage.breakdown('plain')).toBeNull();
  });
});
