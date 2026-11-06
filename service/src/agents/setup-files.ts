import type { AgentId, AgentSetup, SetupFile, SetupSource } from '@grimoire/contract';
import { fileAt, samePath as same, writeUnchanged } from './files';

/** Sources whose files aren't changed here: your organization's, and those a plugin update would replace. */
const READ_ONLY: readonly SetupSource[] = ['managed', 'plugin', 'built-in'];

/**
 * Opens and saves the files of an agent's setup (ADR-009: Claude Code's
 * config is edited in place, in its own format). Only the files the
 * setup last read in the folder lists can be opened, and only those that
 * are yours or the project's can be changed.
 */
export class SetupFiles {
  private readonly known = new Map<string, AgentSetup>();

  /** `read` asks the agent for its setup in a folder again, for a file it didn't list before. */
  constructor(private readonly read: (agent: AgentId, cwd: string) => Promise<AgentSetup | null>) {}

  /** Keeps the setup the agent told, so its files can be opened. */
  remember(agent: AgentId, setup: AgentSetup): void {
    this.known.set(`${agent}\0${same(setup.cwd)}`, setup);
  }

  async open(agent: AgentId, cwd: string, file: string): Promise<SetupFile> {
    const { editable } = await this.listed(agent, cwd, file);
    return fileAt(file, editable);
  }

  async save(
    agent: AgentId,
    cwd: string,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    const { editable } = await this.listed(agent, cwd, file);
    if (!editable) throw new Error('This file can only be read here.');
    if (file.toLowerCase().endsWith('.json')) {
      try {
        JSON.parse(text);
      } catch (error) {
        throw new Error(
          `This isn’t valid JSON, so Claude Code couldn’t read it: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return writeUnchanged(file, text, changedAt);
  }

  /** Whether the setup lists the file, and may change it; asks again once when it isn't listed. */
  private async listed(agent: AgentId, cwd: string, file: string): Promise<{ editable: boolean }> {
    const key = `${agent}\0${same(cwd)}`;
    let found = this.find(this.known.get(key), file);
    if (!found) {
      const setup = await this.read(agent, cwd);
      if (setup) this.remember(agent, setup);
      found = this.find(setup ?? undefined, file);
    }
    if (!found) throw new Error('Only the files the agent loads can be opened here.');
    return found;
  }

  private find(setup: AgentSetup | undefined, file: string): { editable: boolean } | undefined {
    if (!setup) return undefined;
    const wanted = same(file);
    const listed = [...Object.values(setup.sections).flat(), ...setup.settingsFiles].filter(
      (item) => item.path && same(item.path) === wanted,
    );
    if (!listed.length) return undefined;
    return { editable: listed.some((item) => !READ_ONLY.includes(item.source)) };
  }
}
