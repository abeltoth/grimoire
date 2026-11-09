import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentId, AgentSetup, SetupFile } from '@grimoire/contract';
import { samePath } from '@grimoire/service/agents/files';
import { SetupFiles } from './setup-files';
import { SetupWatcher } from './setup-watcher';

/** How one agent tells what it loads in a folder. */
export interface SetupReader {
  read(cwd: string): Promise<AgentSetup>;
}

/**
 * What each agent loads in a folder, your home folder when there's none:
 * read, its files opened and saved in place, and watched, so `changed`
 * tells when they change.
 */
export class Setup {
  private readonly files = new SetupFiles((agent, cwd) => this.get(agent, cwd));
  private readonly watcher: SetupWatcher;

  constructor(
    private readonly readers: ReadonlyMap<AgentId, SetupReader>,
    changed: (agent: AgentId, cwd: string) => void,
  ) {
    this.watcher = new SetupWatcher(changed);
  }

  /** What the agent loads in the folder; null when it can't say. */
  async get(agent: AgentId, cwd = homedir()): Promise<AgentSetup | null> {
    const setup = (await this.readers.get(agent)?.read(cwd)) ?? null;
    if (setup) {
      this.files.remember(agent, setup);
      this.watcher.watch(agent, setup);
    }
    return setup;
  }

  /** One of the files the agent's setup in the folder lists. */
  openFile(agent: AgentId, cwd: string | undefined, file: string): Promise<SetupFile> {
    return this.files.open(agent, cwd ?? homedir(), file);
  }

  /** Writes one of the files the agent's setup in the folder lists, unless it changed since it was opened. */
  saveFile(
    agent: AgentId,
    cwd: string | undefined,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    return this.files.save(agent, cwd ?? homedir(), file, text, changedAt);
  }

  /** Stops watching; reading a setup again watches it again. */
  dispose(): void {
    this.watcher.dispose();
  }
}

/**
 * Of the folders chats ran in, most recent first, those still there,
 * leaving out those in the temp folder, such as a test run's.
 */
export function setupFolders(recent: readonly string[], temp = tmpdir()): string[] {
  const inTemp = samePath(temp) + path.sep;
  return recent.filter((cwd) => existsSync(cwd) && !(samePath(cwd) + path.sep).startsWith(inTemp));
}
