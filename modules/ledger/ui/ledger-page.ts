import { NgTemplateOutlet } from '@angular/common';
import { Component, PendingTasks, effect, inject, signal, untracked } from '@angular/core';
import type {
  AgentInfo,
  PlanUsage,
  TokenTotal,
  TokenTotals,
  UsageBreakdown,
  UsageCredits,
  UsageSpan,
  UsageWindow,
  Used,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { countsInWords, modelLabel, tokenCount } from '@ui/app/core/tokens';

/** An agent with a plan, and how much of its limits is used. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
}

/** An agent's own word on where its plan's usage went. */
interface Breakdown {
  agent: AgentInfo;
  breakdown: UsageBreakdown;
}

/** The spans where the tokens went is shown over, as Claude Code's scan reads them. */
type Span = 'day' | 'week';

const HOUR = 60 * 60_000;
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

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

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
 * The Ledger: how much of each agent's subscription limits is used, read
 * from the agent when the page opens, each limit with when it resets; and
 * where the tokens went, as the agent's own scan says and by Grimoire's
 * count from the chats' transcripts, with the tools and skills used most.
 */
@Component({
  selector: 'gr-ledger-page',
  imports: [NgTemplateOutlet],
  templateUrl: './ledger-page.html',
  styleUrl: './ledger-page.css',
})
export class LedgerPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);

  /** The agents with a plan; undefined until they've answered. */
  protected readonly plans = signal<Plan[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);

  protected readonly spans = Object.entries(SPANS) as [Span, { label: string; ms: number }][];
  protected readonly span = signal<Span>('week');
  /** Grimoire's count over the span; undefined until it's read. */
  protected readonly totals = signal<TokenTotals | undefined>(undefined);
  protected readonly totalsFailed = signal<string | null>(null);
  /** What the agents say of their usage; undefined until they've answered. */
  protected readonly breakdowns = signal<Breakdown[] | undefined>(undefined);
  protected readonly breakdownsFailed = signal<string | null>(null);
  protected readonly readingTokens = signal(false);

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.chats.agents().length)
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
      const totals = await this.bridge.invoke('tokens.totals', { since: Date.now() - SPANS[span].ms });
      if (span === this.span()) this.totals.set(totals);
    } catch (error) {
      this.totalsFailed.set(error instanceof Error ? error.message : String(error));
    }
  }

  private async readBreakdowns(): Promise<void> {
    this.breakdownsFailed.set(null);
    try {
      const agents = this.chats.agents();
      const answers = await Promise.all(
        agents.map((agent) => this.bridge.invoke('agents.usageBreakdown', { agent: agent.id })),
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
    return this.chats.folderName(cwd);
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
    void this.chats.openChat({
      id,
      agent,
      title,
      ...(cwd ? { cwd } : {}),
      updatedAt: 0,
      dogEars: [],
      tags: [],
    });
  }

  protected async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.chats.agents();
      const answers = await Promise.all(
        agents.map((agent) => this.bridge.invoke('agents.usage', { agent: agent.id })),
      );
      this.plans.set(
        agents.flatMap((agent, i) => {
          const usage = answers[i];
          return usage ? [{ agent, usage }] : [];
        }),
      );
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.reading.set(false);
      done();
    }
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
