import type { AgentId, ChatId, TokenCounts } from '@grimoire/contract';

/** Where in a chat a passage is: its title, one of your messages, or one of the agent's replies. */
export type PassageKind = 'title' | 'you' | 'agent';

/** A piece of an excerpt: plain text, or a word you looked for. */
export interface ExcerptPart {
  text: string;
  match?: true;
}

/** A chat with what you looked for, and its passage that has it best. */
export interface SearchHit {
  chatId: ChatId;
  agent: AgentId;
  kind: PassageKind;
  /** The passage around the words, cut short at both ends when it's long. */
  excerpt: ExcerptPart[];
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
  /** Each hour with turns, oldest first, as the start of the local hour in ms since the epoch. */
  hours: (TokenTotal & { hour: number })[];
  /** Most weight first. */
  models: (TokenTotal & { model: string; subagent: boolean })[];
  /** Most weight first. */
  folders: (TokenTotal & { cwd: string })[];
  /** The chats that weighed most, most first. */
  chats: (TokenTotal & { id: ChatId; agent: AgentId; title: string; cwd?: string })[];
  /** The tools the agents called most in the chats, not their subagents, most first. */
  tools: Used[];
  /** The skills the agents ran most, and the commands and skills you wrote most as /name, most first. */
  skills: Used[];
}

/** Something used, and how many times. */
export interface Used {
  name: string;
  uses: number;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /**
     * The chats with a passage that has every word you looked for, or words
     * starting with them, best first. Passages are titles, your messages and
     * the agents' replies; their thinking and tools aren't looked through.
     */
    'search.chats': { request: { query: string }; response: SearchHit[] };
    /** Where the tokens went since a time, by Grimoire's count from the agents' transcripts. */
    'search.tokens': { request: { since: number }; response: TokenTotals };
  }
}
