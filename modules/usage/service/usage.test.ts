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
  const kept: [string, PlanUsage][] = [];
  const source: UsageSource = {
    plan: async (): Promise<PlanUsage> => ({
      plan: 'max',
      windows: [{ span: 'session', used: used++, resetsAt: 5000 }],
      account: 'me@example.com',
      at: vi.getMockedSystemTime()!.getTime(),
    }),
    breakdown: async () => null,
  };
  const usage = new Usage(
    readings,
    new Map([['fake', source]]),
    () => ['fake', 'plain'],
    (agent, plan) => kept.push([agent, plan]),
    () => vi.getMockedSystemTime()!.getTime(),
  );
  return { usage, readings, kept, source };
}

describe('Usage', () => {
  it('reads the plan limits, keeps each reading and says so', async () => {
    const { usage, readings, kept } = setUp();
    expect(await usage.plan('fake')).toMatchObject({ plan: 'max', windows: [{ used: 10 }] });
    await vi.advanceTimersByTimeAsync(1000);
    await usage.readAll();
    expect(readings.since('fake', 0).map(({ span, used }) => ({ span, used }))).toEqual([
      { span: 'session', used: 10 },
      { span: 'session', used: 11 },
    ]);
    expect(kept.map(([agent, plan]) => [agent, plan.windows[0]!.used])).toEqual([
      ['fake', 10],
      ['fake', 11],
    ]);
    expect(usage.history('fake', 1000).map(({ used }) => used)).toEqual([11]);
  });

  it('shares a read under way with whoever asks meanwhile', async () => {
    const { usage, readings } = setUp();
    const [first, second] = await Promise.all([usage.plan('fake'), usage.plan('fake')]);
    expect(second).toBe(first);
    expect(readings.since('fake', 0)).toHaveLength(1);
  });

  it('fails to read all when any agent fails', async () => {
    const { usage, source } = setUp();
    source.plan = async () => {
      throw new Error('Too many requests');
    };
    await expect(usage.readAll()).rejects.toThrow('Too many requests');
  });

  it('tells the weeks of the limit for all models, the latest last', async () => {
    const { usage, readings } = setUp();
    const week = 7 * 24 * 60 * 60_000;
    vi.setSystemTime(3 * week);
    for (const [at, used] of [
      [0.5 * week, 100],
      [1.5 * week, 40],
      [2.5 * week, 20],
    ] as const) {
      readings.record('fake', {
        plan: 'max',
        windows: [{ span: 'week', used, resetsAt: (Math.floor(at / week) + 1) * week }],
        at,
      });
    }
    expect(usage.weeks('fake', 2).map(({ end, peak }) => [end / week, peak])).toEqual([
      [2, 40],
      [3, 20],
    ]);
  });

  it('has no plan limits, nor where they went, for an agent without a plan', async () => {
    const { usage } = setUp();
    expect(await usage.plan('plain')).toBeNull();
    expect(await usage.breakdown('plain')).toBeNull();
  });
});
