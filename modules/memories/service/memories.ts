import { homedir } from 'node:os';
import type { AgentId, AgentMemories, SetupFile } from '@grimoire/contract';
import { MemoryFiles } from './memory-files';
import { MemoryWatcher } from './memory-watcher';

/** How one agent keeps memories on its own. */
export interface MemorySource {
  /** The memories it keeps for a folder. */
  read(cwd: string): Promise<AgentMemories>;
}

/**
 * The memories each agent keeps for a folder, your home folder when
 * there's none: read, opened, saved and deleted in place, and watched,
 * so `changed` tells when they change.
 */
export class Memories {
  private readonly files = new MemoryFiles((agent, cwd) => this.list(agent, cwd));
  private readonly watcher: MemoryWatcher;

  constructor(
    private readonly sources: ReadonlyMap<AgentId, MemorySource>,
    changed: (agent: AgentId, cwd: string) => void,
  ) {
    this.watcher = new MemoryWatcher(changed);
  }

  /** The memories the agent keeps for the folder; null when it keeps none. */
  async list(agent: AgentId, cwd = homedir()): Promise<AgentMemories | null> {
    const memories = (await this.sources.get(agent)?.read(cwd)) ?? null;
    if (memories) this.watcher.watch(agent, memories);
    return memories;
  }

  /** One of the memories the agent keeps for the folder. */
  open(agent: AgentId, cwd: string | undefined, file: string): Promise<SetupFile> {
    return this.files.open(agent, cwd ?? homedir(), file);
  }

  /** Writes one of the memories the agent keeps for the folder, unless it changed since it was opened. */
  save(
    agent: AgentId,
    cwd: string | undefined,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    return this.files.save(agent, cwd ?? homedir(), file, text, changedAt);
  }

  /** Deletes one of the memories the agent keeps for the folder, and its line in the index. */
  delete(agent: AgentId, cwd: string | undefined, file: string, changedAt: number): Promise<void> {
    return this.files.delete(agent, cwd ?? homedir(), file, changedAt);
  }

  /** Stops watching; reading them again watches them again. */
  dispose(): void {
    this.watcher.dispose();
  }
}
