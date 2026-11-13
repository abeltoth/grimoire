/** How far labelling past chats has come. */
export interface LabelProgress {
  /** Chats labelled, or tried, so far. */
  done: number;
  total: number;
  running: boolean;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** How many past chats have never been labelled, of the agents that answer prompts. */
    'labels.pastCount': { request: Record<string, never>; response: number };
    /** Labels every past chat never labelled, one at a time, as Settings says; progress comes as events. */
    'labels.labelPast': { request: Record<string, never>; response: void };
    /** Stops labelling past chats after the one under way. */
    'labels.stopPast': { request: Record<string, never>; response: void };
    /** Where labelling past chats is. */
    'labels.progress': { request: Record<string, never>; response: LabelProgress };
    /** Tags that would sort your chats, as the agent suggests them from their titles. */
    'labels.suggestTags': { request: Record<string, never>; response: string[] };
  }
}

declare module '@grimoire/contract' {
  interface EventMap {
    /** Labelling past chats came on. */
    'labels.progress': LabelProgress;
  }
}
