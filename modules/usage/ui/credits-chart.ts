import type { SpendReading, UsageCredits, UsageMonth } from '@grimoire/contract';
import { type Column, niceTicks } from './charts';
import { type LimitLine, fromNothing, smoothed } from './limits-chart';
import { DAY, dayKey, dayName, money, monthDay, startOf, wholeMoney } from './usage-format';

/** A line of money: its scale's top, and how its amounts are written. */
export interface MoneyLine extends LimitLine {
  max: number;
  format: (minor: number) => string;
}

/** The month under way of usage credits: spent over it, by day, and what's left to spend a day. */
export interface SpendCharts {
  month: MoneyLine;
  /** A column a day, from the month's first to today. */
  days: Column[];
  /** What can be spent each day left to last the month; null without a limit, or with none left. */
  budget: { value: number; label: string } | null;
  format: (minor: number) => string;
}

/** Less of the month gone than this, and its pace so far says too little to go on. */
const TOO_SOON = DAY;

const COLOR = 'var(--gr-chart-4)';

/** The first moment of the local month a time falls in. */
export function monthStart(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** A month, such as "Nov 2026". */
export const monthName = (at: number) =>
  new Date(at).toLocaleDateString([], { month: 'short', year: 'numeric' });

/**
 * The month under way of usage credits, from the readings of it: what was
 * spent over it with where its pace leads, what each day cost as the
 * difference across it, and what's left to spend a day. Null with none read.
 */
export function spendCharts(
  readings: readonly SpendReading[],
  credits: UsageCredits,
  now: number,
): SpendCharts | null {
  const from = monthStart(now);
  const to = credits.resetsAt;
  const read = readings.filter((r) => r.at >= from && r.currency === credits.currency);
  const latest = read.at(-1);
  if (!latest) return null;
  const limit = credits.limit;
  const format = (minor: number) => money(minor, credits.currency);
  const whole = (minor: number) => wholeMoney(minor, credits.currency);

  const gone = latest.at - from;
  const rate = gone >= TOO_SOON && latest.spent > 0 ? latest.spent / gone : null;
  const atEnd = rate === null ? null : latest.spent + rate * (to - latest.at);
  const fullAt = rate === null || limit === null ? null : latest.at + (limit - latest.spent) / rate;
  const guides =
    rate === null || (limit !== null && latest.spent >= limit)
      ? []
      : [
          {
            name: 'At this rate',
            color: COLOR,
            from: { at: latest.at, value: latest.spent },
            ...(fullAt !== null && fullAt <= to
              ? { to: { at: fullAt, value: limit! }, label: monthDay(fullAt) }
              : { to: { at: to, value: atEnd! }, label: whole(atEnd!) }),
          },
        ];
  const ticks = [];
  for (let day = new Date(from); day.getTime() < to; day.setDate(day.getDate() + 7)) {
    ticks.push({ at: day.getTime(), label: monthDay(day.getTime()) });
  }

  const today = startOf(now, 'day').getTime();
  const left = limit === null ? 0 : limit - latest.spent;
  const daysLeft = Math.max(Math.ceil((to - today) / DAY), 1);
  return {
    month: {
      lines: [
        {
          name: 'Spent this month',
          color: COLOR,
          points: fromNothing(smoothed(read.map((r) => ({ at: r.at, value: r.spent }))), from),
        },
      ],
      guides,
      from,
      to,
      ticks,
      marks: [{ at: now, label: 'Now' }],
      max: limit ?? niceTicks(Math.max(latest.spent, atEnd ?? 0)).at(-1)!,
      format: whole,
    },
    days: days(read, from, now),
    budget:
      left > 0
        ? { value: left / daysLeft, label: `${format(left / daysLeft)} a day to last the month` }
        : null,
    format,
  };
}

/**
 * What each day of the month so far cost: the spend read by its end less
 * that read by the day before's. Nothing is known before the first
 * reading, so unless that came on the month's first day, it counts from there.
 */
function days(read: readonly SpendReading[], from: number, now: number): Column[] {
  const first = read[0]!;
  let before = startOf(first.at, 'day').getTime() === from ? 0 : first.spent;
  const columns: Column[] = [];
  for (const day = new Date(from); day.getTime() <= now; day.setDate(day.getDate() + 1)) {
    const start = day.getTime();
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const last = read.filter((r) => r.at < end).at(-1);
    const spent = last && last.at >= start ? Math.max(last.spent - before, 0) : 0;
    if (last) before = Math.max(before, last.spent);
    columns.push({
      label: (day.getDate() - 1) % 7 === 0 ? String(day.getDate()) : '',
      name: dayName(dayKey(day)),
      parts: [spent],
    });
  }
  return columns;
}

/**
 * What each month of usage credits cost, a point a month, and the month
 * under way so far, dashed: those in the currency of the latest. Null
 * until a month has ended.
 */
export function monthsChart(months: readonly UsageMonth[], now: number): MoneyLine | null {
  const currency = months.at(-1)?.currency;
  const same = months.filter((month) => month.currency === currency);
  const current = monthStart(now);
  const ended = same.filter((month) => month.start < current);
  const last = ended.at(-1);
  if (!last || !currency) return null;
  const under = same.find((month) => month.start === current);
  const whole = (minor: number) => wholeMoney(minor, currency);
  const all = under ? [...ended, under] : ended;
  const every = Math.ceil(all.length / 6);
  const top = niceTicks(Math.max(...all.map((month) => Math.max(month.spent, month.limit ?? 0))));
  return {
    lines: [
      {
        name: 'Spent in the month',
        color: COLOR,
        points: ended.map((month) => ({ at: month.start, value: month.spent })),
      },
    ],
    guides: under
      ? [
          {
            name: 'This month so far',
            label: `${whole(under.spent)} so far`,
            color: COLOR,
            from: { at: last.start, value: last.spent },
            to: { at: under.start, value: under.spent },
          },
        ]
      : [],
    from: ended[0]!.start,
    to: under?.start ?? last.start,
    ticks: all
      .filter((_, i) => (all.length - 1 - i) % every === 0)
      .map((month) => ({ at: month.start, label: monthName(month.start) })),
    marks: [],
    max: top.at(-1)!,
    format: whole,
  };
}
