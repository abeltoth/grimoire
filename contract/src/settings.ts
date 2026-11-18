import type { AgentId } from './agents';
import type { EffortLevel } from './chat-settings';

/** What a new chat begins with: the settings used last, or a preset's, by name. */
export type NewChatStart = { from: 'last-used' } | { from: 'preset'; preset: string };

/** The agent, model and effort every new chat begins with, whatever the last one used. */
export interface NewChatDefault {
  agent: AgentId;
  /** The agent's model ID; its default model when left out. */
  model?: string;
  /** The model's effort; the model's own default when left out. */
  effort?: EffortLevel;
  /** Auto: the model and effort are picked for each chat's first message. */
  autoModel?: boolean;
}

/** The ready-made looks: the book as drawn, and three others. */
export const THEME_NAMES = ['grimoire', 'night', 'sepia', 'contrast'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** Grimoire's own settings, set in Settings. */
export interface GrimoireSettings {
  /** The book's own words, such as Colophon, chapter and seal, or plain ones: Settings, chat, approve. */
  wording: 'book' | 'plain';
  /** Whether the pages show their drawings; essential ones, such as the thought mark, stay. */
  drawings: boolean;
  /** The agent, model and effort every new chat begins with; null for those used last. */
  newChatDefault: NewChatDefault | null;
  newChat: NewChatStart;
  /** The ready-made look in use; "auto" follows the system's light or dark (Grimoire by day, Night after dark). */
  themeName: ThemeName | 'auto';
  /** The tokens of that look you changed, by name, such as "--gr-page": "#fffaf0"; the rest stay as drawn. */
  theme: Readonly<Record<string, string>>;
  /** How large every window draws everything, text, room and pictures alike, as a factor: 1 as drawn, 1.2 a fifth larger. */
  scale: number;
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
  /**
   * Whether an idle open chat is compacted shortly before its prompt cache
   * runs out, so going on later re-reads the summary instead of the whole chat.
   */
  autoCompact: boolean;
  /** Whether a short change to a file shows its diff in the chat unasked; closed, it opens when you click its line. */
  diffsOpen: boolean;
  /**
   * Whether your Jira issues show on the Kanban board; turned off, they're
   * never fetched, which spends no tokens.
   */
  jira: boolean;
  /**
   * The Jira query (JQL) whose issues show on the Kanban board, fetched
   * through your claude.ai Atlassian connector.
   */
  jiraQuery: string;
  /** The Jira project a new issue for a chat goes in, by its key, such as PROJ; empty for the one most of the board's issues are in. */
  jiraProject: string;
  /** The type a new issue for a chat is, such as Task. */
  jiraIssueType: string;
  /** How the History lists chats: by when they were last written in, or by project. */
  historyGroup: 'date' | 'project';
  /**
   * The model each agent does Grimoire's quick jobs on, by agent, such as
   * picking a chat's model or naming it; an agent left out uses the one it recommends.
   */
  quickModels: Readonly<Record<AgentId, string>>;
  /** Whether a chat is named on the model for quick jobs after its first turn, and now and then after; spends tokens. */
  autoTitles: boolean;
  /** Whether a chat is tagged from your tag list on the model for quick jobs; spends tokens. */
  autoTags: boolean;
  /** Whether a chat gets a one-line summary on the model for quick jobs; spends tokens. */
  autoSummaries: boolean;
  /**
   * The page tabs in the order you put them, by id; a tab not in it keeps
   * the place its feature gives it.
   */
  pageTabOrder: readonly string[];
  /** The page tabs you hid, by id; Settings always shows, so they can be shown again. */
  pageTabsHidden: readonly string[];
}

/** The page tab that can't be hidden, since it's where hidden tabs are shown again. */
export const SETTINGS_TAB = 'settings';

/** How small and large the windows may be scaled, and the step a shortcut takes. */
export const SCALES = { min: 0.8, max: 1.6, step: 0.1 } as const;

/** The Jira issues on the board unless you say otherwise: yours not done, and those done in the last fortnight. */
export const DEFAULT_JIRA_QUERY =
  'assignee = currentUser() AND (statusCategory != Done OR statusCategoryChangedDate >= -14d) ORDER BY updated DESC';

export const DEFAULT_SETTINGS: GrimoireSettings = {
  wording: 'book',
  drawings: true,
  newChatDefault: null,
  newChat: { from: 'last-used' },
  themeName: 'grimoire',
  theme: {},
  scale: 1,
  accounts: [],
  mcpOff: [],
  suggestions: true,
  followUps: true,
  autoCompact: false,
  diffsOpen: true,
  jira: true,
  jiraQuery: DEFAULT_JIRA_QUERY,
  jiraProject: '',
  jiraIssueType: 'Task',
  historyGroup: 'date',
  quickModels: {},
  autoTitles: false,
  autoTags: false,
  autoSummaries: false,
  pageTabOrder: [],
  pageTabsHidden: [],
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
