import type { SpendReading, UsageCredits, UsageMonth } from '@grimoire/contract';
import { monthName, monthsChart, spendCharts } from './credits-chart';
import { money, monthDay, wholeMoney } from './usage-format';

const DAY = 24 * 60 * 60_000;

describe('spendCharts', () => {
  // The 11th at noon, the month resets on December 1st.
  const now = new Date(2026, 10, 11, 12).getTime();
  const credits = (limit: number | null): UsageCredits => ({
    spent: 0,
    limit,
    currency: 'USD',
    used: null,
    resetsAt: new Date(2026, 11, 1).getTime(),
  });
  const read = (day: number, hour: number, spent: number): SpendReading => ({
    at: new Date(2026, 10, day, hour).getTime(),
    spent,
    limit: 60000,
    currency: 'USD',
  });

  it('draws the month from nothing, and where its pace leads by the day it runs out', () => {
    // $400 in 10.5 days: $600 runs out about the 16th.
    const charts = spendCharts([read(1, 9, 1000), read(11, 12, 40000)], credits(60000), now)!;
    expect(charts.month.lines[0]!.points.map((point) => point.value)).toEqual([0, 1000, 40000]);
    expect(charts.month.max).toBe(60000);
    const [guide] = charts.month.guides;
    expect(guide!.to.value).toBe(60000);
    expect(guide!.label).toBe(monthDay(guide!.to.at));
    expect(new Date(guide!.to.at).getDate()).toBe(16);
  });

  it('ends the pace at the month’s end, by the amount, when it lasts or has no limit', () => {
    // $100 in 10 days: $300 by December 1st, 20 days on.
    const charts = spendCharts([read(11, 0, 10000)], credits(null), now)!;
    expect(charts.month.guides[0]!.label).toBe(wholeMoney(30000, 'USD'));
    expect(charts.budget).toBeNull();
    expect(charts.month.max).toBeGreaterThanOrEqual(30000);
  });

  it('tells what each day cost as the difference across it, and what’s left to spend a day', () => {
    const charts = spendCharts(
      [read(9, 10, 5000), read(9, 20, 6000), read(10, 9, 6000), read(11, 9, 9000)],
      credits(60000),
      now,
    )!;
    // Read first on the 9th: nothing known before it, so the days before cost nothing seen.
    expect(charts.days.map((day) => day.parts[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1000, 0, 3000]);
    expect(charts.days[0]!.label).toBe('1');
    expect(charts.days[7]!.label).toBe('8');
    // $510 left over the 20 days from today.
    expect(charts.budget).toEqual({
      value: 2550,
      label: `${money(2550, 'USD')} a day to last the month`,
    });
  });

  it('has nothing to draw with nothing read this month', () => {
    expect(spendCharts([read(1, 9, 100)], credits(60000), now + 31 * DAY)).toBeNull();
  });
});

describe('monthsChart', () => {
  const now = new Date(2026, 10, 11, 12).getTime();
  const month = (index: number, spent: number): UsageMonth => ({
    start: new Date(2026, index, 1).getTime(),
    spent,
    limit: 60000,
    currency: 'USD',
  });

  it('draws what each month ended cost, and the month under way so far, dashed', () => {
    const chart = monthsChart([month(8, 52000), month(9, 60000), month(10, 9000)], now)!;
    expect(chart.lines[0]!.points.map((point) => point.value)).toEqual([52000, 60000]);
    expect(chart.guides[0]!.label).toBe(`${wholeMoney(9000, 'USD')} so far`);
    expect(chart.max).toBe(60000);
    expect(chart.ticks.map((tick) => tick.label)).toEqual(
      [8, 9, 10].map((index) => monthName(new Date(2026, index, 1).getTime())),
    );
  });

  it('has nothing to draw until a month has ended', () => {
    expect(monthsChart([month(10, 9000)], now)).toBeNull();
    expect(monthsChart([], now)).toBeNull();
  });
});
