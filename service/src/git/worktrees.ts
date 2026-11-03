import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorktreeRecord, WorktreeRecords } from '../storage/worktrees';
import { type Run, expand, runTool } from './git';

/** Runs one of a repository's worktree scripts in a folder; rejects when it fails. */
export type RunScript = (script: string, cwd: string, env: Record<string, string>) => Promise<void>;

export const runScript: RunScript = (script, cwd, env) =>
  new Promise((resolve, reject) => {
    exec(
      script,
      { cwd, env: { ...process.env, ...env }, timeout: 15 * 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) =>
        error ? reject(new Error(`${error.message.trim()}${stderr.trim() ? `\n${stderr.trim()}` : ''}`)) : resolve(),
    );
  });

/**
 * What a repository runs in each chat's worktree, from `.grimoire.json` at
 * its top: `{ "worktree": { "setup": "npm ci", "cleanup": "…" } }`. Both
 * run in the worktree, with GRIMOIRE_WORKTREE and GRIMOIRE_REPO set to the
 * worktree's folder and the repository's.
 */
export interface WorktreeScripts {
  setup?: string;
  cleanup?: string;
}

/** Where a repository keeps its chats' worktrees, as Claude Code does. */
const FOLDER = path.join('.claude', 'worktrees');
/** How long removing a worktree is tried for while the agent's process lets go of it. */
const REMOVE_TRIES = [0, 1_000, 3_000, 10_000];

/**
 * A worktree of its own for each chat that asks for one, so chats working
 * on one repository side by side don't change each other's files. Each is
 * on a branch of its own, `grimoire/<name>`, from what the folder has
 * checked out, and kept in `.claude/worktrees/<name>` at the repository's
 * top, which git is told to ignore. When the chat's chapter closes with
 * nothing uncommitted the worktree is removed and its branch kept; when
 * the chat is opened again the worktree is put back on it.
 */
export class Worktrees {
  constructor(
    private readonly records: WorktreeRecords,
    private readonly log: (message: string) => void = () => {},
    private readonly run: Run = runTool,
    private readonly script: RunScript = runScript,
  ) {}

  /** Makes a worktree for a new chat in the folder's repository; gives the folder the chat works in. */
  async make(cwd: string, name: string): Promise<string> {
    const folder = expand(cwd);
    const top = await this.git(folder, 'rev-parse', '--show-toplevel').then(
      (out) => path.resolve(out.trim()),
      () => {
        throw new Error(`${cwd} isn’t in a git repository, so the chat can’t have a worktree of its own`);
      },
    );
    // A worktree's chats get theirs in its main repository, beside the others.
    const common = path.resolve(top, (await this.git(top, 'rev-parse', '--git-common-dir')).trim());
    const repo = path.basename(common) === '.git' ? path.dirname(common) : top;
    const slug = await this.freeName(repo, slugOf(name));
    const tree = path.join(repo, FOLDER, slug);
    const branch = `grimoire/${slug}`;
    await mkdir(path.dirname(tree), { recursive: true });
    await this.git(top, 'worktree', 'add', '-b', branch, tree, 'HEAD');
    await this.ignore(common);
    this.records.add({ path: tree, repo, branch });
    this.log(`Made worktree ${tree} on ${branch}`);
    await this.runScript('setup', tree, repo);
    // A chat begun in a folder inside the repository works in the same folder of its worktree.
    return path.join(tree, path.relative(top, folder));
  }

  /** Whether the chat works in a worktree Grimoire made; puts it back first if it's gone. */
  async restore(cwd: string): Promise<boolean> {
    const record = this.recordFor(cwd);
    if (!record) return false;
    if (existsSync(record.path)) return true;
    await this.git(record.repo, 'worktree', 'prune');
    const branched = await this.git(record.repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${record.branch}`).then(
      () => true,
      () => false,
    );
    await this.git(
      record.repo,
      'worktree',
      'add',
      ...(branched ? [record.path, record.branch] : ['-b', record.branch, record.path, 'HEAD']),
    );
    this.log(`Put back worktree ${record.path} on ${record.branch}`);
    await this.runScript('setup', record.path, record.repo);
    return true;
  }

  /** Removes the chat's worktree if nothing in it is uncommitted, after its cleanup script; the branch stays. */
  async release(cwd: string): Promise<'removed' | 'kept' | 'none'> {
    const record = this.recordFor(cwd);
    if (!record || !existsSync(record.path)) return 'none';
    const changes = await this.git(record.path, 'status', '--porcelain', '--untracked-files=all');
    if (changes.trim()) {
      this.log(`Kept worktree ${record.path}: it has uncommitted changes`);
      return 'kept';
    }
    await this.runScript('cleanup', record.path, record.repo);
    let failure: unknown;
    for (const wait of REMOVE_TRIES) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        await this.git(record.repo, 'worktree', 'remove', record.path);
        this.log(`Removed worktree ${record.path}; ${record.branch} stays`);
        return 'removed';
      } catch (error) {
        // The agent's process may still be letting go of the folder.
        failure = error;
      }
    }
    throw failure;
  }

  /** The worktree a chat's folder is in, if Grimoire made it. */
  private recordFor(cwd: string): WorktreeRecord | undefined {
    const folder = path.resolve(expand(cwd)).toLowerCase();
    return this.records.all().find((record) => {
      const tree = path.resolve(record.path).toLowerCase();
      return folder === tree || folder.startsWith(tree + path.sep);
    });
  }

  /** The name, or the name with a number after it when a branch or folder already has it. */
  private async freeName(repo: string, name: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name}-${n}`;
      const taken =
        existsSync(path.join(repo, FOLDER, candidate)) ||
        (await this.git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/grimoire/${candidate}`).then(
          () => true,
          () => false,
        ));
      if (!taken) return candidate;
    }
  }

  /** Tells git to ignore the worktrees folder in this clone only, leaving .gitignore alone. */
  private async ignore(common: string): Promise<void> {
    const exclude = path.join(common, 'info', 'exclude');
    const line = '/.claude/worktrees/';
    const text = await readFile(exclude, 'utf8').catch(() => '');
    if (text.split(/\r?\n/).includes(line)) return;
    await mkdir(path.dirname(exclude), { recursive: true });
    await appendFile(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
  }

  private async runScript(which: keyof WorktreeScripts, tree: string, repo: string): Promise<void> {
    const script = (await scriptsOf(repo))[which];
    if (!script) return;
    try {
      await this.script(script, tree, { GRIMOIRE_WORKTREE: tree, GRIMOIRE_REPO: repo });
      this.log(`Ran the worktree ${which} in ${tree}`);
    } catch (error) {
      // The chat goes on without it; what went wrong is in the service log.
      this.log(`The worktree ${which} failed in ${tree}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private git(cwd: string, ...args: string[]): Promise<string> {
    return this.run('git', args, cwd);
  }
}

/** The repository's worktree scripts; none when it has no `.grimoire.json` or it can't be read. */
export async function scriptsOf(repo: string): Promise<WorktreeScripts> {
  try {
    const config = JSON.parse(await readFile(path.join(repo, '.grimoire.json'), 'utf8')) as {
      worktree?: WorktreeScripts;
    };
    const { setup, cleanup } = config.worktree ?? {};
    return {
      ...(typeof setup === 'string' && setup.trim() ? { setup } : {}),
      ...(typeof cleanup === 'string' && cleanup.trim() ? { cleanup } : {}),
    };
  } catch {
    return {};
  }
}

/** A worktree's name from the chat's first words, such as "add-a-context-meter". */
export function slugOf(text: string): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words.slice(0, 5)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || (words[0]?.slice(0, 40) ?? '') || 'chapter';
}
