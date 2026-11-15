import type { UsageReading, UsageWeek } from '@grimoire/contract';
import type { ChartTick } from './charts';
import type { ChartGuide, LinePoint, LineSeries } from './lines-chart';
import {
  DAY,
  HOUR,
  dayTick,
  hourName,
  limitName,
  monthDay,
  percent,
  readingName,
  startOf,
  time,
} from './usage-format';

/** A session as it ran: from its first message to the last reading its usage grew by. */
export interface LimitSession {
  start: number;
  end: number;
}

/** The week under way of a plan's limits, drawn from when it started to when it starts afresh. */
export interface LimitsChart {
  /** The week's limit, and any week kept for one model: a step line each. */
  week: LineSeries[];
  /** Where the pace so far leads. */
  guides: ChartGuide[];
  /** The week's sessions, oldest first. */
  sessions: LimitSession[];
  from: number;
  to: number;
  ticks: ChartTick[];
  marks: ChartTick[];
}

/** A limit drawn over time: its lines, any guides and where they lead, and the span drawn. */
export interface LimitLine {
  lines: LineSeries[];
  guides: ChartGuide[];
  from: number;
  to: number;
  ticks: ChartTick[];
  marks: ChartTick[];
}

/** The week's limits drawn as lines, in this order: all models, then each week kept for one model. */
const WEEK_COLORS = ['var(--gr-chart-4)', 'var(--gr-chart-1)', 'var(--gr-chart-2)'];

const WEEK = 7 * DAY;
/** A five-hour session, and how near together two readings of when it resets may be and still be the same one. */
const SESSION = 5 * HOUR;
const SAME_RESET = 10 * 60_000;
/** Less of a week or a session gone than this, and its pace so far says too little to go on. */
const TOO_SOON = { week: 6 * HOUR, session: 30 * 60_000 };
/** A week's line goes through one reading in each stretch this long. */
const STRETCH = 3 * HOUR;

/** Two readings a minute apart may say 14:59 or 15:00: a reset is to the hour. */
const toHour = (at: number) => Math.round(at / HOUR) * HOUR;

/**
 * The week under way of a plan's limits: the week's share as a step line,
 * the pace to keep and the pace so far as guides, and its five-hour
 * sessions. Null until a week's limit has been read.
 */
export function limitsChart(history: readonly UsageReading[], now: number): LimitsChart | null {
  const read = history.filter((r) => r.used !== null);
  const latest = read.filter((r) => r.span === 'week' && !r.model && r.resetsAt !== null).at(-1);
  if (!latest) return null;
  const to = toHour(latest.resetsAt!);
  const from = to - WEEK;
  // A week kept for one model that's unused may not say when it resets.
  const shown = read.filter(
    (r) => r.at >= from && (r.resetsAt === null || toHour(r.resetsAt) > from),
  );

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
  // A week kept for one model that's gone unused says nothing; past three the colours would repeat.
  const week = [...weeks.values()]
    .filter((limit) => !limit.window.model || limit.points.some((point) => point.value > 0))
    .slice(0, WEEK_COLORS.length)
    .map((limit, i) => ({
      name: limitName(limit.window),
      color: WEEK_COLORS[i]!,
      points: limit.window.model
        ? smoothed(limit.points)
        : fromNothing(smoothed(limit.points), from, to),
    }));

  const ticks: ChartTick[] = [];
  for (const day = startOf(from, 'day'); day.getTime() < to; day.setDate(day.getDate() + 1)) {
    const noon = day.getTime() + 12 * HOUR;
    if (noon >= from && noon <= to) ticks.push({ at: noon, label: dayTick(noon) });
  }
  return {
    week,
    guides: pace(latest, from, to, (at) => readingName(at)),
    sessions: sessions(shown, from),
    from,
    to,
    ticks,
    marks: now > from && now < to ? [{ at: now, label: 'Now' }] : [],
  };
}

/**
 * Once enough of a limit is gone, where its pace so far leads: labelled
 * by when it would run out, or by how much would be used as it resets.
 */
function pace(
  latest: UsageReading,
  from: number,
  to: number,
  when: (at: number) => string,
): ChartGuide[] {
  const used = latest.used!;
  const gone = latest.at - from;
  if (used >= 100 || used <= 0 || gone < TOO_SOON[latest.span]) return [];
  const rate = used / gone;
  const fullAt = latest.at + (100 - used) / rate;
  const atEnd = used + rate * (to - latest.at);
  return [
    {
      name: 'At this rate',
      color: WEEK_COLORS[0]!,
      from: { at: latest.at, value: used },
      ...(fullAt <= to
        ? { to: { at: fullAt, value: 100 }, label: when(fullAt) }
        : { to: { at: to, value: atEnd }, label: percent(atEnd) }),
    },
  ];
}

/**
 * The last reading of each stretch of a week, and the latest: read every
 * few minutes, a week's line would follow each pause and burst, where the
 * week's trend is what's drawn.
 */
function smoothed(points: readonly LinePoint[]): LinePoint[] {
  const last = new Map<number, LinePoint>();
  for (const point of points) last.set(Math.floor(point.at / STRETCH), point);
  const kept = [...last.values()];
  const latest = points.at(-1);
  return latest && kept.at(-1) !== latest ? [...kept, latest] : kept;
}

/** A window starts with nothing used: drawn from there, as the readings came later. */
function fromNothing(points: readonly LinePoint[], from: number, run?: number): LinePoint[] {
  const first = points[0];
  if (!first || first.at <= from) return [...points];
  return [{ at: from, value: 0, ...(run === undefined ? {} : { run }) }, ...points];
}

/**
 * Each session that used any of the limit and ended after the week began,
 * oldest first: from its first message, five hours before it resets, to the
 * first reading at the most it used, after which it used no more.
 */
function sessions(shown: readonly UsageReading[], from: number): LimitSession[] {
  const found = new Map<number, LimitSession & { peak: number }>();
  for (const r of shown) {
    if (r.span !== 'session' || r.resetsAt === null) continue;
    const key = Math.round(r.resetsAt / SAME_RESET);
    const start = r.resetsAt - SESSION;
    const session = found.get(key) ?? { start, end: start, peak: 0 };
    if (r.used! > session.peak) {
      session.peak = r.used!;
      session.end = Math.min(r.at, r.resetsAt);
    }
    found.set(key, session);
  }
  return [...found.values()]
    .filter((session) => session.peak > 0 && session.end > from)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end }) => ({ start, end }));
}

/**
 * The five-hour session under way: its share as a step line, from when it
 * began to when it resets, with the pace to keep and the pace so far. Null
 * when no session is under way.
 */
export function sessionChart(history: readonly UsageReading[], now: number): LimitLine | null {
  const read = history.filter(
    (r) => r.span === 'session' && r.used !== null && r.resetsAt !== null,
  );
  const latest = read.at(-1);
  if (!latest || latest.resetsAt! <= now) return null;
  const to = latest.resetsAt!;
  const from = to - SESSION;
  const points = fromNothing(
    read
      .filter((r) => r.at >= from && Math.abs(r.resetsAt! - to) < SAME_RESET)
      .map((r) => ({ at: r.at, value: r.used! })),
    from,
  );
  const ticks: ChartTick[] = [];
  for (let at = Math.ceil(from / HOUR) * HOUR; at <= to; at += HOUR) {
    ticks.push({ at, label: hourName(at) });
  }
  return {
    lines: [{ name: limitName(latest), color: WEEK_COLORS[0]!, points }],
    guides: pace(latest, from, to, time),
    from,
    to,
    ticks,
    marks: [{ at: now, label: 'Now' }],
  };
}

/**
 * How much of each week's limit was used by its end, a point a week, and
 * the week under way so far, dashed. Null until a week has ended.
 */
export function weeksChart(weeks: readonly UsageWeek[], now: number): LimitLine | null {
  const ended = weeks.filter((week) => week.end <= now);
  const last = ended.at(-1);
  if (!last) return null;
  const under = weeks.find((week) => week.end > now);
  const to = under?.start ?? last.start;
  // About six labels, however many weeks, the latest among them.
  const all = under ? [...ended, under] : ended;
  const every = Math.ceil(all.length / 6);
  const ticks = all
    .filter((_, i) => (all.length - 1 - i) % every === 0)
    .map((week) => ({ at: week.start, label: monthDay(week.start) }));
  return {
    lines: [
      {
        name: 'Used by the week’s end',
        color: WEEK_COLORS[0]!,
        points: ended.map((week) => ({ at: week.start, value: week.used })),
      },
    ],
    guides: under
      ? [
          {
            name: 'This week so far',
            label: `${percent(under.used)} so far`,
            color: WEEK_COLORS[0]!,
            from: { at: last.start, value: last.used },
            to: { at: under.start, value: under.used },
          },
        ]
      : [],
    from: ended[0]!.start,
    to,
    ticks,
    marks: [],
  };
}
