import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';
import type { AgentId } from '@grimoire/contract';

/** How long the files have to stay still before a change is told, in ms. */
const SETTLE_MS = 300;
/** How many folders' reads are watched at once; the longest unread stops first. */
const WATCHED = 4;

/** The watchers on one folder's files, and whose they are. */
interface Watching {
  watchers: FSWatcher[];
  timer?: NodeJS.Timeout;
  agent: AgentId;
  cwd: string;
}

/** A folder to watch, and the names in it that matter; every name for "*". */
export type Target = { folder: string; names: Set<string> | '*' };

/**
 * Watches the files behind what an agent last told of a folder, and
 * tells once they've settled when one changes, so what shows it can
 * read it again.
 */
export class FolderWatcher<Told extends { cwd: string }> {
  private readonly watching = new Map<string, Watching>();

  constructor(
    private readonly targets: (told: Told) => Target[],
    private readonly changed: (agent: AgentId, cwd: string) => void,
  ) {}

  /** Watches the files behind what the agent told, in place of those it told of the folder before. */
  watch(agent: AgentId, told: Told): void {
    const key = `${agent}\0${path.resolve(told.cwd)}`;
    this.stop(key);
    const entry: Watching = { watchers: [], agent, cwd: told.cwd };
    const tell = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.changed(agent, told.cwd), SETTLE_MS);
      entry.timer.unref?.();
    };
    for (const { folder, names } of this.targets(told)) {
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

  /** Tells each folder watched as changed, for a change outside its files that alters what it holds. */
  changedAll(): void {
    for (const { agent, cwd } of this.watching.values()) this.changed(agent, cwd);
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
