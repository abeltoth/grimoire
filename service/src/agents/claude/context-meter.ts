import type { ContextUsage } from '@grimoire/contract';

/** What Claude Code measures of a chat's context window. */
export interface MeasuredContext {
  totalTokens: number;
  rawMaxTokens: number;
  autoCompactThreshold?: number;
  isAutoCompactEnabled?: boolean;
}

/**
 * Follows how full a chat's context window is: each reply's tokens as it
 * comes, once Claude Code has measured the window's size and where it
 * compacts, and its exact measure whenever it gives one.
 */
export class ContextMeter {
  private window?: Omit<ContextUsage, 'used'>;
  private used = 0;
  private last?: string;
  /** Replies so far: a measure asked for before the last of them is behind it. */
  private replies = 0;

  constructor(private readonly report: (usage: ContextUsage) => void) {}

  /** Marks a measure asked for now; give it back to measured(). */
  asking(): number {
    return this.replies;
  }

  /** Claude Code's measure, asked for at `asked`: its count stands unless a reply came since. */
  measured(usage: MeasuredContext, asked: number): void {
    const compactsAt = usage.isAutoCompactEnabled ? usage.autoCompactThreshold : undefined;
    this.window = { limit: usage.rawMaxTokens, ...(compactsAt ? { compactsAt } : {}) };
    this.show(asked === this.replies ? usage.totalTokens : this.used);
  }

  /** A reply's tokens: what the context held at its request. */
  reply(tokens: number): void {
    if (!tokens) return;
    this.replies++;
    this.show(tokens);
  }

  /** A compaction left this much, when it says. */
  compacted(tokens: number | undefined): void {
    this.replies++;
    if (tokens) this.show(tokens);
  }

  private show(used: number): void {
    this.used = used;
    if (!this.window?.limit) return;
    const usage = { used, ...this.window };
    // A reply comes once per content block, each with the same tokens.
    const key = JSON.stringify(usage);
    if (key === this.last) return;
    this.last = key;
    this.report(usage);
  }
}
