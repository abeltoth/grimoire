import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, AgentSetup } from '@grimoire/contract';
import { claudeHome } from '@grimoire/service/agents/claude/config-dir';
import { FolderWatcher, type Target } from '@grimoire/service/agents/folder-watcher';

/**
 * The folders to watch for a setup's changes: those its files are in,
 * for those files; the folders new skills, subagents and commands appear
 * in, in your Claude folder and the folder's; and the folder itself, for
 * a new memory file, MCP servers or .claude folder. Only folders that
 * exist can be watched.
 */
export function watchTargets(setup: AgentSetup, claudeFolder: string): Target[] {
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
  for (const root of [claudeFolder, path.join(setup.cwd, '.claude')]) {
    for (const kind of ['skills', 'agents', 'commands']) add(path.join(root, kind), '*');
  }
  add(setup.cwd, ['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', '.claude']);
  return [...targets.values()].filter((target) => existsSync(target.folder));
}

/**
 * Watches the files of the setups last read, and tells once they've
 * settled when one changes, so what shows them can read them again.
 * `claudeFolder` is asked at each read, as switching profiles moves it.
 */
export class SetupWatcher extends FolderWatcher<AgentSetup> {
  constructor(
    changed: (agent: AgentId, cwd: string) => void,
    claudeFolder: () => string = () => claudeHome(),
  ) {
    super((setup) => watchTargets(setup, claudeFolder()), changed);
  }
}
