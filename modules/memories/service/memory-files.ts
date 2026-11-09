import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, AgentMemories, Memory, SetupFile } from '@grimoire/contract';
import { fileAt, samePath, unchangedSince, writeUnchanged } from '@grimoire/service/agents/files';

/**
 * The index without its lines for a memory file, such as
 * "- [Title](file.md) — what it's about"; null when none names it.
 */
export function withoutEntry(index: string, file: string): string | null {
  const wanted = file.toLowerCase();
  const lines = index.split(/(?<=\n)/);
  const kept = lines.filter((line) => {
    const match = /^\s*[-*]\s*\[[^\]]*\]\(([^)\s]+\.md)\)/.exec(line);
    return !match || path.basename(decodeURIComponent(match[1]!)).toLowerCase() !== wanted;
  });
  return kept.length === lines.length ? null : kept.join('');
}

/**
 * Opens, saves and deletes the memories an agent keeps for a folder, in
 * place (ADR-009). Only the memory files the agent reads in that folder's
 * memory folder are touched.
 */
export class MemoryFiles {
  /** `read` reads what the agent keeps for a folder now. */
  constructor(
    private readonly read: (agent: AgentId, cwd: string) => Promise<AgentMemories | null>,
  ) {}

  async open(agent: AgentId, cwd: string, file: string): Promise<SetupFile> {
    await this.kept(agent, cwd, file);
    return fileAt(file, true);
  }

  async save(
    agent: AgentId,
    cwd: string,
    file: string,
    text: string,
    changedAt: number,
  ): Promise<SetupFile> {
    await this.kept(agent, cwd, file);
    return writeUnchanged(file, text, changedAt);
  }

  /** Deletes the memory, unless it changed since it was opened, and its line in the index. */
  async delete(agent: AgentId, cwd: string, file: string, changedAt: number): Promise<void> {
    const { memories } = await this.kept(agent, cwd, file);
    unchangedSince(file, changedAt);
    unlinkSync(file);
    const index = memories.index.path;
    if (!existsSync(index)) return;
    const text = withoutEntry(readFileSync(index, 'utf8'), path.basename(file));
    if (text !== null) writeFileSync(index, text, 'utf8');
  }

  /** The memory, when the agent keeps it for the folder. */
  private async kept(
    agent: AgentId,
    cwd: string,
    file: string,
  ): Promise<{ memories: AgentMemories; memory: Memory }> {
    const memories = await this.read(agent, cwd);
    const wanted = samePath(file);
    const memory = memories?.memories.find((one) => samePath(one.path) === wanted);
    if (!memories || !memory)
      throw new Error('Only the memories the agent keeps can be opened here.');
    return { memories, memory };
  }
}
