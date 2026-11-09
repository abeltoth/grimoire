import type { AgentId, PlanUsage, UsageBreakdown, UsageReading } from '@grimoire/contract';
import { type UsageReadings, sameAccount } from './readings';
import type { UsageSource } from './sources';

/** The agents' plans: their limits, read and kept so their history can be drawn, and where their usage went. */
export class Usage {
  /** `agents` are the agents the hub knows; `sources` read each one's plan. */
  constructor(
    private readonly readings: UsageReadings,
    private readonly sources: ReadonlyMap<AgentId, UsageSource>,
    private readonly agents: () => AgentId[],
  ) {}

  /** The agent's plan limits, read now and kept; null when it has no plan. */
  async plan(agent: AgentId): Promise<PlanUsage | null> {
    const source = this.sources.get(agent);
    if (!source) return null;
    const usage = await source.plan();
    this.readings.record(agent, usage);
    return usage;
  }

  /** Each reading of the agent's plan limits kept since a time, oldest first: those of the account signed in now. */
  history(agent: AgentId, since: number): UsageReading[] {
    return sameAccount(this.readings.since(agent, since));
  }

  /** What the agent's own scan says took the plan's usage; null when it can't say. */
  async breakdown(agent: AgentId): Promise<UsageBreakdown | null> {
    return (await this.sources.get(agent)?.breakdown()) ?? null;
  }

  /**
   * Reads every agent's plan limits now and then every `ms`, so their
   * history is kept even while no one looks. Returns a function that stops it.
   */
  readEvery(ms: number): () => void {
    const read = () => {
      for (const agent of this.agents()) if (this.sources.has(agent)) this.plan(agent).catch(() => {});
    };
    read();
    const timer = setInterval(read, ms);
    timer.unref();
    return () => clearInterval(timer);
  }
}
