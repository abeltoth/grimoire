import type { AgentId, PlanUsage, UsageBreakdown } from '@grimoire/contract';
import { claudeUsage } from './claude';

/** How one agent reads its plan's usage. */
export interface UsageSource {
  /** The plan's limits and how much of them is used. */
  plan(): Promise<PlanUsage>;
  /** What the agent's own scan says took the plan's usage; null when it has none. */
  breakdown(): Promise<UsageBreakdown | null>;
}

/** Each agent's, by its ID; an agent without one has no plan to read. */
export const USAGE_SOURCES: ReadonlyMap<AgentId, UsageSource> = new Map([['claude-code', claudeUsage]]);
