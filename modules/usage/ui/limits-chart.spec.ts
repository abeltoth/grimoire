import type { UsageReading } from '@grimoire/contract';
import { limitsChart } from './limits-chart';
import { dayKey, dayName, HOUR } from './usage-format';

describe('limitsChart', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  const minutes = (n: number) => now - n * 60_000;

  it('has nothing to draw from a single reading of the week and no session', () => {
    const history: UsageReading[] = [{ at: minutes(10), span: 'week', used: 20, resetsAt: null }];
    expect(limitsChart(history, now)).toBeNull();
  });

  it("draws the week's limits as a line each, all models first, and each session's peak", () => {
    const nextWeek = now + 4 * 24 * HOUR;
    const session = minutes(100);
    const history: UsageReading[] = [
      { at: minutes(300), span: 'week', model: 'Opus', used: 5, resetsAt: null },
      { at: minutes(300), span: 'week', used: 15, resetsAt: nextWeek },
      { at: minutes(300), span: 'session', used: 10, resetsAt: session },
      // A reset read a few seconds off is the same session.
      { at: minutes(285), span: 'session', used: 60, resetsAt: session + 30_000 },
      { at: minutes(15), span: 'week', used: 20, resetsAt: nextWeek },
      // Older than the week: left out.
      { at: minutes(8 * 24 * 60), span: 'week', used: 90, resetsAt: null },
    ];
    const chart = limitsChart(history, now)!;
    expect(chart.week.map((line) => line.name)).toEqual([
      'This week, all models',
      'This week, Opus',
    ]);
    expect(chart.week[0]!.points.map((point) => point.value)).toEqual([15, 20]);
    expect(chart.sessions.map((column) => column.parts)).toEqual([[60]]);
    expect(chart.from).toBe(now - 7 * 24 * HOUR);
    expect(chart.to).toBe(now);
    // A tick at each noon of the week, and no week started afresh within it.
    expect(chart.ticks).toHaveLength(7);
    expect(chart.marks).toEqual([]);
    expect(chart.table.rows).toEqual([
      { name: dayName(dayKey(new Date(now))), cells: ['60%', '20%'] },
    ]);
  });

  it('marks where a week started afresh', () => {
    const lastWeek = minutes(3 * 24 * 60);
    const history: UsageReading[] = [
      { at: minutes(4 * 24 * 60), span: 'week', used: 90, resetsAt: lastWeek },
      { at: minutes(15), span: 'week', used: 20, resetsAt: now + 4 * 24 * HOUR },
    ];
    const chart = limitsChart(history, now)!;
    expect(chart.marks).toEqual([{ at: Math.round(lastWeek / HOUR) * HOUR, label: 'New week' }]);
  });
});
