import {
  Component,
  DestroyRef,
  PendingTasks,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { AgentInfo, PlanUsage } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import {
  type LimitLine,
  type LimitsChart,
  limitsChart,
  sessionChart,
  weeksChart,
} from './limits-chart';
import { UsageLines } from './lines-chart';
import { UsageSessions } from './sessions-chart';
import {
  DAY,
  HOUR,
  elapsed,
  filled,
  limitName,
  meterText,
  percent,
  planName,
  readingName,
  resets,
  resetsOn,
  spent,
  time,
  weekOf,
} from './usage-format';

/** An agent with a plan, how much of its limits is used, its session and week so far, and the weeks before. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
  /** The week under way; null until a week's limit has been read. */
  chart: LimitsChart | null;
  /** The session under way; null when none is. */
  session: LimitLine | null;
  /** How much of each week ended was used; null with fewer than two. */
  weeks: LimitLine | null;
}

/**
 * The Usage page's limits: how much of each agent's subscription limits is
 * used, each limit with when it resets and how much of its time is gone,
 * the session and the week under way drawn, the week's sessions, and the weeks before. Read
 * from the agent when the page opens, and again whenever the service reads them.
 */
@Component({
  selector: 'gr-usage-limits',
  imports: [UsageLines, UsageSessions],
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
  /** When the limits were last drawn, which their time gone counts to. */
  protected readonly now = signal(Date.now());

  /** A limit's line holds across the hours nothing was read: its share only grows until it starts afresh. */
  protected readonly weekApart = 7 * DAY;
  /** A week's line breaks where a week went unread. */
  protected readonly weekGap = 10 * DAY;
  protected readonly weekOf = weekOf;
  protected readonly readingName = readingName;
  protected readonly percent = percent;
  protected readonly planName = planName;
  protected readonly time = time;
  protected readonly limitName = limitName;
  protected readonly filled = filled;
  protected readonly elapsed = elapsed;
  protected readonly meterText = meterText;
  protected readonly round = Math.round;
  protected readonly spent = spent;
  protected readonly resetsOn = resetsOn;
  protected readonly resets = resets;

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.catalog.agents().length) untracked(() => void this.read());
    });
    // The service reads the limits now and again: what it read shows at once.
    const stop = this.bridge.on('usage.read', ({ agent, usage }) => void this.update(agent, usage));
    inject(DestroyRef).onDestroy(stop);
  }

  protected async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.catalog.agents();
      const plans = await Promise.all(
        agents.map(async (agent) => {
          const usage = await this.bridge.invoke('usage.plan', { agent: agent.id });
          return usage ? this.drawn(agent, usage) : null;
        }),
      );
      this.plans.set(plans.filter((plan) => plan !== null));
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.reading.set(false);
      done();
    }
  }

  /** An agent's limits as the service just read them, in place of those shown. */
  private async update(agent: string, usage: PlanUsage): Promise<void> {
    const shown = this.plans()?.find((plan) => plan.agent.id === agent);
    if (!shown) return;
    const done = this.pending.add();
    try {
      const plan = await this.drawn(shown.agent, usage);
      this.plans.update((plans) => plans?.map((each) => (each.agent.id === agent ? plan : each)));
    } catch {
      // What's shown stays until the next reading.
    } finally {
      done();
    }
  }

  /** An agent's limits with the week under way and the weeks before, as kept. */
  private async drawn(agent: AgentInfo, usage: PlanUsage): Promise<Plan> {
    const now = Date.now();
    const week = usage.windows.find((window) => window.span === 'week' && !window.model);
    // The week under way, and the session it began in.
    const since = week?.resetsAt ? week.resetsAt - 7 * DAY - 5 * HOUR : now - 7 * DAY;
    const [history, weeks] = await Promise.all([
      this.bridge.invoke('usage.history', { agent: agent.id, since }),
      this.bridge.invoke('usage.weeks', { agent: agent.id }),
    ]);
    this.now.set(now);
    return {
      agent,
      usage,
      chart: limitsChart(history ?? [], now),
      session: sessionChart(history ?? [], now),
      weeks: weeksChart(weeks ?? [], now),
    };
  }
}
