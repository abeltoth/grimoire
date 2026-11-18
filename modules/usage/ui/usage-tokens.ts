import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { type TokenCounts, type TokenTotal, sumTokens } from '@grimoire/contract';
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
  dollars,
  dollarsShort,
  modelName,
  sourceKind,
  startOf,
} from './usage-format';

/** Where the tokens went over the span, a column or point for each day or hour. */
interface TokensCharts {
  /** "Cost by day" or "Cost by hour". */
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

/** What the cost is priced at, for its tooltip. */
const PRICING =
  'What these tokens would have cost at the API’s list prices, each model at its own, ' +
  'without a subscription.';

/** What the ring of the cost can be split by: the day, or the hour over the last 24, the model, folder or chat. */
type PieView = 'time' | 'model' | 'folder' | 'chat';

/** The parts a column of the cost is stacked from, bottom first. */
const COST_SERIES: (ChartSeries & { of: (cost: TokenCounts) => number })[] = [
  { name: 'Read from the cache', color: 'var(--gr-chart-1)', of: (c) => c.cacheRead },
  {
    name: 'Written to the cache',
    color: 'var(--gr-chart-2)',
    of: (c) => c.cacheWritten + c.cacheWrittenLong,
  },
  { name: 'Fresh input', color: 'var(--gr-chart-3)', of: (c) => c.input },
  { name: 'Output', color: 'var(--gr-chart-4)', of: (c) => c.output },
];
const COST_LEGEND: ChartSeries[] = COST_SERIES.map(({ name, color }) => ({ name, color }));

/** The share of the input read from the cache, in percent; null with no input. */
function cacheShare(c: TokenCounts): number | null {
  const all = c.input + c.cacheWritten + c.cacheWrittenLong + c.cacheRead;
  return all ? (c.cacheRead / all) * 100 : null;
}

/**
 * The Usage page's Tokens tab: what the chats' tokens would have cost at the
 * API's list prices, by Grimoire's count from their transcripts, split by
 * time, model, folder or chat; then what the agent's own scan says.
 */
@Component({
  selector: 'gr-usage-tokens',
  imports: [NgTemplateOutlet, UsageColumns, UsageLines, UsagePie, UsageSpans],
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

  /** How many rows a list shows before "Show all". */
  protected readonly few = SHOWN;
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly costSeries = COST_LEGEND;
  protected readonly short = dollarsShort;
  protected readonly dollars = dollars;
  protected readonly pricing = PRICING;
  protected readonly count = tokenCount;
  protected readonly all = sumTokens;
  protected readonly inWords = countsInWords;
  protected readonly behaviourName = behaviourName;
  protected readonly sourceKind = sourceKind;
  protected readonly filled = filled;
  protected readonly round = Math.round;

  protected readonly pieView = signal<PieView>('time');
  protected readonly pieViews = computed((): [PieView, string][] => [
    ['time', this.readings.span() === 'day' ? 'Hour' : 'Day'],
    ['model', 'Model'],
    ['folder', 'Folder'],
    ['chat', 'Chat'],
  ]);

  /** Where the tokens went over the span, a column and a point for each day, or each hour of the last 24. */
  protected readonly tokensCharts = computed((): TokensCharts | null => {
    const totals = this.readings.totals();
    if (!totals || !sumTokens(totals.total)) return null;
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
        parts: COST_SERIES.map((series) => (total ? series.of(total.cost) : 0)),
      });
      if (label) ticks.push({ at: middle, label });
      const share = total ? cacheShare(total) : null;
      if (share !== null) cache.push({ at: middle, value: share });
    }
    const bucket = unit === 'day' ? DAY : HOUR;
    return {
      caption: unit === 'day' ? 'Cost by day' : 'Cost by hour',
      columns,
      cache: [{ name: 'Served from the cache', color: 'var(--gr-chart-1)', points: cache }],
      from,
      to,
      ticks,
      bucket,
    };
  });

  /** The cost split by the view picked, a slice each with its tokens, with a word for what "Other" holds. */
  protected readonly pie = computed(
    (): { slices: Slice[]; unit: string; asGiven: boolean } | null => {
      const totals = this.readings.totals();
      if (!totals?.total.dollars) return null;
      const slice = (name: string, each: TokenTotal) => ({
        name,
        value: each.dollars,
        tokens: sumTokens(each),
      });
      // What a list leaves out of the whole; nothing for a sliver left by rounding.
      const left = (list: readonly TokenTotal[]) => {
        const dollars = totals.total.dollars - list.reduce((sum, each) => sum + each.dollars, 0);
        const tokens =
          sumTokens(totals.total) - list.reduce((sum, each) => sum + sumTokens(each), 0);
        return { value: dollars > totals.total.dollars * 0.001 ? dollars : 0, tokens };
      };
      switch (this.pieView()) {
        case 'time':
          // In time order, as the columns are.
          return this.readings.span() === 'day'
            ? {
                unit: 'hours',
                asGiven: true,
                slices: totals.hours.map((each) => slice(hourShort(each.hour), each)),
              }
            : {
                unit: 'days',
                asGiven: true,
                slices: totals.days.map((each) => slice(dayShort(each.day), each)),
              };
        case 'model':
          return {
            unit: 'models',
            asGiven: false,
            slices: totals.models.map((each) => slice(modelName(each.model, each.subagent), each)),
          };
        case 'folder':
          return {
            unit: 'folders',
            asGiven: false,
            slices: [
              ...totals.folders.map((each) => slice(this.catalog.folderName(each.cwd), each)),
              { name: 'No folder', ...left(totals.folders) },
            ],
          };
        case 'chat':
          return {
            unit: 'chats',
            asGiven: false,
            slices: [
              ...totals.chats.map((each) => ({
                ...slice(each.title || 'Untitled', each),
                key: each.id,
              })),
              {
                name: 'Other',
                ...left(totals.chats),
                rest: true,
                count: totals.chatCount - totals.chats.length,
              },
            ],
          };
      }
    },
  );

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
