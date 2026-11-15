import type { UsageReading } from '@grimoire/contract';
import { limitsChart, sessionChart, weeksChart } from './limits-chart';
import { HOUR, readingName, time } from './usage-format';

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
      { at: hours(48), span: 'week', model: 'Opus', used: 3, resetsAt: null },
      // A model's week gone unused isn't drawn.
      { at: hours(48), span: 'week', model: 'Fable', used: 0, resetsAt: end },
      { at: hours(1), span: 'week', used: 40, resetsAt: end + 60_000 },
    ];
    const chart = limitsChart(history, now)!;
    expect([chart.from, chart.to]).toEqual([start, end]);
    expect(chart.week.map((line) => line.name)).toEqual([
      'This week, all models',
      'This week, Opus',
    ]);
    // Drawn from nothing at the reset, as the first reading came later.
    expect(chart.week[0]!.points.map((point) => point.value)).toEqual([0, 10, 40]);
    expect(chart.week[0]!.points[0]!.at).toBe(start);
    // A tick at each noon of the week, and now marked.
    expect(chart.ticks).toHaveLength(7);
    expect(chart.marks).toEqual([{ at: now, label: 'Now' }]);
  });

  it('draws the week through a reading every few hours, and the latest, so it shows the trend', () => {
    const history: UsageReading[] = [10, 11, 12, 13, 14].map((used, i) => ({
      at: hours(10) + i * 20 * 60_000,
      span: 'week' as const,
      used,
      resetsAt: end,
    }));
    history.push({ at: hours(1), span: 'week', used: 20, resetsAt: end });
    const values = limitsChart(history, now)!.week[0]!.points.map((point) => point.value);
    expect(values.length).toBeLessThan(history.length + 1);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(20);
  });

  it('leads the pace so far to when the limit runs out, named by when', () => {
    // Four days gone and 80% used: 20% a day, so it runs out a day on, before the reset.
    const history: UsageReading[] = [{ at: now, span: 'week', used: 80, resetsAt: end }];
    const chart = limitsChart(history, now)!;
    expect(chart.guides.map(({ name, from, to, label }) => [name, from, to, label])).toEqual([
      [
        'At this rate',
        { at: now, value: 80 },
        { at: now + DAY, value: 100 },
        readingName(now + DAY),
      ],
    ]);
  });

  it('leads the pace so far to the reset when it lasts, and not too early in the week nor once used up', () => {
    // Four days gone and 20% used: 5% a day, 35% by the reset.
    const lasting = limitsChart([{ at: now, span: 'week', used: 20, resetsAt: end }], now)!;
    expect(lasting.guides[0]!.to).toEqual({ at: end, value: 35 });
    expect(lasting.guides[0]!.label).toBe('35%');

    const early = limitsChart(
      [{ at: start + HOUR, span: 'week', used: 5, resetsAt: end }],
      start + HOUR,
    )!;
    expect(early.guides).toEqual([]);

    const out = limitsChart([{ at: now, span: 'week', used: 100, resetsAt: end }], now)!;
    expect(out.guides).toEqual([]);
  });

  it('finds each session of the week from its first message to when it last used more', () => {
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
      { start: first - 5 * HOUR, end: hours(21) },
      { start: second - 5 * HOUR, end: hours(3) },
    ]);
  });
});

describe('sessionChart', () => {
  const now = new Date(2026, 10, 9, 15).getTime();
  const end = now + 2 * HOUR;

  it('draws the session under way from when it began to when it resets, with where its pace leads', () => {
    const history: UsageReading[] = [
      // The session before: left out.
      { at: now - 6 * HOUR, span: 'session', used: 90, resetsAt: now - 3 * HOUR },
      // A reset read a few seconds off is the same session.
      { at: now - 2 * HOUR, span: 'session', used: 10, resetsAt: end + 30_000 },
      { at: now - HOUR, span: 'week', used: 30, resetsAt: now + DAY },
      { at: now, span: 'session', used: 60, resetsAt: end },
    ];
    const chart = sessionChart(history, now)!;
    expect([chart.from, chart.to]).toEqual([end - 5 * HOUR, end]);
    expect(chart.lines[0]!.points.map((point) => point.value)).toEqual([0, 10, 60]);
    // A tick each hour, and now marked.
    expect(chart.ticks).toHaveLength(6);
    expect(chart.marks).toEqual([{ at: now, label: 'Now' }]);
    // Three hours gone and 60% used: it runs out in two, as it resets.
    expect(chart.guides[0]!.to).toEqual({ at: end, value: 100 });
    expect(chart.guides[0]!.label).toBe(time(end));
  });

  it('has nothing to draw when no session is under way', () => {
    const over: UsageReading[] = [
      { at: now - 4 * HOUR, span: 'session', used: 30, resetsAt: now - HOUR },
    ];
    expect(sessionChart(over, now)).toBeNull();
    expect(sessionChart([], now)).toBeNull();
  });
});

describe('weeksChart', () => {
  const now = new Date(2026, 10, 9, 15).getTime();
  const week = 7 * DAY;
  const ended = (weeksAgo: number, used: number) => ({
    start: now - weeksAgo * week - DAY,
    end: now - (weeksAgo - 1) * week - DAY,
    used,
  });

  it('draws how much of each week ended was used, a point where each began, and the week under way so far', () => {
    const chart = weeksChart(
      [
        ended(3, 70),
        ended(2, 100),
        ended(1, 40),
        { start: now - DAY, end: now + 6 * DAY, used: 5 },
      ],
      now,
    )!;
    expect(chart.lines[0]!.points).toEqual([
      { at: now - 3 * week - DAY, value: 70 },
      { at: now - 2 * week - DAY, value: 100 },
      { at: now - week - DAY, value: 40 },
    ]);
    expect(chart.guides.map(({ from, to, label }) => [from, to, label])).toEqual([
      [{ at: now - week - DAY, value: 40 }, { at: now - DAY, value: 5 }, '5% so far'],
    ]);
    expect([chart.from, chart.to]).toEqual([now - 3 * week - DAY, now - DAY]);
    expect(chart.ticks).toHaveLength(4);
  });

  it('labels about six weeks of many, the latest among them', () => {
    const many = Array.from({ length: 52 }, (_, i) => ended(52 - i, 50));
    const ticks = weeksChart(many, now)!.ticks;
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(ticks.at(-1)!.at).toBe(now - week - DAY);
  });

  it('draws from the first week ended, and nothing before', () => {
    const under = { start: now - DAY, end: now + 6 * DAY, used: 5 };
    expect(weeksChart([ended(1, 40), under], now)!.lines[0]!.points).toHaveLength(1);
    expect(weeksChart([under], now)).toBeNull();
  });
});
