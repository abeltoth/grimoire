import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import type { TokenCounts, TokenTotal } from '@grimoire/contract';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { countsInWords, tokenCount } from '@ui/app/core/tokens';
import { type ChartSeries, type ChartTick, type Column, UsageColumns } from './charts';
import { type LineSeries, UsageLines } from './lines-chart';
import { type Slice, UsagePie } from './pie-chart';
import { TokenReadings } from './token-readings';
import { UsageSpans } from './usage-spans';
import {
  DAY,
  HOUR,
  behaviourName,
  dayKey,
  dayName,
  dayShort,
  dayTick,
  filled,
  hourName,
  hourShort,
  hourSpan,
  modelName,
  realTokens,
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

const SHOWN = 5;

/** How the weighted count weighs, for its tooltip. */
const WEIGHING =
  'Weighed as the API prices tokens against fresh input: a cache read a tenth, a cache write ' +
  'a quarter more (twice for an hour), output five times. The models’ own prices are left out.';

/** A pie of the weighted tokens, by one of what they went to. */
interface TokensPie {
  caption: string;
  slices: Slice[];
}

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
  imports: [NgTemplateOutlet, UsageColumns, UsageLines, UsagePie, UsageSpans],
  templateUrl: './usage-tokens.html',
  styleUrls: ['./usage-lists.css', './usage-sections.css', './usage-tokens.css'],
})
export class UsageTokens {
  protected readonly readings = inject(TokenReadings);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);

  readonly shown = input.required<boolean>();

  /** How many rows a list shows before "Show all". */
  protected readonly few = SHOWN;
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly tokenSeries = TOKEN_LEGEND;
  protected readonly tokenFormat = (n: number): string => tokenCount(n);
  protected readonly weightedFormat = (n: number): string => `${tokenCount(n)} weighted`;
  protected readonly weighing = WEIGHING;
  protected readonly count = tokenCount;
  protected readonly real = realTokens;
  protected readonly inWords = countsInWords;
  protected readonly behaviourName = behaviourName;
  protected readonly sourceKind = sourceKind;
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
      caption: unit === 'day' ? 'Weighted tokens by day' : 'Weighted tokens by hour',
      columns,
      cache: [{ name: 'Served from the cache', color: 'var(--gr-chart-1)', points: cache }],
      from,
      to,
      ticks,
      bucket,
    };
  });

  /** Where the weighted tokens went: by hour over the last 24 or by day, by model, folder and chat. */
  protected readonly pies = computed((): TokensPie[] => {
    const totals = this.readings.totals();
    if (!totals?.total.weight) return [];
    const all = totals.total.weight;
    // What a list leaves out of the whole; nothing for a sliver left by rounding.
    const left = (list: readonly TokenTotal[]) => {
      const rest = all - list.reduce((sum, each) => sum + each.weight, 0);
      return rest > all * 0.001 ? rest : 0;
    };
    return [
      this.readings.span() === 'day'
        ? {
            caption: 'By hour',
            slices: totals.hours.map((each) => ({
              name: hourShort(each.hour),
              value: each.weight,
            })),
          }
        : {
            caption: 'By day',
            slices: totals.days.map((each) => ({ name: dayShort(each.day), value: each.weight })),
          },
      {
        caption: 'By model',
        slices: totals.models.map((each) => ({
          name: modelName(each.model, each.subagent),
          value: each.weight,
        })),
      },
      {
        caption: 'By folder',
        slices: [
          ...totals.folders.map((each) => ({
            name: this.catalog.folderName(each.cwd),
            value: each.weight,
          })),
          { name: 'No folder', value: left(totals.folders) },
        ],
      },
      {
        caption: 'By chat',
        slices: [
          ...totals.chats.map((each) => ({
            name: each.title || 'Untitled',
            value: each.weight,
            key: each.id,
          })),
          { name: 'Other', value: left(totals.chats), rest: true },
        ],
      },
    ];
  });

  /** A moment of a day or hour, for the tooltip of the cache chart. */
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

  /** Opens a chat picked from the chat pie. */
  protected openChat(id: string): void {
    const chat = this.readings.totals()?.chats.find((each) => each.id === id);
    if (!chat) return;
    const { agent, title, cwd } = chat;
    void this.list.openChat({
      id: chat.id,
      agent,
      title,
      ...(cwd ? { cwd } : {}),
      updatedAt: 0,
    });
  }
}
