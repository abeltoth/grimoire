import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { appendFile, copyFile, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type { HookRun } from '@grimoire/contract';
import type { WorktreeRecord, WorktreeRecords } from '../storage/worktrees';
import { type Shell, defaultShell, shellEnv } from '../terminal/shell';
import { type Run, expand, runTool } from './git';

/**
 * Runs one of a repository's worktree scripts in a folder, passing on what
 * it prints as it prints it; rejects when it fails.
 */
export type RunScript = (
  script: string,
  cwd: string,
  env: Record<string, string>,
  print: (text: string) => void,
) => Promise<void>;

/** How long a worktree script may run before it's stopped. */
const SCRIPT_MINUTES = 15;

/** Runs the script in your shell, with what the Scriptorium's terminals start with. */
export const runScript: RunScript = (script, cwd, env, print) =>
  new Promise((resolve, reject) => {
    const shell = defaultShell();
    const { args, input } = scriptRun(shell, script);
    const child = spawn(shell.file, args, {
      cwd,
      env: { ...shellEnv(), ...env },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdin?.on('error', () => {}).end(input);
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
    }, SCRIPT_MINUTES * 60_000);
    for (const stream of [child.stdout!, child.stderr!]) stream.setEncoding('utf8').on('data', print);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        new Error(
          stopped
            ? `It was stopped after ${SCRIPT_MINUTES} minutes`
            : code === null
              ? `It was stopped by ${signal}`
              : `It exited with code ${code}`,
        ),
      );
    });
  });

/**
 * How your shell is told to run a script. Another shell gets it with `-c`,
 * after the login flag the terminals start it with and `-i`, so it reads
 * your profile and your .zshrc or .bashrc, as a terminal does: PATH is
 * yours, nvm's included, even when Grimoire was started from the Dock. PowerShell reads
 * it on its input, so what it prints is text, not the XML it writes for an
 * encoded command: a line that runs the script as given, carried in base64
 * so nothing in it needs quoting, writing UTF-8, and exiting with the code
 * of a program that failed last, as a shell does.
 */
export function scriptRun(
  shell: Shell,
  script: string,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; input?: string } {
  if (platform !== 'win32') return { args: [...shell.args, '-i', '-c', script] };
  const body = `${script}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }`;
  const input = [
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `. ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(body).toString('base64')}'))))`,
    '',
    '',
  ].join('\n');
  return { args: [...shell.args, '-NonInteractive', '-Command', '-'], input };
}

/**
 * What a repository runs in each chat's worktree, from `.grimoire.json` at
 * its top: `{ "worktree": { "setup": "npm ci", "cleanup": "…" } }`. Both
 * run in your shell, in the worktree, with GRIMOIRE_WORKTREE and
 * GRIMOIRE_REPO set to the worktree's folder and the repository's.
 */
export interface WorktreeScripts {
  setup?: string;
  cleanup?: string;
}

/** A setup under way: `ended` gives how it went, and never rejects. */
export interface SettingUp {
  ended: Promise<HookRun>;
}

/** Where a repository keeps its chats' worktrees, as Claude Code does. */
const FOLDER = path.join('.claude', 'worktrees');
/** How long removing a worktree is tried for while the agent's process lets go of it. */
const REMOVE_TRIES = [0, 1_000, 3_000, 10_000];
/** How much of what a setup prints is kept: its end, past this. */
const OUTPUT_KEPT = 100_000;
/** How much of what a script printed goes in the service log when it fails. */
const OUTPUT_LOGGED = 2_000;
/** How often a running setup's output is passed on, at most, in ms. */
const PRINT_EVERY = 250;
/** How many paths git is asked about at once. */
const PATHS_AT_ONCE = 200;

/**
 * A worktree of its own for each chat that asks for one, so chats working
 * on one repository side by side don't change each other's files. Each is
 * on a branch of its own, `grimoire/<name>`, from what the folder has
 * checked out, and kept in `.claude/worktrees/<name>` at the repository's
 * top, which git is told to ignore. The files the repository's
 * `.worktreeinclude` names are copied in, and its setup runs before the
 * chat's agent works there. When the chat's chapter closes with nothing
 * uncommitted the worktree is removed, after its cleanup, and its branch
 * kept; when the chat is opened again the worktree is put back on it.
 */
export class Worktrees {
  /** The setups running, by worktree; a worktree isn't removed before its setup ended. */
  private readonly settingUp = new Map<string, Promise<HookRun>>();

  constructor(
    private readonly records: WorktreeRecords,
    private readonly log: (message: string) => void = () => {},
    private readonly run: Run = runTool,
    private readonly script: RunScript = runScript,
  ) {}

  /** Whether the folder is in a git repository, so a chat there can have a worktree of its own. */
  async inRepository(cwd: string): Promise<boolean> {
    return this.git(expand(cwd), 'rev-parse', '--show-toplevel').then(
      () => true,
      () => false,
    );
  }

  /**
   * Makes a worktree for a new chat in the folder's repository, with the
   * files `.worktreeinclude` names; gives the folder the chat works in. Its
   * setup is the chat's to start, with setUp.
   */
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
    await this.include(repo, tree);
    // A chat begun in a folder inside the repository works in the same folder of its worktree.
    return path.join(tree, path.relative(top, folder));
  }

  /**
   * Whether the chat works in a worktree Grimoire made: false when it
   * doesn't, else whether it was there or had to be put back, with the
   * files `.worktreeinclude` names. One put back needs its setup again,
   * which is the chat's to start, with setUp.
   */
  async restore(cwd: string): Promise<false | 'there' | 'put back'> {
    const record = this.recordFor(cwd);
    if (!record) return false;
    if (checkedOut(record.path)) return 'there';
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
    await this.include(record.repo, record.path);
    return 'put back';
  }

  /**
   * Starts the repository's setup in the chat's worktree; nothing when it
   * has none, or the folder isn't in a worktree Grimoire made. `progress`
   * hears the run as it begins, as it prints, at most every quarter second,
   * and as it ends. One that fails is told so, and the chat goes on without
   * it; what went wrong is in the service log too.
   */
  async setUp(cwd: string, progress: (run: HookRun) => void = () => {}): Promise<SettingUp | undefined> {
    const record = this.recordFor(cwd);
    const script = record && (await scriptsOf(record.repo)).setup;
    if (!record || !script) return undefined;
    const run: HookRun = { id: randomUUID(), name: script, event: 'WorktreeSetup', outcome: 'running', at: Date.now() };
    let output = '';
    let timer: NodeJS.Timeout | undefined;
    const now = (): HookRun => ({ ...run, ...(output ? { output } : {}) });
    const tell = () => {
      clearTimeout(timer);
      timer = undefined;
      progress(now());
    };
    tell();
    const ended = this.script(script, record.path, envOf(record), (text) => {
      output = lastOf(output + text, OUTPUT_KEPT);
      timer ??= setTimeout(tell, PRINT_EVERY);
    })
      .then(
        () => {
          this.log(`Ran the worktree setup in ${record.path}`);
          return 'passed' as const;
        },
        (error: unknown) => {
          const why = messageOf(error);
          this.log(`The worktree setup failed in ${record.path}: ${why}`);
          output = lastOf(`${output}${output && !output.endsWith('\n') ? '\n' : ''}${why}`, OUTPUT_KEPT);
          return 'failed' as const;
        },
      )
      .then((outcome) => {
        run.outcome = outcome;
        run.took = Date.now() - run.at!;
        tell();
        if (this.settingUp.get(record.path) === ended) this.settingUp.delete(record.path);
        return now();
      });
    this.settingUp.set(record.path, ended);
    return { ended };
  }

  /**
   * Removes the chat's worktree if nothing in it is uncommitted, after its
   * cleanup script, once any setup running there ended; the branch stays.
   */
  async release(cwd: string): Promise<'removed' | 'kept' | 'none'> {
    const record = this.recordFor(cwd);
    if (record) await this.settingUp.get(record.path);
    if (!record || !checkedOut(record.path)) return 'none';
    const changes = await this.git(record.path, 'status', '--porcelain', '--untracked-files=all');
    if (changes.trim()) {
      this.log(`Kept worktree ${record.path}: it has uncommitted changes`);
      return 'kept';
    }
    await this.cleanUp(record);
    let failure: unknown;
    for (const wait of REMOVE_TRIES) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        // A try that took the worktree from git but couldn't delete its folder,
        // which the agent's process still held, leaves the folder to delete.
        if (checkedOut(record.path)) await this.git(record.repo, 'worktree', 'remove', record.path);
        else await rm(record.path, { recursive: true, force: true });
        this.log(`Removed worktree ${record.path}; ${record.branch} stays`);
        return 'removed';
      } catch (error) {
        // The agent's process may still be letting go of the folder.
        failure = error;
      }
    }
    throw failure;
  }

  /**
   * The folder in its repository a chat's worktree was made from: the same
   * folder inside it. Undefined when the folder isn't in a worktree Grimoire made.
   */
  origin(cwd: string): string | undefined {
    const record = this.recordFor(cwd);
    return record && path.join(record.repo, path.relative(record.path, expand(cwd)));
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

  /** Runs the repository's cleanup in the worktree, if it has one; what went wrong is in the service log. */
  private async cleanUp(record: WorktreeRecord): Promise<void> {
    const script = (await scriptsOf(record.repo)).cleanup;
    if (!script) return;
    let output = '';
    try {
      await this.script(script, record.path, envOf(record), (text) => (output = lastOf(output + text, OUTPUT_LOGGED)));
      this.log(`Ran the worktree cleanup in ${record.path}`);
    } catch (error) {
      this.log(
        `The worktree cleanup failed in ${record.path}: ${messageOf(error)}${output.trim() ? `\n${output.trim()}` : ''}`,
      );
    }
  }

  /**
   * Copies into a worktree the files the repository's `.worktreeinclude`
   * names, as Claude Code does: gitignore patterns for files git ignores,
   * such as `.env`, which a fresh checkout lacks. Only files git ignores in
   * the main checkout are copied; never a link, over a file the worktree
   * already has, or to anywhere outside it.
   */
  private async include(repo: string, tree: string): Promise<void> {
    const patterns = path.join(repo, '.worktreeinclude');
    if (!existsSync(patterns)) return;
    try {
      const named = fieldsOf(
        await this.git(repo, 'ls-files', '--others', '--ignored', '-z', `--exclude-from=${patterns}`),
      );
      const copied: string[] = [];
      const [from, to] = await Promise.all([realpath(repo), realpath(tree)]);
      for (const file of await this.ignored(repo, named))
        if (await copyInto(from, to, file)) copied.push(file);
      if (copied.length) this.log(`Copied ${copied.join(', ')} from ${repo} into ${tree}, as .worktreeinclude says`);
    } catch (error) {
      this.log(`Couldn't copy the files .worktreeinclude names into ${tree}: ${messageOf(error)}`);
    }
  }

  /** Those of the repository's files that git ignores. */
  private async ignored(repo: string, files: readonly string[]): Promise<string[]> {
    const ignored = new Set<string>();
    for (let i = 0; i < files.length; i += PATHS_AT_ONCE) {
      const batch = files.slice(i, i + PATHS_AT_ONCE);
      // It fails when none of them is ignored.
      const out = await this.git(repo, '-c', 'core.quotePath=false', 'check-ignore', '--', ...batch).catch(() => '');
      for (const line of out.split(/\r?\n/)) ignored.add(line);
    }
    // A path git had to quote matches none, and stays.
    return files.filter((file) => ignored.has(file));
  }

  private git(cwd: string, ...args: string[]): Promise<string> {
    return this.run('git', args, cwd);
  }
}

/**
 * Copies a file at this path in the repository into the worktree, unless
 * it's a link, the worktree has one there already, or either side leads
 * outside its folder, as through a link the branch has committed.
 */
async function copyInto(repo: string, tree: string, file: string): Promise<boolean> {
  const from = path.resolve(repo, file);
  const to = path.resolve(tree, file);
  if (!within(repo, from) || !within(tree, to)) return false;
  try {
    if (!(await lstat(from)).isFile() || !within(repo, await realpath(from))) return false;
    // Folders made for it are new; the nearest that's there may be a link.
    let there = path.dirname(to);
    while (!existsSync(there)) there = path.dirname(there);
    if (!within(tree, await realpath(there), true)) return false;
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to, constants.COPYFILE_EXCL);
    return true;
  } catch {
    return false;
  }
}

/** Whether a worktree is checked out in its folder: not gone, nor an empty folder a removal left. */
function checkedOut(tree: string): boolean {
  return existsSync(path.join(tree, '.git'));
}

/** Whether a path is inside a folder, or, when `itself`, the folder itself. */
function within(folder: string, file: string, itself = false): boolean {
  const relative = path.relative(folder, file);
  if (!relative) return itself;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** What a worktree's scripts are told: the worktree's folder and the repository's. */
function envOf(record: WorktreeRecord): Record<string, string> {
  return { GRIMOIRE_WORKTREE: record.path, GRIMOIRE_REPO: record.repo };
}

/** The end of a text, past a length, marked as cut. */
function lastOf(text: string, length: number): string {
  return text.length <= length ? text : `…${text.slice(-length)}`;
}

/** git's NUL-separated paths. */
function fieldsOf(out: string): string[] {
  return out.split('\0').filter(Boolean);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : String(error);
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
