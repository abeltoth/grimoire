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

/** What tokens were spent under: a skill the agent ran, or a subagent, by its kind of agent. */
export interface TokenSource {
  kind: 'skill' | 'subagent';
  name: string;
}

/** One model's tokens in a turn: the chat's own, or its subagents', under a skill or not. */
export interface TokenUse extends TokenCounts {
  model: string;
  /** Spent by subagents the chat started, rather than by the chat itself. */
  subagent?: boolean;
  /** The skill, or the subagent, they were spent under; absent for the chat's own. */
  source?: TokenSource;
  /**
   * What each kind of these tokens would cost at the API's list prices, in
   * US dollars; absent when the agent doesn't know the model's prices.
   */
  cost?: TokenCounts;
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

/** Every token counted once, whatever its kind; or, of a cost, every dollar. */
export function sumTokens(counts: TokenCounts): number {
  return (
    counts.input + counts.cacheWritten + counts.cacheWrittenLong + counts.cacheRead + counts.output
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
