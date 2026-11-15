import type {
  AgentId,
  PlanUsage,
  UsageBreakdown,
  UsageReading,
  UsageWindow,
} from '@grimoire/contract';
import { type UsageReadings, sameAccount, thin } from './readings';
import type { UsageSource } from './sources';

/** The agents' plans: their limits, read and kept so their history can be drawn, and where their usage went. */
export class Usage {
  /** Each agent's read under way, which anyone asking meanwhile shares. */
  private readonly inFlight = new Map<AgentId, Promise<PlanUsage | null>>();

  /** `agents` are the agents the hub knows; `sources` read each one's plan; `kept` hears each reading kept. */
  constructor(
    private readonly readings: UsageReadings,
    private readonly sources: ReadonlyMap<AgentId, UsageSource>,
    private readonly agents: () => AgentId[],
    private readonly kept: (agent: AgentId, usage: PlanUsage) => void = () => {},
  ) {}

  /** The agent's plan limits, read now and kept; null when it has no plan. */
  plan(agent: AgentId): Promise<PlanUsage | null> {
    const under = this.inFlight.get(agent);
    if (under) return under;
    const read = this.readPlan(agent).finally(() => this.inFlight.delete(agent));
    this.inFlight.set(agent, read);
    return read;
  }

  private async readPlan(agent: AgentId): Promise<PlanUsage | null> {
    const source = this.sources.get(agent);
    if (!source) return null;
    const usage = await source.plan();
    this.readings.record(agent, usage);
    this.kept(agent, usage);
    return usage;
  }

  /** Reads every agent's plan limits; rejects when any couldn't be read. */
  async readAll(): Promise<void> {
    const reads = this.agents()
      .filter((agent) => this.sources.has(agent))
      .map((agent) => this.plan(agent));
    const failed = (await Promise.allSettled(reads)).find((read) => read.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /**
   * Each reading of the agent's plan limits kept since a time, oldest
   * first: those of the account signed in now. With `span`, only that
   * limit's; with `every`, the last of each limit in each stretch that long.
   */
  history(
    agent: AgentId,
    since: number,
    span?: UsageWindow['span'],
    every?: number,
  ): UsageReading[] {
    const kept = sameAccount(this.readings.since(agent, since));
    const shown = span ? kept.filter((r) => r.span === span) : kept;
    return every ? thin(shown, every) : shown;
  }

  /** What the agent's own scan says took the plan's usage; null when it can't say. */
  async breakdown(agent: AgentId): Promise<UsageBreakdown | null> {
    return (await this.sources.get(agent)?.breakdown()) ?? null;
  }
}
