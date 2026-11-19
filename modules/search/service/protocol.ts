import type { SearchHit, TokenTotals, ToolTarget } from '@grimoire/contract';

/** What the service asks of the search worker. */
export type WorkerRequest =
  | { kind: 'search'; id: number; query: string }
  /** Where the tokens went in the turns begun since a time. */
  | { kind: 'tokens'; id: number; since: number }
  /** What some tools ran on since a time, by the context their calls added. */
  | { kind: 'toolTargets'; id: number; since: number; tools: string[] }
  /** A chat may have changed since the chats were last read. */
  | { kind: 'stale' };

/** What the search worker answers, or a line for the service's log. */
export type WorkerReply =
  | { id: number; hits: SearchHit[] }
  | { id: number; totals: TokenTotals }
  | { id: number; targets: ToolTarget[] }
  | { id: number; error: string }
  | { log: string };
