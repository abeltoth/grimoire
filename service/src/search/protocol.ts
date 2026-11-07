import type { SearchHit, TokenTotals } from '@grimoire/contract';

/** What the service asks of the search worker. */
export type WorkerRequest =
  | { kind: 'search'; id: number; query: string }
  /** Where the tokens went in the turns begun since a time. */
  | { kind: 'tokens'; id: number; since: number }
  /** A chat may have changed since the chats were last read. */
  | { kind: 'stale' };

/** What the search worker answers, or a line for the service's log. */
export type WorkerReply =
  | { id: number; hits: SearchHit[] }
  | { id: number; totals: TokenTotals }
  | { id: number; error: string }
  | { log: string };
