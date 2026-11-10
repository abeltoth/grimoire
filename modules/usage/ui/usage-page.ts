import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type {
  AgentInfo,
  PlanUsage,
  TokenCounts,
  TokenTotal,
  TokenTotals,
  UsageBreakdown,
  UsageCredits,
  UsageReading,
  UsageSpan,
  UsageWindow,
  Used,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';
import { countsInWords, modelLabel, tokenCount } from '@ui/app/core/tokens';
import {
  type ChartSeries,
  type ChartTable,
  type ChartTick,
  type Column,
  UsageColumns,
  UsageLines,
  type LinePoint,
  type LineSeries,
} from './charts';

/** An agent with a plan, how much of its limits is used, and how much was over the last week. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
  /** Its limits over the last week; null with too little read to draw. */
  chart: LimitsChart | null;
}

/** A plan's limits over the last week, drawn. */
interface LimitsChart {
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

/** Where the tokens went over the span, a column or point for each day or hour. */
interface TokensCharts {
  /** "Tokens by day" or "Tokens by hour". */
  caption: string;
  columns: Column[];
  cache: LineSeries[];
  from: number;
  to: number;
  ticks: ChartTick[];
  /** A bucket's length, in ms: a gap of more than that breaks the line. */
  bucket: number;
}

/** An agent's own word on where its plan's usage went. */
interface Breakdown {
  agent: AgentInfo;
  breakdown: UsageBreakdown;
}

/** The spans where the tokens went is shown over, as Claude Code's scan reads them. */
type Span = 'day' | 'week';

/** The Usage page's views. */
type View = 'limits' | 'tokens' | 'tools';

const VIEWS: Record<View, string> = {
  limits: 'Limits',
  tokens: 'Where it went',
  tools: 'Tools & skills',
};

/** What Grimoire's count can be grouped by. */
type Group = 'day' | 'model' | 'folder' | 'chat';

const GROUPS: Record<Group, string> = {
  day: 'Day',
  model: 'Model',
  folder: 'Folder',
  chat: 'Chat',
};

const SHOWN = 5;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** The parts a column of tokens is stacked from, bottom first, each weighed as the API prices it. */
const TOKEN_SERIES: (ChartSeries & { weigh: (counts: TokenCounts) => number })[] = [
  { name: 'Read from the cache', color: 'var(--gr-chart-1)', weigh: (c) => c.cacheRead * 0.1 },
  {
    name: 'Written to the cache',
    color: 'var(--gr-chart-2)',
    weigh: (c) => c.cacheWritten * 1.25 + c.cacheWrittenLong * 2,
  },
  { name: 'Fresh input', color: 'var(--gr-chart-3)', weigh: (c) => c.input },
  { name: 'Output', color: 'var(--gr-chart-4)', weigh: (c) => c.output * 5 },
];
const TOKEN_LEGEND: ChartSeries[] = TOKEN_SERIES.map(({ name, color }) => ({ name, color }));

/** The week's limits drawn as lines, in this order: all models, then each week kept for one model. */
const WEEK_COLORS = ['var(--gr-chart-4)', 'var(--gr-chart-1)', 'var(--gr-chart-2)'];
const SESSION_SERIES: ChartSeries[] = [{ name: 'Peak of the session', color: 'var(--gr-chart-3)' }];

/** A five-hour session, and how near together two readings of when it resets may be and still be the same one. */
const SESSION = 5 * HOUR;
const SAME_RESET = 10 * 60_000;

/** The start of the local day or hour a time falls in. */
function startOf(at: number, unit: 'day' | 'hour'): Date {
  const date = new Date(at);
  if (unit === 'day') date.setHours(0, 0, 0, 0);
  else date.setMinutes(0, 0, 0);
  return date;
}

/** A local day as YYYY-MM-DD, as the totals name it. */
function dayKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The share of the input read from the cache, in percent; null with no input. */
function cacheShare(c: TokenCounts): number | null {
  const all = c.input + c.cacheWritten + c.cacheWrittenLong + c.cacheRead;
  return all ? (c.cacheRead / all) * 100 : null;
}

const weekday = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'short' });
/** A day on a chart's axis, such as "Sat 31": a week back is the same weekday as today. */
const dayTick = (at: number) => `${weekday(at)} ${new Date(at).getDate()}`;
const hourName = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric' });
const SPANS: Record<Span, { label: string; ms: number }> = {
  day: { label: 'Last 24 hours', ms: 24 * HOUR },
  week: { label: 'Last 7 days', ms: 7 * 24 * HOUR },
};

/** Claude Code's ways of working, as its usage scan names them, in plain words. */
const BEHAVIOURS: Record<string, string> = {
  cache_miss: 'Going on after the prompt cache ran out',
  long_context: 'Long context',
  subagent_heavy: 'Many subagents',
  high_parallel: 'Many chats at once',
  cron: 'Chats left running for hours',
  max_effort: 'Max effort',
  workflow: 'Workflows',
  always_on_context: 'What loads into every chat',
  large_tool_results: 'Large tool results',
};

const SOURCES: Record<UsageSpan['sources'][number]['kind'], string> = {
  agent: 'subagent',
  skill: 'skill',
  plugin: 'plugin',
  mcp: 'MCP server',
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** An amount in the currency's minor units, such as 12345 cents, written as money: "$123.45". */
export function money(minor: number, currency: string): string {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat([], { style: 'currency', currency });
  } catch {
    // A code Intl doesn't know: assume cents, and name the currency.
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits);
}

/**
 * The Usage page: how much of each agent's subscription limits is used, read
 * from the agent when the page opens, each limit with when it resets; and
 * where the tokens went, as the agent's own scan says and by Grimoire's
 * count from the chats' transcripts, with the tools and skills used most.
 */
@Component({
  selector: 'gr-usage-page',
  imports: [NgTemplateOutlet, UsageColumns, UsageLines],
  templateUrl: './usage-page.html',
  styleUrl: './usage-page.css',
})
export class UsagePage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly pending = inject(PendingTasks);
  protected readonly wording = inject(Wording);

  /** The agents with a plan; undefined until they've answered. */
  protected readonly plans = signal<Plan[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);

  protected readonly groups = Object.entries(GROUPS) as [Group, string][];
  protected readonly group = signal<Group>('day');
  protected readonly views = Object.entries(VIEWS) as [View, string][];
  protected readonly view = signal<View>('limits');
  /** How many rows a list shows before "Show all". */
  protected readonly shown = SHOWN;
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly spans = Object.entries(SPANS) as [Span, { label: string; ms: number }][];
  protected readonly span = signal<Span>('week');
  /** Grimoire's count over the span; undefined until it's read. */
  protected readonly totals = signal<TokenTotals | undefined>(undefined);
  protected readonly totalsFailed = signal<string | null>(null);
  /** What the agents say of their usage; undefined until they've answered. */
  protected readonly breakdowns = signal<Breakdown[] | undefined>(undefined);
  protected readonly breakdownsFailed = signal<string | null>(null);
  protected readonly readingTokens = signal(false);

  protected readonly tokenSeries = TOKEN_LEGEND;

  /** Where the tokens went over the span, a column and a point for each day, or each hour of the last 24. */
  protected readonly tokensCharts = computed((): TokensCharts | null => {
    const totals = this.totals();
    if (!totals?.total.weight) return null;
    const unit = this.span() === 'day' ? 'hour' : 'day';
    const byDay = new Map(totals.days.map((day) => [day.day, day]));
    const byHour = new Map(totals.hours.map((hour) => [hour.hour, hour]));
    const columns: Column[] = [];
    const cache: { at: number; value: number }[] = [];
    const ticks: ChartTick[] = [];
    const now = Date.now();
    const from = startOf(totals.since, unit).getTime();
    let to = from;
    for (const at = new Date(from); at.getTime() <= now;) {
      const start = at.getTime();
      const total = unit === 'day' ? byDay.get(dayKey(at)) : byHour.get(start);
      if (unit === 'day') at.setDate(at.getDate() + 1);
      else at.setHours(at.getHours() + 1);
      to = at.getTime();
      const middle = (start + to) / 2;
      const label =
        unit === 'day' ? dayTick(start) : new Date(start).getHours() % 6 ? '' : hourName(start);
      columns.push({
        label,
        name: unit === 'day' ? this.dayName(dayKey(new Date(start))) : this.hourSpan(start, to),
        parts: TOKEN_SERIES.map((series) => (total ? series.weigh(total) : 0)),
      });
      if (label) ticks.push({ at: middle, label });
      const share = total ? cacheShare(total) : null;
      if (share !== null) cache.push({ at: middle, value: share });
    }
    const bucket = unit === 'day' ? DAY : HOUR;
    return {
      caption: unit === 'day' ? 'Tokens by day' : 'Tokens by hour',
      columns,
      cache: [{ name: 'Served from the cache', color: 'var(--gr-chart-1)', points: cache }],
      from,
      to,
      ticks,
      bucket,
    };
  });

  /** A moment of a day or hour, for the tooltip and table of the cache chart. */
  protected readonly bucketName = (at: number): string =>
    this.span() === 'day'
      ? this.hourSpan(startOf(at, 'hour').getTime(), startOf(at, 'hour').getTime() + HOUR)
      : this.dayName(dayKey(new Date(at)));

  /** A reading's moment, such as "Thu 2:15 PM". */
  protected readonly readingName = (at: number): string =>
    `${weekday(at)} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  protected readonly sessionSeries = SESSION_SERIES;
  /** A week's line holds across the hours nothing was read: its share only grows until it starts afresh. */
  protected readonly weekApart = 7 * DAY;
  protected readonly percent = (n: number): string => `${Math.round(n)}%`;
  protected readonly tokenFormat = (n: number): string => tokenCount(n);

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.catalog.agents().length)
        untracked(() => {
          void this.read();
          void this.readTokens();
        });
    });
  }

  /** Reads where the tokens went again: Grimoire's count, and what the agents say. */
  protected async readTokens(): Promise<void> {
    if (this.readingTokens()) return;
    this.readingTokens.set(true);
    const done = this.pending.add();
    try {
      await Promise.all([this.readTotals(), this.readBreakdowns()]);
    } finally {
      this.readingTokens.set(false);
      done();
    }
  }

  protected async showSpan(span: Span): Promise<void> {
    if (span === this.span()) return;
    this.span.set(span);
    const done = this.pending.add();
    try {
      await this.readTotals();
    } finally {
      done();
    }
  }

  private async readTotals(): Promise<void> {
    const span = this.span();
    this.totalsFailed.set(null);
    try {
      const totals = await this.bridge.invoke('search.tokens', {
        since: Date.now() - SPANS[span].ms,
      });
      if (span === this.span()) this.totals.set(totals);
    } catch (error) {
      this.totalsFailed.set(error instanceof Error ? error.message : String(error));
    }
  }

  private async readBreakdowns(): Promise<void> {
    this.breakdownsFailed.set(null);
    try {
      const agents = this.catalog.agents();
      const answers = await Promise.all(
        agents.map((agent) => this.bridge.invoke('usage.breakdown', { agent: agent.id })),
      );
      this.breakdowns.set(
        agents.flatMap((agent, i) => {
          const breakdown = answers[i];
          return breakdown ? [{ agent, breakdown }] : [];
        }),
      );
    } catch (error) {
      this.breakdownsFailed.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** The first few of a list, or all of it once opened. */
  protected top<T>(list: readonly T[], key: string): readonly T[] {
    return this.open().has(key) ? list : list.slice(0, SHOWN);
  }

  protected isOpen(key: string): boolean {
    return this.open().has(key);
  }

  protected toggle(key: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected behaviourName(key: string): string {
    return BEHAVIOURS[key] ?? key.replace(/_/g, ' ');
  }

  protected sourceKind(kind: UsageSpan['sources'][number]['kind']): string {
    return SOURCES[kind];
  }

  protected count(n: number): string {
    return tokenCount(n);
  }

  protected inWords(total: TokenTotal): string {
    return countsInWords(total);
  }

  /** A share of the span's weight, 0-100. */
  protected shareOf(total: TokenTotal): number {
    const all = this.totals()?.total.weight ?? 0;
    return all ? (total.weight / all) * 100 : 0;
  }

  /** How many times something was used, such as "12 uses". */
  protected uses(n: number): string {
    return `${n.toLocaleString()} ${n === 1 ? 'use' : 'uses'}`;
  }

  /** Its uses against those of the most used in its list, 0-100. */
  protected againstMost(used: Used, of: readonly Used[]): number {
    const most = Math.max(0, ...of.map((each) => each.uses));
    return most ? (used.uses / most) * 100 : 0;
  }

  protected modelName(model: string, subagent: boolean): string {
    return subagent ? `Subagents on ${modelLabel(model)}` : modelLabel(model);
  }

  protected folderName(cwd: string): string {
    return this.catalog.folderName(cwd);
  }

  /** A day, such as "Thursday, November 5". */
  protected dayName(day: string): string {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year!, month! - 1, date!).toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  protected openChat({ id, agent, title, cwd }: TokenTotals['chats'][number]): void {
    void this.list.openChat({
      id,
      agent,
      title,
      ...(cwd ? { cwd } : {}),
      updatedAt: 0,
    });
  }

  protected async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.catalog.agents();
      const since = Date.now() - 7 * DAY;
      const answers = await Promise.all(
        agents.map(async (agent) => {
          const usage = await this.bridge.invoke('usage.plan', { agent: agent.id });
          if (!usage) return null;
          // Read after the limits, so the history has this reading too.
          const history =
            (await this.bridge.invoke('usage.history', { agent: agent.id, since })) ?? [];
          return { usage, history };
        }),
      );
      const now = Date.now();
      this.plans.set(
        agents.flatMap((agent, i) => {
          const answer = answers[i];
          return answer
            ? [{ agent, usage: answer.usage, chart: this.limitsChart(answer.history, now) }]
            : [];
        }),
      );
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.reading.set(false);
      done();
    }
  }

  /**
   * A plan's limits over the last week: the week's share as a step line,
   * each new week marked, and how full each five-hour session got. Null
   * with too little read to draw.
   */
  private limitsChart(history: readonly UsageReading[], now: number): LimitsChart | null {
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
      name: this.label(limit.window),
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
          name: this.dayName(dayKey(day)),
          cells: [busiest < 0 ? '–' : this.percent(busiest), last ? this.percent(last.used!) : '–'],
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

  /** An hour, such as "Thursday, 2 PM to 3 PM". */
  protected hourSpan(from: number, to: number): string {
    const day = new Date(from).toLocaleDateString([], { weekday: 'long' });
    return `${day}, ${hourName(from)} to ${hourName(to)}`;
  }

  protected planName(plan: string): string {
    return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
  }

  protected time(at: number): string {
    return time(at);
  }

  protected label(window: UsageWindow): string {
    if (window.span === 'session') return 'Current session';
    return window.model ? `This week, ${window.model}` : 'This week, all models';
  }

  protected filled(used: number | null): number {
    return Math.min(Math.max(used ?? 0, 0), 100);
  }

  protected round(used: number): number {
    return Math.round(used);
  }

  /** What's spent of the month's credits, such as "$123.45 of $600.00", or "$123.45 spent, no limit". */
  protected spent(credits: UsageCredits): string {
    const spent = credits.spent === null ? '–' : money(credits.spent, credits.currency);
    return credits.limit === null
      ? `${spent} spent, no limit`
      : `${spent} of ${money(credits.limit, credits.currency)}`;
  }

  /** When the month starts afresh, such as "resets on December 1". */
  protected resetsOn(at: number): string {
    return `resets on ${new Date(at).toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
  }

  /** When the limit resets: today, tomorrow, or on a day this week. */
  protected resets(at: number | null): string {
    if (at === null) return '';
    const when = new Date(at);
    const day = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return date.toDateString();
    };
    const on =
      when.toDateString() === day(0)
        ? ''
        : when.toDateString() === day(1)
          ? 'tomorrow '
          : `${when.toLocaleDateString([], { weekday: 'long' })} `;
    return `resets ${on}at ${time(at)}`;
  }
}
