import { type FSWatcher, existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentId, AgentSetup } from '@grimoire/contract';

/** How long the files have to stay still before a change is told, in ms. */
const SETTLE_MS = 300;
/** How many folders' setups are watched at once; the longest unread stops first. */
const WATCHED = 4;

/** A folder to watch, and the names in it that matter; every name for "*". */
type Target = { folder: string; names: Set<string> | '*' };

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
export class SetupWatcher {
  private readonly watching = new Map<string, { watchers: FSWatcher[]; timer?: NodeJS.Timeout }>();

  constructor(
    private readonly changed: (agent: AgentId, cwd: string) => void,
    private readonly home = homedir(),
  ) {}

  /** Watches the setup's files in place of those it was read with before. */
  watch(agent: AgentId, setup: AgentSetup): void {
    const key = `${agent}\0${path.resolve(setup.cwd)}`;
    this.stop(key);
    const entry: { watchers: FSWatcher[]; timer?: NodeJS.Timeout } = { watchers: [] };
    const tell = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.changed(agent, setup.cwd), SETTLE_MS);
      entry.timer.unref?.();
    };
    for (const { folder, names } of watchTargets(setup, this.home)) {
      try {
        const watcher = watch(folder, { persistent: false }, (_event, name) => {
          if (names === '*' || (name && names.has(name.toString()))) tell();
        });
        watcher.on('error', () => watcher.close());
        entry.watchers.push(watcher);
      } catch {
        // A folder that can't be watched just goes unwatched.
      }
    }
    this.watching.set(key, entry);
    for (const old of [...this.watching.keys()].slice(0, -WATCHED)) this.stop(old);
  }

  dispose(): void {
    for (const key of [...this.watching.keys()]) this.stop(key);
  }

  private stop(key: string): void {
    const entry = this.watching.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.watchers.forEach((watcher) => watcher.close());
    this.watching.delete(key);
  }
}
