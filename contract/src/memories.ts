import type { AgentId } from './agents';
import type { SetupFile } from './setup';

/** One of the memories an agent keeps on its own, in a file of its memory folder. */
export interface Memory {
  /** Its name, as other memories link to it with [[name]]. */
  name: string;
  /** Its file. */
  path: string;
  description?: string;
  /** What kind of memory it is, such as "feedback", "project", "reference" or "user"; empty when it doesn't say. */
  type: string;
  /** When it last changed, in ms since the epoch. */
  changedAt: number;
  /** The memories it links to with [[name]], in order, each once. */
  links: string[];
  /** Whether the memory index lists it. */
  indexed: boolean;
}

/** Another folder whose memories the agent keeps. */
export interface MemoryFolder {
  /** The folder the agent worked in; null when it can't be told. */
  cwd: string | null;
  /** How many memories it keeps there. */
  count: number;
}

/** The memories an agent keeps for a folder, and what's wrong with them. */
export interface AgentMemories {
  cwd: string;
  /** Where they're kept. */
  folder: string;
  /** The index the agent reads in every chat. */
  index: { path: string; exists: boolean };
  /** Whether the agent keeps memories for the folder at all. */
  enabled: boolean;
  memories: Memory[];
  /** Links and index lines that point at nothing, and memories the index leaves out. */
  problems: string[];
  /** The other folders it keeps memories for, most memories first. */
  elsewhere: MemoryFolder[];
  /** When they were read, in ms since the epoch. */
  at: number;
}

declare module './commands' {
  interface CommandMap {
    /** The memories the agent keeps for a folder, your home folder when there's none; null for agents that keep none. */
    'agents.memories': {
      request: { agent: AgentId; cwd?: string };
      response: AgentMemories | null;
    };
    /** One of the memories the agent keeps for the folder, to read or change. */
    'agents.openMemory': {
      request: { agent: AgentId; cwd?: string; path: string };
      response: SetupFile;
    };
    /** Writes one of the memories the agent keeps for the folder, unless it changed since it was opened. */
    'agents.saveMemory': {
      request: { agent: AgentId; cwd?: string; path: string; text: string; changedAt: number };
      response: SetupFile;
    };
    /** Deletes one of the memories the agent keeps for the folder, and its line in the index, unless it changed since it was opened. */
    'agents.deleteMemory': {
      request: { agent: AgentId; cwd?: string; path: string; changedAt: number };
      response: void;
    };
  }
}

declare module './events' {
  interface EventMap {
    /** A memory the agent keeps for the folder changed, appeared or went: read them again. */
    'agents.memoriesChanged': { agent: AgentId; cwd: string };
  }
}
