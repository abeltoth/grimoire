import type { UsageReading, UsageWeek } from '@grimoire/contract';
import { limitsChart, weekColumns } from './limits-chart';
import { HOUR, onDay } from './usage-format';

const DAY = 24 * HOUR;

describe('limitsChart', () => {
  // Monday 15:00; the week started afresh last Thursday at 15:00, and does again this Thursday.
  const now = new Date(2026, 10, 9, 15).getTime();
  const end = now + 3 * DAY;
  const start = end - 7 * DAY;
  const hours = (n: number) => now - n * HOUR;

  it('has nothing to draw until the week’s limit has been read with when it resets', () => {
    const history: UsageReading[] = [{ at: hours(1), span: 'week', used: 20, resetsAt: null }];
    expect(limitsChart(history, now)).toBeNull();
  });

  it('draws the week under way from reset to reset, all models first, leaving out the week before', () => {
    const history: UsageReading[] = [
      { at: start - DAY, span: 'week', used: 90, resetsAt: start },
      { at: hours(48), span: 'week', used: 10, resetsAt: end },
      { at: hours(48), span: 'week', model: 'Opus', used: 0, resetsAt: null },
      { at: hours(1), span: 'week', used: 40, resetsAt: end + 60_000 },
    ];
    const chart = limitsChart(history, now)!;
    expect([chart.from, chart.to]).toEqual([start, end]);
    expect(chart.week.map((line) => line.name)).toEqual([
      'This week, all models',
      'This week, Opus',
    ]);
    expect(chart.week[0]!.points.map((point) => point.value)).toEqual([10, 40]);
    // A tick at each noon of the week, and now marked.
    expect(chart.ticks).toHaveLength(7);
    expect(chart.marks).toEqual([{ at: now, label: 'Now' }]);
  });

  it('guides with the even pace, and leads the pace so far to when the limit runs out', () => {
    // Four days gone and 80% used: 20% a day, so it runs out a day on, before the reset.
    const history: UsageReading[] = [{ at: now, span: 'week', used: 80, resetsAt: end }];
    const chart = limitsChart(history, now)!;
    expect(chart.guides.map(({ name, from, to }) => [name, from, to])).toEqual([
      ['Even pace', { at: start, value: 0 }, { at: end, value: 100 }],
      ['At this rate', { at: now, value: 80 }, { at: now + DAY, value: 100 }],
    ]);
    expect(chart.forecast).toBe(
      `At this rate, the week’s limit runs out ${onDay(now + DAY, now)}.`,
    );
  });

  it('says where the week ends at the pace so far when it lasts, and nothing too early in the week', () => {
    // Four days gone and 20% used: 5% a day, 35% by the reset.
    const lasting = limitsChart([{ at: now, span: 'week', used: 20, resetsAt: end }], now)!;
    expect(lasting.forecast).toBe('At this rate, you’ll end the week near 35%.');
    expect(lasting.guides[1]!.to).toEqual({ at: end, value: 35 });

    const early = limitsChart(
      [{ at: start + HOUR, span: 'week', used: 5, resetsAt: end }],
      start + HOUR,
    )!;
    expect(early.forecast).toBeNull();
    expect(early.guides.map((guide) => guide.name)).toEqual(['Even pace']);

    const out = limitsChart([{ at: now, span: 'week', used: 100, resetsAt: end }], now)!;
    expect(out.forecast).toBe('The week’s limit is used up.');
  });

  it('finds each session of the week at its peak, and when it ran out', () => {
    const first = hours(20);
    const second = hours(2);
    const history: UsageReading[] = [
      { at: hours(1), span: 'week', used: 30, resetsAt: end },
      { at: hours(23), span: 'session', used: 40, resetsAt: first },
      // A reset read a few seconds off is the same session.
      { at: hours(21), span: 'session', used: 100, resetsAt: first + 30_000 },
      { at: hours(20.5), span: 'session', used: 100, resetsAt: first },
      { at: hours(3), span: 'session', used: 25, resetsAt: second },
      // A session that used nothing isn't drawn.
      { at: hours(1), span: 'session', used: 0, resetsAt: now + 4 * HOUR },
    ];
    expect(limitsChart(history, now)!.sessions).toEqual([
      { start: first - 5 * HOUR, end: first, peak: 100, fullAt: hours(21) },
      { start: second - 5 * HOUR, end: second, peak: 25, fullAt: null },
    ]);
  });
});

describe('weekColumns', () => {
  const now = new Date(2026, 10, 9, 15).getTime();
  const week = (end: number, peak: number, fullAt: number | null = null): UsageWeek => ({
    start: end - 7 * DAY,
    end,
    peak,
    fullAt,
  });

  it('has a column a week, the one under way named so, and none for the week under way alone', () => {
    expect(weekColumns([week(now + DAY, 30)], now)).toEqual([]);
    const columns = weekColumns(
      [week(now - 6 * DAY, 100, now - 7 * DAY), week(now + DAY, 30)],
      now,
    );
    expect(columns.map((column) => [column.label, column.parts])).toEqual([
      [new Date(now - 13 * DAY).toLocaleDateString([], { month: 'short', day: 'numeric' }), [100]],
      ['This week', [30]],
    ]);
    expect(columns[0]!.name).toMatch(/^Week from .+, ran out .+$/);
    expect(columns[1]!.name).toMatch(/, so far$/);
  });
});
