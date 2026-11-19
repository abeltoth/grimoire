import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { type PlanUsage, type TokenCounts, type TokenTotal, sumTokens } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { countsInWords, tokenCount } from '@ui/app/core/tokens';
import type { AboutRow } from './about-tip';
import { type ChartSeries, type ChartTick, type Column, UsageColumns } from './charts';
import { type LineSeries, UsageLines } from './lines-chart';
import { type Slice, UsagePie } from './pie-chart';
import { UsageToolRing } from './tool-ring';
import { ScanReadings } from './scan-readings';
import { TokenReadings } from './token-readings';
import { UsageBreakdownPanel } from './usage-breakdown';
import { UsageSpans } from './usage-spans';
import {
  DAY,
  HOUR,
  billedPerToken,
  dayKey,
  dayName,
  dayShort,
  dayTick,
  hourName,
  hourShort,
  hourSpan,
  dollars,
  dollarsShort,
  modelName,
  startOf,
  uses,
} from './usage-format';

/** What the columns count: the tokens, or what they'd cost at API prices. */
type Measure = 'tokens' | 'cost';

/** Where the tokens went over the span, a column or point for each day or hour. */
interface TokensCharts {
  /** "By day" or "By hour". */
  caption: string;
  columns: Column[];
  cache: LineSeries[];
  /** The cache chart's foot: a little under its lowest reading, so small changes show. */
  cacheFloor: number;
  from: number;
  to: number;
  ticks: ChartTick[];
  /** A bucket's length, in ms: a gap of more than that breaks the line. */
  bucket: number;
}

/** What the cost is priced at, for its tooltip. */
const PRICING =
  'What these tokens would have cost at the API’s list prices, each model at its own, ' +
  'without a subscription.';

/** What the cost is, for its tooltip, when the plan bills the tokens as used. */
const BILLED =
  'What these tokens cost: your plan bills them as used, at the API’s prices, each model at its own.';

/** What the ring of the cost can be split by: the day, or the hour over the last 24, the model, folder, chat or skill. */
type PieView = 'time' | 'model' | 'folder' | 'chat' | 'skill';

/** The parts a column of tokens is stacked from, bottom first. */
const TOKEN_SERIES: (ChartSeries & { of: (counts: TokenCounts) => number })[] = [
  { name: 'Read from the cache', color: 'var(--gr-chart-1)', of: (c) => c.cacheRead },
  {
    name: 'Written to the cache',
    color: 'var(--gr-chart-2)',
    of: (c) => c.cacheWritten + c.cacheWrittenLong,
  },
  { name: 'Fresh input', color: 'var(--gr-chart-3)', of: (c) => c.input },
  { name: 'Output', color: 'var(--gr-chart-4)', of: (c) => c.output },
];
const TOKEN_LEGEND: ChartSeries[] = TOKEN_SERIES.map(({ name, color }) => ({ name, color }));

/** What the four kinds of token are and what each costs against fresh input, behind the chart's icon. */
const KINDS: AboutRow[] = [
  { head: 'Fresh input', value: '1×', text: 'What Claude reads that isn’t in the cache.' },
  {
    head: 'Read from the cache',
    value: '0.1× or less',
    text: 'The chat so far, read again on every reply.',
  },
  {
    head: 'Written to the cache',
    value: '1.25×, or 2× when kept for an hour',
    text: 'New context stored: a chat starting, a big file read, or the cache running out.',
  },
  { head: 'Output', value: '5×', text: 'What Claude writes, thinking included.' },
];

/** A scale's foot a little under the lowest share, on an even step so its middle line is whole. */
export function floorUnder(lowest: number): number {
  return Math.max(0, 100 - 2 * Math.ceil((100 - lowest + 1) / 2));
}

/** The share of the input read from the cache, in percent; null with no input. */
function cacheShare(c: TokenCounts): number | null {
  const all = c.input + c.cacheWritten + c.cacheWrittenLong + c.cacheRead;
  return all ? (c.cacheRead / all) * 100 : null;
}

/**
 * The Usage page's Tokens tab: what the chats' tokens would have cost at the
 * API's list prices, by Grimoire's count from their transcripts, split by
 * time, model, folder, chat or skill; then what the agent's own scan says.
 */
@Component({
  selector: 'gr-usage-tokens',
  imports: [UsageBreakdownPanel, UsageColumns, UsageLines, UsagePie, UsageSpans, UsageToolRing],
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
  protected readonly scans = inject(ScanReadings);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly shown = input.required<boolean>();

  protected readonly tokenSeries = TOKEN_LEGEND;
  protected readonly kinds = KINDS;
  protected readonly dollars = dollars;
  /** Each agent's plan, as last read. */
  private readonly plans = signal<ReadonlyMap<string, PlanUsage>>(new Map());
  /** Whether the tokens are billed as used, so their cost is what was spent, not an estimate. */
  protected readonly billed = computed(() => [...this.plans().values()].some(billedPerToken));
  protected readonly pricing = computed(() => (this.billed() ? BILLED : PRICING));
  /** The cost, such as "$12.40 spent" or "$12.40 at API prices". */
  protected readonly cost = (amount: number) =>
    `${dollars(amount)} ${this.billed() ? 'spent' : 'at API prices'}`;
  protected readonly count = tokenCount;
  protected readonly all = sumTokens;
  protected readonly inWords = countsInWords;

  protected readonly measure = signal<Measure>('tokens');
  protected readonly measures: [Measure, string][] = [
    ['tokens', 'Tokens'],
    ['cost', 'Cost'],
  ];
  protected readonly columnFormat = computed(() =>
    this.measure() === 'tokens' ? tokenCount : dollarsShort,
  );

  constructor() {
    // The service tells every window each plan it reads, the Limits tab's read included.
    const stop = this.bridge.on('usage.read', ({ agent, usage }) => this.notePlan(agent, usage));
    inject(DestroyRef).onDestroy(stop);
  }

  private notePlan(agent: string, usage: PlanUsage): void {
    this.plans.update((plans) => new Map(plans).set(agent, usage));
  }

  protected readonly pieView = signal<PieView>('time');
  protected readonly pieViews = computed((): [PieView, string][] => [
    ['time', this.readings.span() === 'day' ? 'Hour' : 'Day'],
    ['model', 'Model'],
    ['folder', 'Folder'],
    ['chat', 'Chat'],
    ['skill', 'Skill'],
  ]);

  /** Where the tokens went over the span, a column and a point for each day, or each hour of the last 24. */
  protected readonly tokensCharts = computed((): TokensCharts | null => {
    const totals = this.readings.totals();
    if (!totals || !sumTokens(totals.total)) return null;
    const unit = this.readings.span() === 'day' ? 'hour' : 'day';
    const measure = this.measure();
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
        parts: TOKEN_SERIES.map((series) =>
          total ? series.of(measure === 'tokens' ? total : total.cost) : 0,
        ),
        // The other measure, in the tooltip.
        ...(total
          ? {
              note:
                measure === 'tokens'
                  ? this.cost(total.dollars)
                  : `${tokenCount(sumTokens(total))} tokens`,
            }
          : {}),
      });
      if (label) ticks.push({ at: middle, label });
      const share = total ? cacheShare(total) : null;
      if (share !== null) cache.push({ at: middle, value: share });
    }
    const bucket = unit === 'day' ? DAY : HOUR;
    return {
      caption: unit === 'day' ? 'By day' : 'By hour',
      columns,
      cache: [{ name: 'Served from the cache', color: 'var(--gr-chart-1)', points: cache }],
      cacheFloor: floorUnder(Math.min(100, ...cache.map((point) => point.value))),
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
        case 'skill': {
          // What ran under no skill or subagent is the chat's own; a skill says how often it ran.
          const runs = new Map(totals.skills.map((each) => [each.name, each.uses]));
          return {
            unit: 'skills',
            asGiven: false,
            slices: [
              ...totals.sources.map((each) => {
                const ran = each.kind === 'skill' ? runs.get(each.name) : undefined;
                return {
                  ...slice(`${each.name} · ${each.kind}`, each),
                  ...(ran ? { note: uses(ran) } : {}),
                };
              }),
              { name: 'Chat', ...left(totals.sources) },
            ],
          };
        }
      }
    },
  );

  /** A moment of a day or hour, for the tooltip of the cache chart. */
  protected readonly bucketName = (at: number): string =>
    this.readings.span() === 'day'
      ? hourSpan(startOf(at, 'hour').getTime(), startOf(at, 'hour').getTime() + HOUR)
      : dayName(dayKey(new Date(at)));

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
