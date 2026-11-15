import type {
  AgentId,
  PlanUsage,
  UsageBreakdown,
  SpendReading,
  UsageMonth,
  UsageReading,
  UsageWeek,
} from '@grimoire/contract';
import { type UsageReadings, accountWeeks, sameAccount } from './readings';
import type { UsageSource } from './sources';
import type { SpendReadings } from './spend';

/** The agents' plans: their limits, read and kept so their history can be drawn, and where their usage went. */
export class Usage {
  /** Each agent's read under way, which anyone asking meanwhile shares. */
  private readonly inFlight = new Map<AgentId, Promise<PlanUsage | null>>();

  /** `agents` are the agents the hub knows; `sources` read each one's plan; `kept` hears each reading kept. */
  constructor(
    private readonly readings: UsageReadings,
    private readonly spend: SpendReadings,
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
    this.spend.record(agent, usage);
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

  /** Each reading of the agent's plan limits kept since a time, oldest first: those of the account signed in now. */
  history(agent: AgentId, since: number): UsageReading[] {
    return sameAccount(this.readings.since(agent, since));
  }

  /** Every week of the plan's limit for all models kept, oldest first: those of the account signed in now. */
  weeks(agent: AgentId): UsageWeek[] {
    const latest = this.readings.latestWeek(agent);
    return accountWeeks(this.readings.weeks(agent), latest);
  }

  /** Each reading of the usage credits spent kept since a time, oldest first: those of the account signed in now. */
  spending(agent: AgentId, since: number): SpendReading[] {
    return this.spend.since(agent, since);
  }

  /** Every month of usage credits kept, oldest first: those of the account signed in now. */
  months(agent: AgentId): UsageMonth[] {
    return this.spend.months(agent);
  }

  /** What the agent's own scan says took the plan's usage; null when it can't say. */
  async breakdown(agent: AgentId): Promise<UsageBreakdown | null> {
    return (await this.sources.get(agent)?.breakdown()) ?? null;
  }
}
