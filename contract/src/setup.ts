import type { AgentId } from './agents';

/** Where a piece of an agent's setup comes from. */
export type SetupSource =
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'plugin'
  /** Your Claude account, such as its connectors. */
  | 'account'
  /** The agent's own. */
  | 'built-in';

/** One thing an agent loads: a memory file, a skill, a hook, an MCP server, a permission rule… */
export interface SetupItem {
  name: string;
  /** A line about it: what a skill does, a hook's command, a permission rule's verdict. */
  detail?: string;
  source: SetupSource;
  /** The plugin that brings it, when one does. */
  plugin?: string;
  /** The file it's kept in, when it has one of its own. */
  path?: string;
  /** What it adds to the context of every chat, in tokens, when the agent says. */
  tokens?: number;
  /** What's wrong with it, such as an MCP server that couldn't connect. */
  problem?: string;
}

export const SETUP_SECTIONS = [
  'memory',
  'skills',
  'agents',
  'commands',
  'hooks',
  'mcpServers',
  'plugins',
  'permissions',
] as const;

/** A part of an agent's setup: its memory files, skills, subagents, commands, hooks, MCP servers, plugins or permission rules. */
export type SetupSection = (typeof SETUP_SECTIONS)[number];

/** A settings file the agent reads in a folder, where its hooks and permission rules are kept. */
export interface SettingsFile {
  source: SetupSource;
  path: string;
  exists: boolean;
  /** Why it couldn't be read, such as JSON that doesn't parse. */
  problem?: string;
}

/** Everything an agent loads when it works in a folder, and where each piece comes from. */
export interface AgentSetup {
  cwd: string;
  sections: Record<SetupSection, SetupItem[]>;
  settingsFiles: SettingsFile[];
  /** When it was read, in ms since the epoch. */
  at: number;
}

declare module './commands' {
  interface CommandMap {
    /** What the agent loads in a folder, your home folder when there's none; null for agents that can't say. */
    'agents.setup': { request: { agent: AgentId; cwd?: string }; response: AgentSetup | null };
  }
}
