import { Component, PendingTasks, effect, inject, signal, untracked } from '@angular/core';
import type { AgentInfo, PlanUsage, UsageWindow } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';

/** An agent with a plan, and how much of its limits is used. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The Ledger: how much of each agent's subscription limits is used, read
 * from the agent when the page opens, each limit with when it resets.
 */
@Component({
  selector: 'gr-ledger-page',
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

  constructor() {
    // Read once the agents are known.
    effect(() => {
      if (this.chats.agents().length) untracked(() => void this.read());
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
