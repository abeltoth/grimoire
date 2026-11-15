import type { AgentId } from '@grimoire/contract';

/** How much of one of a plan's limits is used: its five-hour session or its week. */
export interface UsageWindow {
  span: 'session' | 'week';
  /** For a week kept for one model, the model's name, such as "Opus". */
  model?: string;
  /** The share of the limit used, in percent; null when the agent doesn't say. */
  used: number | null;
  /** When the limit starts afresh, in ms since the epoch. */
  resetsAt: number | null;
}

/** A plan limit as it was read at one moment. */
export interface UsageReading extends UsageWindow {
  /** When it was read, in ms since the epoch. */
  at: number;
  /** The email of the account it was read for; absent for readings kept before Grimoire noted it. */
  account?: string;
}

/**
 * Usage credits: money a month's use may cost, as Claude Code's /usage
 * shows them. On Pro and Max they pay for use past the plan's limits; on a
 * Team or Enterprise plan they can be the allowance your organization gives
 * you each month.
 */
export interface UsageCredits {
  /** Spent this month, in the currency's minor units (cents for USD); null when the agent doesn't say. */
  spent: number | null;
  /** The month's limit, in the same units; null when there's no limit. */
  limit: number | null;
  /** The ISO 4217 code, such as "USD". */
  currency: string;
  /** The share of the limit spent, in percent; null when there's no limit or the agent doesn't say. */
  used: number | null;
  /** When the month starts afresh, in ms since the epoch: the first of next month, as /usage counts it. */
  resetsAt: number;
}

/** The agent's subscription, and how much of its limits is used. */
export interface PlanUsage {
  /** The subscription, such as "pro", "max", "team" or "enterprise"; null when there's none, as with an API key. */
  plan: string | null;
  /** Empty when the plan's limits don't apply. */
  windows: UsageWindow[];
  /** While usage credits are turned on. */
  credits?: UsageCredits;
  /** The email of the account the limits are of, when the agent says. */
  account?: string;
  /** When it was read, in ms since the epoch. */
  at: number;
}

/** What Claude Code's own scan of its transcripts says took a share of your plan's usage. */
export interface UsageBreakdown {
  /** The last 24 hours. */
  day: UsageSpan;
  /** The last 7 days. */
  week: UsageSpan;
  /** When it was read, in ms since the epoch. */
  at: number;
}

export interface UsageSpan {
  /** Requests to the API found in the span. */
  requests: number;
  chats: number;
  /**
   * Ways of working and the share of usage each took, 0-100, most first.
   * They overlap, so the shares don't add up to 100.
   */
  behaviours: { key: string; share: number; requests: number }[];
  /** What it advises, the largest share first. */
  advice: { key: string; share: number; title: string; detail?: string }[];
  /** The subagents, skills, plugins and MCP servers that took a share, most first. */
  sources: { kind: 'agent' | 'skill' | 'plugin' | 'mcp'; name: string; share: number }[];
}

/** A week of the plan's limit for all models, and how much of it was used. */
export interface UsageWeek {
  /** When it started afresh, in ms since the epoch. */
  start: number;
  /** When it starts afresh again: in the future for the week under way. */
  end: number;
  /** The most of it read used, in percent: by its end, how much of it was used. */
  used: number;
}

/** How much of the month's usage credits was spent, as read at one moment. */
export interface SpendReading {
  /** When it was read, in ms since the epoch. */
  at: number;
  /** Spent this month so far, in the currency's minor units. */
  spent: number;
  /** The month's limit, in the same units; null when there's none. */
  limit: number | null;
  currency: string;
}

/** A month of usage credits, and how much of them was spent. */
export interface UsageMonth {
  /** Its first day's start, local time, in ms since the epoch. */
  start: number;
  /** The most read spent in it, in the currency's minor units: by its end, what it cost. */
  spent: number;
  /** Its limit, in the same units; null when there was none. */
  limit: number | null;
  currency: string;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** The agent's plan limits, read now and kept; null when it has no plan. */
    'usage.plan': { request: { agent: AgentId }; response: PlanUsage | null };
    /**
     * Each reading of the agent's plan limits kept since a time, oldest
     * first: those of `account`, the one signed in as `usage.plan` says, or
     * without it, of the account read last. So too the commands below.
     */
    'usage.history': {
      request: { agent: AgentId; since: number; account?: string };
      response: UsageReading[];
    };
    /** What the agent's own scan says took your plan's usage; null where it has none. */
    'usage.breakdown': { request: { agent: AgentId }; response: UsageBreakdown | null };
    /** Each reading of the usage credits spent kept since a time, oldest first: those of the account signed in now. */
    'usage.spend': {
      request: { agent: AgentId; since: number; account?: string };
      response: SpendReading[];
    };
    /** Every month of usage credits kept, oldest first: those of the account signed in now. */
    'usage.months': { request: { agent: AgentId; account?: string }; response: UsageMonth[] };
    /** Every week of the plan's limit for all models kept, oldest first: those of the account signed in now. */
    'usage.weeks': { request: { agent: AgentId; account?: string }; response: UsageWeek[] };
  }

  interface EventMap {
    /** The agent's plan limits were read and kept, as they are now. */
    'usage.read': { agent: AgentId; usage: PlanUsage };
  }
}
