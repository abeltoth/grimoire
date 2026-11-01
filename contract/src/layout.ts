import type { AgentId, ChatId, NewChatSettings } from './agents';

/** How you left the book, so it opens the same way (ADR-009: Grimoire's own data). */
export interface Layout {
  /** The chapter you were on; null for a blank page. */
  current: ChatId | null;
  /** The settings you last picked or began a chapter with; a new chapter takes them. */
  lastUsed: { agent: AgentId; settings: NewChatSettings } | null;
}

declare module './commands' {
  interface CommandMap {
    'layout.get': { request: Record<string, never>; response: Layout };
    /** Remembers the parts of the layout that changed. */
    'layout.set': { request: Partial<Layout>; response: void };
  }
}
