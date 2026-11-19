import type { SearchHit, TokenTotals, ToolGroups } from '@grimoire/contract';

/** What the service asks of the search worker. */
export type WorkerRequest =
  | { kind: 'search'; id: number; query: string }
  /** Where the tokens went in the turns begun since a time. */
  | { kind: 'tokens'; id: number; since: number }
  /** A tool's calls since a time by group, by the context they added. */
  | { kind: 'toolGroups'; id: number; since: number; tool: string }
  /** A chat may have changed since the chats were last read. */
  | { kind: 'stale' };

/** What the search worker answers, or a line for the service's log. */
export type WorkerReply =
  | { id: number; hits: SearchHit[] }
  | { id: number; totals: TokenTotals }
  | { id: number; groups: ToolGroups }
  | { id: number; error: string }
  | { log: string };
