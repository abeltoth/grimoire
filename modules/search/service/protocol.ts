import type { SearchHit, TokenTotals, ToolCall } from '@grimoire/contract';

/** What the service asks of the search worker. */
export type WorkerRequest =
  | { kind: 'search'; id: number; query: string }
  /** Where the tokens went in the turns begun since a time. */
  | { kind: 'tokens'; id: number; since: number }
  /** The calls of some tools since a time that added the most to their chat's context. */
  | { kind: 'toolCalls'; id: number; since: number; tools: string[] }
  /** A chat may have changed since the chats were last read. */
  | { kind: 'stale' };

/** What the search worker answers, or a line for the service's log. */
export type WorkerReply =
  | { id: number; hits: SearchHit[] }
  | { id: number; totals: TokenTotals }
  | { id: number; calls: ToolCall[] }
  | { id: number; error: string }
  | { log: string };
