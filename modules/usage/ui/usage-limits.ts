import { Component, PendingTasks, effect, inject, input, signal, untracked } from '@angular/core';
import type { AgentInfo, PlanUsage } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { type ChartSeries, UsageColumns, UsageLines } from './charts';
import { type LimitsChart, limitsChart } from './limits-chart';
import {
  DAY,
  filled,
  limitName,
  percent,
  planName,
  readingName,
  resets,
  resetsOn,
  spent,
  time,
} from './usage-format';

/** An agent with a plan, how much of its limits is used, and how much was over the last week. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
  /** Its limits over the last week; null with too little read to draw. */
  chart: LimitsChart | null;
}

const SESSION_SERIES: ChartSeries[] = [{ name: 'Peak of the session', color: 'var(--gr-chart-3)' }];

/**
 * The Usage page's limits: how much of each agent's subscription limits is
 * used, read from the agent when the page opens, each limit with when it
 * resets, and the last week of them drawn.
 */
@Component({
  selector: 'gr-usage-limits',
  imports: [UsageColumns, UsageLines],
  templateUrl: './usage-limits.html',
  styleUrls: ['./usage-lists.css', './usage-limits.css'],
})
export class UsageLimits {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly catalog = inject(AgentCatalog);
  private readonly pending = inject(PendingTasks);

  /** Whether the page shows the limits; they're read when it opens all the same. */
  readonly shown = input.required<boolean>();

  /** The agents with a plan; undefined until they've answered. */
  protected readonly plans = signal<Plan[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);

  protected readonly sessionSeries = SESSION_SERIES;
  /** A week's line holds across the hours nothing was read: its share only grows until it starts afresh. */
  protected readonly weekApart = 7 * DAY;
  protected readonly readingName = readingName;
  protected readonly percent = percent;
  protected readonly planName = planName;
  protected readonly time = time;
  protected readonly limitName = limitName;
  protected readonly filled = filled;
  protected readonly round = Math.round;
  protected readonly spent = spent;
  protected readonly resetsOn = resetsOn;
  protected readonly resets = resets;

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.catalog.agents().length) untracked(() => void this.read());
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
            ? [{ agent, usage: answer.usage, chart: limitsChart(answer.history, now) }]
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
}
