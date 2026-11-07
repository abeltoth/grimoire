import type { AgentId, ChatId } from './agents';

/** Tokens as the API counts them for an agent's replies. */
export interface TokenCounts {
  /** Input read fresh, not from the prompt cache. */
  input: number;
  /** Input written to the prompt cache for five minutes. */
  cacheWritten: number;
  /** Input written to the prompt cache for an hour, which weighs more. */
  cacheWrittenLong: number;
  /** Input read back from the prompt cache. */
  cacheRead: number;
  output: number;
}

/** One model's tokens in a turn: the chat's own, or its subagents'. */
export interface TokenUse extends TokenCounts {
  model: string;
  /** Spent by subagents the chat started, rather than by the chat itself. */
  subagent?: boolean;
}

/** What a turn spent: every reply in it, the chat's and its subagents', by model. */
export interface TurnTokens {
  /** When the turn began, in ms since the epoch. */
  at: number;
  uses: TokenUse[];
}

/**
 * Tokens weighed as the API prices them against fresh input: a cache read
 * a tenth, a cache write a quarter more (twice for an hour), output five
 * times. The models' own prices are left out.
 */
export function weighTokens(counts: TokenCounts): number {
  return (
    counts.input +
    counts.cacheWritten * 1.25 +
    counts.cacheWrittenLong * 2 +
    counts.cacheRead * 0.1 +
    counts.output * 5
  );
}

/** Token counts added up. */
export function addTokens(counts: readonly TokenCounts[]): TokenCounts {
  const total: TokenCounts = {
    input: 0,
    cacheWritten: 0,
    cacheWrittenLong: 0,
    cacheRead: 0,
    output: 0,
  };
  for (const c of counts) {
    total.input += c.input;
    total.cacheWritten += c.cacheWritten;
    total.cacheWrittenLong += c.cacheWrittenLong;
    total.cacheRead += c.cacheRead;
    total.output += c.output;
  }
  return total;
}

/** Tokens over a span, weighed. */
export interface TokenTotal extends TokenCounts {
  weight: number;
}

/** Where the tokens went since a time, by Grimoire's count from the agents' transcripts. */
export interface TokenTotals {
  since: number;
  total: TokenTotal;
  /** Each day with turns, oldest first, as YYYY-MM-DD in local time. */
  days: (TokenTotal & { day: string })[];
  /** Most weight first. */
  models: (TokenTotal & { model: string; subagent: boolean })[];
  /** Most weight first. */
  folders: (TokenTotal & { cwd: string })[];
  /** The chats that weighed most, most first. */
  chats: (TokenTotal & { id: ChatId; agent: AgentId; title: string; cwd?: string })[];
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

declare module './commands' {
  interface CommandMap {
    /** Where the tokens went since a time, by Grimoire's count from the agents' transcripts. */
    'tokens.totals': { request: { since: number }; response: TokenTotals };
    /** What the agent's own scan says took your plan's usage; null where it has none. */
    'agents.usageBreakdown': { request: { agent: AgentId }; response: UsageBreakdown | null };
  }
}
