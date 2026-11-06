import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentId, AgentSetup } from '@grimoire/contract';
import { FolderWatcher, type Target } from './folder-watcher';

/**
 * The folders to watch for a setup's changes: those its files are in,
 * for those files; the folders new skills, subagents and commands appear
 * in; and the folder itself, for a new memory file, MCP servers or
 * .claude folder. Only folders that exist can be watched.
 */
export function watchTargets(setup: AgentSetup, home: string): Target[] {
  const targets = new Map<string, Target>();
  const add = (folder: string, names: readonly string[] | '*') => {
    const key = path.resolve(folder);
    const known = targets.get(key);
    if (names === '*' || known?.names === '*') {
      targets.set(key, { folder: key, names: '*' });
    } else {
      targets.set(key, { folder: key, names: new Set([...(known?.names ?? []), ...names]) });
    }
  };
  const files = [...Object.values(setup.sections).flat(), ...setup.settingsFiles];
  for (const { path: file } of files) {
    if (file) add(path.dirname(file), [path.basename(file)]);
  }
  for (const root of [path.join(home, '.claude'), path.join(setup.cwd, '.claude')]) {
    for (const kind of ['skills', 'agents', 'commands']) add(path.join(root, kind), '*');
  }
  add(setup.cwd, ['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', '.claude']);
  return [...targets.values()].filter((target) => existsSync(target.folder));
}

/**
 * Watches the files of the setups last read, and tells once they've
 * settled when one changes, so what shows them can read them again.
 */
export class SetupWatcher extends FolderWatcher<AgentSetup> {
  constructor(changed: (agent: AgentId, cwd: string) => void, home = homedir()) {
    super((setup) => watchTargets(setup, home), changed);
  }
}
