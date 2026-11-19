import type { AgentId, ChatId, TokenCounts, TokenSource } from '@grimoire/contract';

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

/** Tokens over a span, and what they'd cost at the API's list prices. */
export interface TokenTotal extends TokenCounts {
  /** In US dollars, each kind apart; tokens of a model without known prices add nothing. */
  cost: TokenCounts;
  /** The cost in all, in US dollars. */
  dollars: number;
}

/** Where the tokens went since a time, by Grimoire's count from the agents' transcripts. */
export interface TokenTotals {
  since: number;
  total: TokenTotal;
  /** Tokens of models without known prices, left out of the costs. */
  unpriced: number;
  /** How many chats had turns over the span, though only the costliest are listed. */
  chatCount: number;
  /** Each day with turns, oldest first, as YYYY-MM-DD in local time. */
  days: (TokenTotal & { day: string })[];
  /** Each hour with turns, oldest first, as the start of the local hour in ms since the epoch. */
  hours: (TokenTotal & { hour: number })[];
  /** Costliest first. */
  models: (TokenTotal & { model: string; subagent: boolean })[];
  /** Costliest first. */
  folders: (TokenTotal & { cwd: string })[];
  /** What each skill and subagent spent, costliest first; the rest is the chats' own. */
  sources: (TokenTotal & TokenSource)[];
  /** The costliest chats, costliest first. */
  chats: (TokenTotal & { id: ChatId; agent: AgentId; title: string; cwd?: string })[];
  /** The tools the agents called in the chats, not their subagents, most used first. */
  tools: UsedTool[];
  /** The skills the agents ran, and the commands and skills you wrote as /name, most used first. */
  skills: Used[];
}

/** Something used, and how many times. */
export interface Used {
  name: string;
  uses: number;
}

/** A tool used, and the tokens its results added to the chats' context, where the agent could tell. */
export interface UsedTool extends Used {
  context: number;
}

/** One call of a tool, in a chat, and the tokens its result added to the chat's context. */
export interface ToolCall {
  chatId: ChatId;
  agent: AgentId;
  title: string;
  cwd?: string;
  tool: string;
  /** When its turn was, in ms since the epoch. */
  at: number;
  /** What it ran on, such as a file or command, when the agent says. */
  target?: string;
  context: number;
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
    /** The calls of some tools since a time that added the most to their chat's context, the most first. */
    'search.toolCalls': { request: { since: number; tools: string[] }; response: ToolCall[] };
  }
}
