import { type FSWatcher, watch } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  EventName,
  EventPayload,
  FolderEntry,
  FolderList,
  OpenFile,
} from '@grimoire/contract';
import { samePath, unchangedSince } from '../agents/files';
import { type Git, expand } from '../git/git';

/** A file larger than this isn't opened to edit. */
const LARGEST = 2 * 1024 * 1024;
/** How much of a file is looked at to tell text from binary. */
const SNIFF = 8000;
/** How many open files are watched at once; the longest open stops first. */
const WATCHED = 8;
/** How long a file has to stay still before its change is told, in ms. */
const SETTLE_MS = 300;
/** How many files are looked through by name outside a repository. */
const MOST_FILES = 20_000;
/** How many files a search gives. */
const FOUND = 50;
/** Folders not walked outside a repository. */
const SKIPPED = new Set(['.git', 'node_modules']);

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

interface Watched {
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
  /** When the file was last saved here, so that change isn't told back. */
  saved?: number;
}

/**
 * The Files page's folder: the repository the chat works in, or its
 * folder outside one. Lists it, finds files in it by name, and opens and
 * saves them, telling when one that's open changes on disk.
 */
export class Files {
  private readonly watching = new Map<string, Watched>();

  constructor(
    private readonly git: Git,
    private readonly emit: Emit,
  ) {}

  async list(cwd: string, folder: string): Promise<FolderList> {
    const { root, repo } = await this.where(cwd);
    const dirents = await readdir(inside(root, folder), { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.name !== '.git' && (d.isDirectory() || d.isFile()))
      .map((d): FolderEntry => ({
        name: d.name,
        path: join(folder, d.name),
        kind: d.isDirectory() ? 'folder' : 'file',
      }))
      .sort(
        (a, b) =>
          Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
    const ignored = repo
      ? await this.git.ignored(
          root,
          entries.map((entry) => entry.path),
        )
      : new Set();
    return {
      root,
      entries: entries.map((entry) =>
        ignored.has(entry.path) ? { ...entry, ignored: true } : entry,
      ),
    };
  }

  async find(cwd: string, query: string): Promise<string[]> {
    const words = query
      .toLowerCase()
      .split(/[\s/\\]+/)
      .filter(Boolean);
    if (!words.length) return [];
    const { root, repo } = await this.where(cwd);
    const all = repo ? await this.git.files(root) : await walk(root);
    return all
      .map((file) => ({ file, lower: file.toLowerCase() }))
      .filter(({ lower }) => words.every((word) => lower.includes(word)))
      .map(({ file, lower }) => {
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        // Those named for the words come first, then the shortest paths.
        return { file, named: words.every((word) => name.includes(word)) };
      })
      .sort(
        (a, b) =>
          Number(b.named) - Number(a.named) ||
          a.file.length - b.file.length ||
          a.file.localeCompare(b.file),
      )
      .slice(0, FOUND)
      .map(({ file }) => file);
  }

  async open(cwd: string, file: string): Promise<OpenFile> {
    const { root, repo } = await this.where(cwd);
    const { full, shown } = locate(root, file);
    const opened = await this.read(root, repo, full, shown);
    this.watch(root, full, shown);
    return opened;
  }

  async save(cwd: string, file: string, text: string, changedAt: number): Promise<OpenFile> {
    const { root, repo } = await this.where(cwd);
    const { full, shown } = locate(root, file);
    unchangedSince(full, changedAt);
    await writeFile(full, text, 'utf8');
    const saved = await this.read(root, repo, full, shown);
    const watched = this.watching.get(samePath(full));
    if (watched) watched.saved = saved.changedAt;
    return saved;
  }

  async close(cwd: string, file: string): Promise<void> {
    const { root } = await this.where(cwd);
    this.stop(samePath(locate(root, file).full));
  }

  dispose(): void {
    for (const key of [...this.watching.keys()]) this.stop(key);
  }

  /** The folder the page shows: the repository's top folder, or the chat's folder outside one. */
  private async where(cwd: string): Promise<{ root: string; repo: boolean }> {
    const top = await this.git.root(cwd);
    return top ? { root: top, repo: true } : { root: path.resolve(expand(cwd)), repo: false };
  }

  private async read(root: string, repo: boolean, full: string, file: string): Promise<OpenFile> {
    const info = await stat(full);
    if (!info.isFile()) throw new Error(`${file} isn’t a file`);
    const at = { path: file, text: '', changedAt: info.mtimeMs };
    if (info.size > LARGEST) return { ...at, unshown: 'large' };
    const bytes = await readFile(full);
    if (bytes.subarray(0, SNIFF).includes(0)) return { ...at, unshown: 'binary' };
    const committed = await this.committedOf(root, repo, full, file);
    return {
      ...at,
      text: bytes.toString('utf8'),
      ...(committed !== undefined ? { committed } : {}),
    };
  }

  /** Its text as last committed, from the folder's repository, or, for a file outside it, from its own. */
  private async committedOf(
    root: string,
    repo: boolean,
    full: string,
    file: string,
  ): Promise<string | null | undefined> {
    if (!path.isAbsolute(file)) return repo ? this.git.committed(root, file) : undefined;
    const top = await this.git.root(path.dirname(full));
    return top ? this.git.committed(top, slashed(path.relative(top, full))) : undefined;
  }

  /** Tells, once it settles, when an open file changes on disk; not when it was saved here. */
  private watch(root: string, full: string, file: string): void {
    const key = samePath(full);
    if (this.watching.has(key)) return;
    const name = path.basename(full);
    try {
      // Its folder is watched, as an agent may write a file by putting a new one in its place.
      const watcher = watch(path.dirname(full), { persistent: false }, (_event, changed) => {
        if (changed?.toString() !== name) return;
        const entry = this.watching.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => void this.tell(key, root, full, file), SETTLE_MS);
        entry.timer.unref?.();
      });
      watcher.on('error', () => this.stop(key));
      this.watching.set(key, { watcher });
    } catch {
      // A file that can't be watched just goes unwatched.
    }
    for (const old of [...this.watching.keys()].slice(0, -WATCHED)) this.stop(old);
  }

  private async tell(key: string, root: string, full: string, file: string): Promise<void> {
    const entry = this.watching.get(key);
    if (!entry) return;
    const at = await stat(full).then(
      (info) => info.mtimeMs,
      () => 0,
    );
    if (entry.saved !== undefined && at === entry.saved) return;
    this.emit('files.changed', { root, path: file });
  }

  private stop(key: string): void {
    const entry = this.watching.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.watcher.close();
    this.watching.delete(key);
  }
}

/**
 * A file to open: from the folder, or anywhere when written in full. Gives
 * where it is, with the system's slashes, and how the page names it: from
 * the folder, or in full outside it, with forward slashes.
 */
function locate(root: string, file: string): { full: string; shown: string } {
  const written = expand(file);
  if (!path.isAbsolute(written)) {
    const full = inside(root, written);
    return { full, shown: slashed(path.relative(root, full)) };
  }
  const full = path.resolve(written);
  const relative = path.relative(root, full);
  const within = !relative.startsWith('..') && !path.isAbsolute(relative);
  return { full, shown: slashed(within ? relative : full) };
}

function slashed(file: string): string {
  return file.replaceAll('\\', '/');
}

/** A path inside the folder, with the system's slashes; refuses one outside it. */
function inside(root: string, file: string): string {
  const full = path.resolve(root, file);
  const relative = path.relative(root, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${file} is outside the folder`);
  }
  return full;
}

function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** The files in a folder that isn't a repository, with forward slashes, up to a limit. */
async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  const folders = [''];
  while (folders.length && found.length < MOST_FILES) {
    const folder = folders.shift()!;
    const dirents = await readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const d of dirents) {
      if (d.isDirectory() && !SKIPPED.has(d.name)) folders.push(join(folder, d.name));
      else if (d.isFile()) found.push(join(folder, d.name));
    }
  }
  return found.slice(0, MOST_FILES);
}
