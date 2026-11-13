declare module '@grimoire/contract' {
  interface CommandMap {
    /** Tags that would sort your chats, as the agent suggests them from their titles. */
    'labels.suggestTags': { request: Record<string, never>; response: string[] };
  }
}

export {};
