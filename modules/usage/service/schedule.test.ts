import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadSchedule } from './schedule';

const MINUTE = 60_000;
const PACE = { idle: 30 * MINUTE, busy: 5 * MINUTE, lately: 10 * MINUTE };

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function setUp(fails = () => false) {
  const reads: number[] = [];
  const schedule = new ReadSchedule(
    async () => {
      reads.push(vi.getMockedSystemTime()!.getTime() / MINUTE);
      if (fails()) throw new Error('Too many requests');
    },
    PACE,
    () => vi.getMockedSystemTime()!.getTime(),
  );
  return { schedule, reads };
}

describe('ReadSchedule', () => {
  it('reads at once, then at the idle pace', async () => {
    const { schedule, reads } = setUp();
    schedule.start();
    await vi.advanceTimersByTimeAsync(61 * MINUTE);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(reads).toEqual([0, 30, 60]);
  });

  it('reads at the busy pace while chats work and lately after, at once if the last read is that old', async () => {
    const { schedule, reads } = setUp();
    schedule.start();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    schedule.busy();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    schedule.busy();
    await vi.advanceTimersByTimeAsync(58 * MINUTE);
    schedule.busy();
    await vi.advanceTimersByTimeAsync(1);
    // Busy at 2 and 12: lately until 22, so the read at 20 is followed 5 minutes on, then 30.
    expect(reads).toEqual([0, 5, 10, 15, 20, 25, 55, 70]);
    schedule.stop();
  });

  it('waits twice as long after each failed read, up to the idle pace', async () => {
    let failing = true;
    const { schedule, reads } = setUp(() => failing);
    schedule.start();
    for (let minute = 0; minute < 70; minute++) {
      if (minute === 45) failing = false;
      schedule.busy();
      await vi.advanceTimersByTimeAsync(MINUTE);
    }
    // 10, 20, then 30 minutes apart; read well again, back to 5.
    expect(reads).toEqual([0, 10, 30, 60, 65, 70]);
    schedule.stop();
  });
});
