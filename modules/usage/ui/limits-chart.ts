import type { UsageReading } from '@grimoire/contract';
import type { ChartTick } from './charts';
import type { ChartGuide, LinePoint, LineSeries } from './lines-chart';
import { DAY, HOUR, dayTick, hourName, limitName, onDay, percent, startOf } from './usage-format';

/** A five-hour session: when it ran, the most of it used, and when it was first read full. */
export interface LimitSession {
  start: number;
  end: number;
  peak: number;
  fullAt: number | null;
}

/** The week under way of a plan's limits, drawn from when it started to when it starts afresh. */
export interface LimitsChart {
  /** The week's limit, and any week kept for one model: a step line each. */
  week: LineSeries[];
  /** The pace that would use the week up just as it ends, and where the pace so far leads. */
  guides: ChartGuide[];
  /** Where the pace so far leads, in a sentence; null with too little read to say. */
  forecast: string | null;
  /** The week's five-hour sessions, oldest first. */
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
  /** Where the pace so far leads, in a sentence; null with too little read to say. */
  forecast: string | null;
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
  // Past three the colours would repeat: the rest stay in the list above.
  const week = [...weeks.values()].slice(0, WEEK_COLORS.length).map((limit, i) => ({
    name: limitName(limit.window),
    color: WEEK_COLORS[i]!,
    points: limit.points,
  }));

  const ticks: ChartTick[] = [];
  for (const day = startOf(from, 'day'); day.getTime() < to; day.setDate(day.getDate() + 1)) {
    const noon = day.getTime() + 12 * HOUR;
    if (noon >= from && noon <= to) ticks.push({ at: noon, label: dayTick(noon) });
  }
  const { guides, forecast } = pace(latest, from, to, now, 'week');
  return {
    week,
    guides,
    forecast,
    sessions: sessions(shown, from),
    from,
    to,
    ticks,
    marks: now > from && now < to ? [{ at: now, label: 'Now' }] : [],
  };
}

/** The pace that uses a limit up just as it resets, and, once enough of it is gone, where the pace so far leads. */
function pace(
  latest: UsageReading,
  from: number,
  to: number,
  now: number,
  span: UsageReading['span'],
): { guides: ChartGuide[]; forecast: string | null } {
  const guides: ChartGuide[] = [
    {
      name: 'Even pace',
      color: 'var(--gr-ink-soft)',
      from: { at: from, value: 0 },
      to: { at: to, value: 100 },
    },
  ];
  const used = latest.used!;
  const gone = latest.at - from;
  if (used >= 100) return { guides, forecast: `The ${span}’s limit is used up.` };
  if (gone < TOO_SOON[span] || used <= 0) return { guides, forecast: null };
  const rate = used / gone;
  const fullAt = latest.at + (100 - used) / rate;
  const reaches = fullAt <= to;
  const atEnd = used + rate * (to - latest.at);
  guides.push({
    name: 'At this rate',
    color: WEEK_COLORS[0]!,
    from: { at: latest.at, value: used },
    to: reaches ? { at: fullAt, value: 100 } : { at: to, value: atEnd },
  });
  return {
    guides,
    forecast: reaches
      ? `At this rate, the ${span}’s limit runs out ${onDay(fullAt, now)}.`
      : `At this rate, you’ll end the ${span} near ${percent(atEnd)}.`,
  };
}

/** Each five-hour session that used any of the limit and ended after the week began, oldest first. */
function sessions(shown: readonly UsageReading[], from: number): LimitSession[] {
  const found = new Map<number, LimitSession>();
  for (const r of shown) {
    if (r.span !== 'session' || r.resetsAt === null) continue;
    const key = Math.round(r.resetsAt! / SAME_RESET);
    const session = found.get(key) ?? {
      start: r.resetsAt! - SESSION,
      end: r.resetsAt!,
      peak: 0,
      fullAt: null,
    };
    session.peak = Math.max(session.peak, r.used!);
    if (r.used! >= 100 && (session.fullAt === null || r.at < session.fullAt)) session.fullAt = r.at;
    found.set(key, session);
  }
  return [...found.values()]
    .filter((session) => session.peak > 0 && session.end > from)
    .sort((a, b) => a.start - b.start);
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
  const points = read
    .filter((r) => r.at >= from && Math.abs(r.resetsAt! - to) < SAME_RESET)
    .map((r) => ({ at: r.at, value: r.used! }));
  const ticks: ChartTick[] = [];
  for (let at = Math.ceil(from / HOUR) * HOUR; at <= to; at += HOUR) {
    ticks.push({ at, label: hourName(at) });
  }
  return {
    lines: [{ name: limitName(latest), color: WEEK_COLORS[0]!, points }],
    ...pace(latest, from, to, now, 'session'),
    from,
    to,
    ticks,
    marks: [{ at: now, label: 'Now' }],
  };
}

/**
 * The limit for all models over the last `weeks` weeks: a step line each
 * week, broken where it started afresh. Null with less than two weeks read,
 * as the week under way alone is drawn above.
 */
export function weeksChart(
  history: readonly UsageReading[],
  now: number,
  weeks: number,
): LimitLine | null {
  const from = now - weeks * WEEK;
  const read = history.filter(
    (r) => r.span === 'week' && !r.model && r.used !== null && r.resetsAt !== null && r.at >= from,
  );
  const runs = new Set(read.map((r) => toHour(r.resetsAt!)));
  if (runs.size < 2) return null;
  const points = read.map((r) => ({ at: r.at, value: r.used!, run: toHour(r.resetsAt!) }));
  // A tick where each week began.
  const ticks = [...runs]
    .map((end) => end - WEEK)
    .filter((start) => start >= from)
    .map((start) => ({ at: start, label: dayTick(start) }));
  return {
    lines: [{ name: limitName(read[0]!), color: WEEK_COLORS[0]!, points }],
    guides: [],
    forecast: null,
    from,
    to: now,
    ticks,
    marks: [],
  };
}
