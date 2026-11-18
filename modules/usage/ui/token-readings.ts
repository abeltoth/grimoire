import { Injectable, PendingTasks, effect, inject, signal, untracked } from '@angular/core';
import type { AgentInfo, TokenTotals, UsageBreakdown } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { HOUR } from './usage-format';

/** The spans the tokens are shown over, as Claude Code's scan reads them. */
export type Span = 'day' | 'week';

export const SPANS: Record<Span, { label: string; ms: number }> = {
  day: { label: 'Last 24 hours', ms: 24 * HOUR },
  week: { label: 'Last 7 days', ms: 7 * 24 * HOUR },
};

/** An agent's own word on where its plan's usage went. */
export interface Breakdown {
  agent: AgentInfo;
  breakdown: UsageBreakdown;
}

/**
 * The Tokens and the Tools & skills tabs' readings, kept by the Usage page so
 * both tabs share one span and one read: Grimoire's count from the chats'
 * transcripts, and what the agents say of their usage.
 */
@Injectable()
export class TokenReadings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly catalog = inject(AgentCatalog);
  private readonly pending = inject(PendingTasks);

  readonly span = signal<Span>('week');
  /** Grimoire's count over the span; undefined until it's read. */
  readonly totals = signal<TokenTotals | undefined>(undefined);
  readonly totalsFailed = signal<string | null>(null);
  /** What the agents say of their usage; undefined until they've answered. */
  readonly breakdowns = signal<Breakdown[] | undefined>(undefined);
  readonly breakdownsFailed = signal<string | null>(null);
  readonly reading = signal(false);

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.catalog.agents().length) untracked(() => void this.read());
    });
  }

  /** Reads again: Grimoire's count, and what the agents say. */
  async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    const done = this.pending.add();
    try {
      await Promise.all([this.readTotals(), this.readBreakdowns()]);
    } finally {
      this.reading.set(false);
      done();
    }
  }

  /** Shows another span: Grimoire counts it again, while the agents' scan already has both. */
  async showSpan(span: Span): Promise<void> {
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
}
