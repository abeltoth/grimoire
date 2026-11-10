import type { AgentId, ChatId } from './agents';
import type { NewChatSettings } from './chat-settings';

/** How you left the main window, so it opens the same way (ADR-009: Grimoire's own data). */
export interface Layout {
  /** The chat you were on; null for a blank page. */
  current: ChatId | null;
  /** The chat on the right page beside it; null for none, or a blank page. */
  beside: ChatId | null;
  /** The settings you last picked or began a chat with; a new chat takes them. */
  lastUsed: { agent: AgentId; settings: NewChatSettings } | null;
  /** Whether the book lies at a single page, the chat alone on the desk. */
  focus: boolean;
  /** The chats popped out, each in a window of its own, and where. */
  popouts: Popout[];
}

/** A chat popped out of the main window into a window of its own. */
export interface Popout {
  chatId: ChatId;
  /** Where its window was when it last closed with the main window. */
  bounds?: { x: number; y: number; width: number; height: number };
}

declare module './commands' {
  interface CommandMap {
    'layout.get': { request: Record<string, never>; response: Layout };
    /** Remembers the parts of the layout that changed. */
    'layout.set': { request: Partial<Layout>; response: void };
  }
}
