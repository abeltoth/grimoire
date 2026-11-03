import type { PromptCache } from '@grimoire/contract';

/** What Claude Code records of a request's tokens, on each reply. */
export interface ReplyUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
  /** A server-side tool loop's requests, each with its own counts. */
  iterations?: ReplyUsage[];
}

const HOUR = 60 * 60_000;
const FIVE_MINUTES = 5 * 60_000;

/**
 * How long the prompt cache lasts, from what a request wrote to it: an hour
 * or five minutes. Undefined when it wrote nothing, so it can't be told.
 */
export function cacheLife(usage: ReplyUsage | undefined): number | undefined {
  const written = usage?.cache_creation;
  if (written?.ephemeral_1h_input_tokens) return HOUR;
  if (written?.ephemeral_5m_input_tokens) return FIVE_MINUTES;
  return undefined;
}

/**
 * The tokens a chat's context held at its last request: what continuing
 * re-reads once the cache runs out. As Claude Code counts it, a tool loop's
 * last request, not their sum.
 */
export function contextTokens(usage: ReplyUsage): number {
  const last = usage.iterations?.at(-1) ?? usage;
  return (
    (last.input_tokens ?? 0) +
    (last.cache_read_input_tokens ?? 0) +
    (last.cache_creation_input_tokens ?? 0) +
    (last.output_tokens ?? 0)
  );
}

/**
 * Follows a chat's replies, oldest first, for the prompt cache the last one
 * left. Subagents' replies are left out: they have caches of their own.
 */
export class CacheTracker {
  private last?: { usage: ReplyUsage; at: number };
  /** An hour until a request shows otherwise, as on a Claude subscription. */
  private life = HOUR;

  reply(usage: ReplyUsage | undefined, at: number): void {
    if (!usage) return;
    this.last = { usage, at };
    this.life = cacheLife(usage) ?? this.life;
  }

  get cache(): PromptCache | undefined {
    if (!this.last) return undefined;
    const tokens = contextTokens(this.last.usage);
    return tokens ? { tokens, until: this.last.at + this.life } : undefined;
  }
}
