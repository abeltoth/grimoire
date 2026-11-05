import type { AgentId, ChatId } from './agents';

/** Where in a chat a passage is: its title, one of your entries, or one of the agent's replies. */
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

declare module './commands' {
  interface CommandMap {
    /**
     * The chats with a passage that has every word you looked for, or words
     * starting with them, best first. Passages are titles, your entries and
     * the agents' replies; their thinking and tools aren't looked through.
     */
    'search.chats': { request: { query: string }; response: SearchHit[] };
  }
}
