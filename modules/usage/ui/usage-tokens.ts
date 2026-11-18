import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import type { TokenCounts, TokenTotal, TokenTotals } from '@grimoire/contract';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { countsInWords, tokenCount } from '@ui/app/core/tokens';
import { type ChartSeries, type ChartTick, type Column, UsageColumns } from './charts';
import { type LineSeries, UsageLines } from './lines-chart';
import { TokenReadings } from './token-readings';
import { UsageSpans } from './usage-spans';
import {
  DAY,
  HOUR,
  behaviourName,
  dayKey,
  dayName,
  dayTick,
  filled,
  hourName,
  hourSpan,
  modelName,
  sourceKind,
  startOf,
} from './usage-format';

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

/** What Grimoire's count can be grouped by. */
type Group = 'day' | 'model' | 'folder' | 'chat';

const GROUPS: Record<Group, string> = {
  day: 'Day',
  model: 'Model',
  folder: 'Folder',
  chat: 'Chat',
};

const SHOWN = 5;

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

/** The share of the input read from the cache, in percent; null with no input. */
function cacheShare(c: TokenCounts): number | null {
  const all = c.input + c.cacheWritten + c.cacheWrittenLong + c.cacheRead;
  return all ? (c.cacheRead / all) * 100 : null;
}

/**
 * The Usage page's Tokens tab: where the tokens went, as the agent's own
 * scan says and by Grimoire's count from the chats' transcripts.
 */
@Component({
  selector: 'gr-usage-tokens',
  imports: [NgTemplateOutlet, UsageColumns, UsageLines, UsageSpans],
  templateUrl: './usage-tokens.html',
  styleUrls: [
    './usage-lists.css',
    './usage-picks.css',
    './usage-sections.css',
    './usage-tokens.css',
  ],
})
export class UsageTokens {
  protected readonly readings = inject(TokenReadings);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);

  readonly shown = input.required<boolean>();

  protected readonly groups = Object.entries(GROUPS) as [Group, string][];
  protected readonly group = signal<Group>('day');
  /** How many rows a list shows before "Show all". */
  protected readonly few = SHOWN;
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly tokenSeries = TOKEN_LEGEND;
  protected readonly tokenFormat = (n: number): string => tokenCount(n);
  protected readonly count = tokenCount;
  protected readonly inWords = countsInWords;
  protected readonly behaviourName = behaviourName;
  protected readonly sourceKind = sourceKind;
  protected readonly modelName = modelName;
  protected readonly dayName = dayName;
  protected readonly filled = filled;
  protected readonly round = Math.round;

  /** Where the tokens went over the span, a column and a point for each day, or each hour of the last 24. */
  protected readonly tokensCharts = computed((): TokensCharts | null => {
    const totals = this.readings.totals();
    if (!totals?.total.weight) return null;
    const unit = this.readings.span() === 'day' ? 'hour' : 'day';
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
        name: unit === 'day' ? dayName(dayKey(new Date(start))) : hourSpan(start, to),
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
    this.readings.span() === 'day'
      ? hourSpan(startOf(at, 'hour').getTime(), startOf(at, 'hour').getTime() + HOUR)
      : dayName(dayKey(new Date(at)));

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

  /** A share of the span's weight, 0-100. */
  protected shareOf(total: TokenTotal): number {
    const all = this.readings.totals()?.total.weight ?? 0;
    return all ? (total.weight / all) * 100 : 0;
  }

  protected folderName(cwd: string): string {
    return this.catalog.folderName(cwd);
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
}
