import { Component, PendingTasks, effect, inject, signal, untracked } from '@angular/core';
import type { AgentInfo, PlanUsage, UsageCredits, UsageWindow } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';

/** An agent with a plan, and how much of its limits is used. */
interface Plan {
  agent: AgentInfo;
  usage: PlanUsage;
}

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
