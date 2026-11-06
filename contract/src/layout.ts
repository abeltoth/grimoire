import type { AgentId, ChatId, NewChatSettings } from './agents';

/** How you left the book, so it opens the same way (ADR-009: Grimoire's own data). */
export interface Layout {
  /** The chapter you were on; null for a blank page. */
  current: ChatId | null;
  /** The chapter on the facing page beside it; null for none, or a blank page. */
  beside: ChatId | null;
  /** The settings you last picked or began a chapter with; a new chapter takes them. */
  lastUsed: { agent: AgentId; settings: NewChatSettings } | null;
  /** Whether the book lies at a single page, the chapter alone on the desk. */
  focus: boolean;
  /** The chapters popped out as loose leaves, each in a window of its own, and where. */
  loose: LooseLeaf[];
}

/** A chapter popped out of the book into a window of its own. */
export interface LooseLeaf {
  chatId: ChatId;
  /** Where its window was when it last closed with the book. */
  bounds?: { x: number; y: number; width: number; height: number };
}

declare module './commands' {
  interface CommandMap {
    'layout.get': { request: Record<string, never>; response: Layout };
    /** Remembers the parts of the layout that changed. */
    'layout.set': { request: Partial<Layout>; response: void };
  }
}
