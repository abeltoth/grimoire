import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, AgentMemories } from '@grimoire/contract';
import { FolderWatcher, type Target } from '@grimoire/service/agents/folder-watcher';

/**
 * The folders to watch for memories' changes: the memory folder, for any
 * file in it; or, while there's none, the folder it would be made in.
 */
export function memoryTargets(memories: AgentMemories): Target[] {
  const targets: Target[] = [
    existsSync(memories.folder)
      ? { folder: memories.folder, names: '*' }
      : { folder: path.dirname(memories.folder), names: new Set([path.basename(memories.folder)]) },
  ];
  return targets.filter((target) => existsSync(target.folder));
}

/**
 * Watches the memory folders last read, and tells once they've settled
 * when a memory changes, appears or goes, so what shows them can read
 * them again.
 */
export class MemoryWatcher extends FolderWatcher<AgentMemories> {
  constructor(changed: (agent: AgentId, cwd: string) => void) {
    super(memoryTargets, changed);
  }
}
