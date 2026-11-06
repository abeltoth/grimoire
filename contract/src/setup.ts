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

/** A file of an agent's setup, opened to read or change. */
export interface SetupFile {
  path: string;
  text: string;
  exists: boolean;
  /** When it last changed, in ms since the epoch; 0 while it doesn't exist. */
  changedAt: number;
  /** Whether it may be changed here: not the managed settings, nor a plugin's own files. */
  editable: boolean;
}

declare module './commands' {
  interface CommandMap {
    /** What the agent loads in a folder, your home folder when there's none; null for agents that can't say. */
    'agents.setup': { request: { agent: AgentId; cwd?: string }; response: AgentSetup | null };
    /** One of the files the agent's setup in the folder lists; empty while it doesn't exist. */
    'agents.openSetupFile': {
      request: { agent: AgentId; cwd?: string; path: string };
      response: SetupFile;
    };
    /**
     * Writes one of the files the agent's setup in the folder lists, as long
     * as it hasn't changed since it was opened at `changedAt`; settings files
     * must hold valid JSON. Answers with the file as written.
     */
    'agents.saveSetupFile': {
      request: { agent: AgentId; cwd?: string; path: string; text: string; changedAt: number };
      response: SetupFile;
    };
  }
}

declare module './events' {
  interface EventMap {
    /** A file of the agent's setup in the folder changed, or a new one appeared: read it again. */
    'agents.setupChanged': { agent: AgentId; cwd: string };
  }
}
