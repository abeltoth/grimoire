import type { AgentId } from './agents';

/** What a new chapter begins with: the settings used last, or a preset's, by name. */
export type NewChapterStart = { from: 'last-used' } | { from: 'preset'; preset: string };

/** The ready-made looks: the book as drawn, and three others. */
export const THEME_NAMES = ['grimoire', 'night', 'sepia', 'contrast'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** Grimoire's own settings (ADR-009), set on the Colophon. */
export interface GrimoireSettings {
  /** The book's own words, such as Colophon, chapter and seal, or plain ones: Settings, chat, approve. */
  wording: 'book' | 'plain';
  /** Whether the pages show their drawings; essential ones, such as the thought mark, stay. */
  drawings: boolean;
  /** The agent new chapters are written by; null for whichever wrote the last one. */
  defaultAgent: AgentId | null;
  newChapter: NewChapterStart;
  /** The ready-made look in use; "auto" follows the system's light or dark (Grimoire by day, Night after dark). */
  themeName: ThemeName | 'auto';
  /** The tokens of that look you changed, by name, such as "--gr-page": "#fffaf0"; the rest stay as drawn. */
  theme: Readonly<Record<string, string>>;
  /** The accounts you switch the agent's sign-in between, by email, such as yours and your family's. */
  accounts: readonly string[];
  /** The MCP servers turned off in every chat, by name; open chats change from their next turn. */
  mcpOff: readonly string[];
  /**
   * Whether the agent suggests your next message after a reply, which Tab
   * takes; open chats stop when their process next starts again.
   */
  suggestions: boolean;
  /**
   * Whether the agent may offer, now and then, a separate task as a card
   * that opens a new chat; open chats stop when their process next starts again.
   */
  followUps: boolean;
}

export const DEFAULT_SETTINGS: GrimoireSettings = {
  wording: 'book',
  drawings: true,
  defaultAgent: null,
  newChapter: { from: 'last-used' },
  themeName: 'grimoire',
  theme: {},
  accounts: [],
  mcpOff: [],
  suggestions: true,
  followUps: true,
};

declare module './commands' {
  interface CommandMap {
    'settings.get': { request: Record<string, never>; response: GrimoireSettings };
    /** Changes the settings given; returns them all. */
    'settings.set': { request: Partial<GrimoireSettings>; response: GrimoireSettings };
  }
}

declare module './events' {
  interface EventMap {
    /** The settings changed, in any window. */
    'settings.changed': { settings: GrimoireSettings };
  }
}
