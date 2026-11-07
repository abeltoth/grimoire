import type { AgentId } from './agents';

/** What a new chapter begins with: the settings used last, or a preset's, by name. */
export type NewChapterStart = { from: 'last-used' } | { from: 'preset'; preset: string };

/** Grimoire's own settings (ADR-009), set on the Colophon. */
export interface GrimoireSettings {
  /** The book's own words, such as Colophon, chapter and seal, or plain ones: Settings, chat, approve. */
  wording: 'book' | 'plain';
  /** Whether the pages show their drawings; essential ones, such as the thought mark, stay. */
  drawings: boolean;
  /** The agent new chapters are written by; null for whichever wrote the last one. */
  defaultAgent: AgentId | null;
  newChapter: NewChapterStart;
  /** The theme's tokens you changed, by name, such as "--gr-page": "#fffaf0"; the rest stay as drawn. */
  theme: Readonly<Record<string, string>>;
  /** The accounts you switch the agent's sign-in between, by email, such as yours and your family's. */
  accounts: readonly string[];
}

export const DEFAULT_SETTINGS: GrimoireSettings = {
  wording: 'book',
  drawings: true,
  defaultAgent: null,
  newChapter: { from: 'last-used' },
  theme: {},
  accounts: [],
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
