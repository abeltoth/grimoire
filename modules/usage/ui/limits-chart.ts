import type { UsageReading } from '@grimoire/contract';
import type { ChartTable, ChartTick, Column, LinePoint, LineSeries } from './charts';
import {
  DAY,
  HOUR,
  dayKey,
  dayName,
  dayTick,
  limitName,
  percent,
  startOf,
  time,
  weekday,
} from './usage-format';

/** A plan's limits over the last week, drawn. */
export interface LimitsChart {
  /** The week's limit, and any week kept for one model: a step line each, broken where a week starts afresh. */
  week: LineSeries[];
  /** How full each five-hour session got. */
  sessions: Column[];
  from: number;
  to: number;
  ticks: ChartTick[];
  marks: ChartTick[];
  /** A row a day: the busiest session, and the week's share at the day's end. */
  table: ChartTable;
}

/** The week's limits drawn as lines, in this order: all models, then each week kept for one model. */
const WEEK_COLORS = ['var(--gr-chart-4)', 'var(--gr-chart-1)', 'var(--gr-chart-2)'];

/** A five-hour session, and how near together two readings of when it resets may be and still be the same one. */
const SESSION = 5 * HOUR;
const SAME_RESET = 10 * 60_000;

/**
 * A plan's limits over the last week: the week's share as a step line,
 * each new week marked, and how full each five-hour session got. Null
 * with too little read to draw.
 */
export function limitsChart(history: readonly UsageReading[], now: number): LimitsChart | null {
  const from = now - 7 * DAY;
  const shown = history.filter((r) => r.at >= from && r.used !== null);
  // Two readings a minute apart may say 14:59 or 15:00: a reset is to the hour.
  const toHour = (at: number) => Math.round(at / HOUR) * HOUR;

  const weeks = new Map<string, { window: UsageReading; points: LinePoint[] }>();
  const byModel = (a: UsageReading, b: UsageReading) =>
    Number(!!a.model) - Number(!!b.model) || a.at - b.at;
  for (const r of shown.filter((r) => r.span === 'week').sort(byModel)) {
    const key = r.model ?? '';
    const limit = weeks.get(key) ?? { window: r, points: [] };
    weeks.set(key, limit);
    limit.points.push({
      at: r.at,
      value: r.used!,
      ...(r.resetsAt === null ? {} : { run: toHour(r.resetsAt) }),
    });
  }
  // Past three the colours would repeat: the rest stay in the list above.
  const week = [...weeks.values()].slice(0, WEEK_COLORS.length).map((limit, i) => ({
    name: limitName(limit.window),
    color: WEEK_COLORS[i]!,
    points: limit.points,
  }));

  const peaks = new Map<number, { end: number; peak: number }>();
  for (const r of shown) {
    if (r.span !== 'session' || r.resetsAt === null) continue;
    const key = Math.round(r.resetsAt / SAME_RESET);
    const session = peaks.get(key) ?? { end: r.resetsAt, peak: 0 };
    session.peak = Math.max(session.peak, r.used!);
    peaks.set(key, session);
  }
  let labelled = -Infinity;
  let lastDay = '';
  const sessions = [...peaks.values()]
    .filter((session) => session.peak > 0)
    .sort((a, b) => a.end - b.end)
    .map((session, i): Column => {
      const start = session.end - SESSION;
      const day = dayKey(new Date(start));
      // A day's first session names the day, unless the one just named is too near.
      const named = day !== lastDay && i - labelled >= 2;
      lastDay = day;
      if (named) labelled = i;
      return {
        label: named ? dayTick(start) : '',
        name: `${weekday(start)} ${time(start)} to ${time(session.end)}`,
        parts: [session.peak],
      };
    });
  if (!week.some((each) => each.points.length > 1) && !sessions.length) return null;

  const ticks: ChartTick[] = [];
  const rows: { name: string; cells: string[] }[] = [];
  const allModels = shown.filter((r) => r.span === 'week' && !r.model);
  for (const day = startOf(from, 'day'); day.getTime() <= now; day.setDate(day.getDate() + 1)) {
    const start = day.getTime();
    const noon = start + 12 * HOUR;
    if (noon >= from && noon <= now) ticks.push({ at: noon, label: dayTick(noon) });
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const inDay = (r: UsageReading) => r.at >= start && r.at < end.getTime();
    const busiest = Math.max(
      -1,
      ...shown.filter((r) => r.span === 'session' && inDay(r)).map((r) => r.used!),
    );
    const last = allModels.filter(inDay).at(-1);
    // A day nothing was read, such as one the app was closed, has no row.
    if (busiest >= 0 || last) {
      rows.push({
        name: dayName(dayKey(day)),
        cells: [busiest < 0 ? '–' : percent(busiest), last ? percent(last.used!) : '–'],
      });
    }
  }
  const resets = new Set(
    allModels
      .filter((r) => r.resetsAt !== null)
      .map((r) => toHour(r.resetsAt!))
      .filter((at) => at > from && at <= now),
  );
  return {
    week,
    sessions,
    from,
    to: now,
    ticks,
    marks: [...resets].sort((a, b) => a - b).map((at) => ({ at, label: 'New week' })),
    table: { head: ['Busiest session', 'Week at the day’s end'], rows },
  };
}
