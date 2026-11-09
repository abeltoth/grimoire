import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DiffLine,
  GitBranch,
  GitBranches,
  GitChange,
  GitStatus,
  PullRequest,
} from '@grimoire/contract';
import { expand } from '@grimoire/service/agents/files';

/** Runs git or the GitHub CLI in a folder and gives what it printed; rejects when it fails. */
export type Run = (tool: 'git' | 'gh', args: string[], cwd: string) => Promise<string>;

export const runTool: Run = (tool, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 20_000,
        windowsHide: true,
        // Reading the state never takes git's locks, so it can't get in an agent's way.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1' },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** How long a branch's pull request is kept before GitHub is asked again. */
const PULL_REQUEST_FRESH_MS = 30_000;
/** A new file larger than this isn't shown line by line. */
const LARGEST_NEW_FILE = 1024 * 1024;

/**
 * Git and GitHub through their command-line tools (ADR-011), read live and
 * never stored (ADR-009).
 */
export class Git {
  private readonly pullRequests = new Map<
    string,
    { at: number; pr: Promise<PullRequest | null> }
  >();

  constructor(private readonly run: Run = runTool) {}

  /** The top folder of the repository or worktree the folder is in; null outside one. */
  async root(cwd: string): Promise<string | null> {
    try {
      // Git writes it with forward slashes; written the system's way, it matches the chat's folder.
      return path.resolve((await this.git(expand(cwd), 'rev-parse', '--show-toplevel')).trim());
    } catch {
      return null;
    }
  }

  async status(cwd: string): Promise<GitStatus | null> {
    const root = await this.root(cwd);
    if (!root) return null;
    return parseStatus(
      root,
      await this.git(root, 'status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'),
    );
  }

  async branches(cwd: string): Promise<GitBranches | null> {
    const root = await this.root(cwd);
    if (!root) return null;
    const names = (await this.git(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'))
      .split('\n')
      .filter(Boolean);
    const remoteDefault = await this.git(
      root,
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    )
      .then((ref) => ref.trim().replace(/^origin\//, ''))
      .catch(() => '');
    const trunk =
      [remoteDefault, 'main', 'master'].find((name) => name && names.includes(name)) ?? null;
    const fields = [
      '%(refname:short)',
      '%(HEAD)',
      '%(worktreepath)',
      '%(committerdate:unix)',
      trunk ? `%(ahead-behind:${trunk})` : '0 0',
      '%(subject)',
    ];
    const out = await this.git(
      root,
      'for-each-ref',
      `--format=${fields.join('%00')}`,
      'refs/heads',
    );
    const here = path.resolve(root).toLowerCase();
    const branches = out
      .split('\n')
      .filter(Boolean)
      .map((line): GitBranch => {
        const [name = '', head, worktree = '', at, counts = '0 0', subject = ''] = line.split('\0');
        const [ahead = 0, behind = 0] = counts.split(' ').map(Number);
        const elsewhere = worktree && path.resolve(worktree).toLowerCase() !== here;
        return {
          name,
          current: head === '*',
          ahead,
          behind,
          subject,
          at: Number(at) * 1000,
          ...(elsewhere ? { worktree } : {}),
        };
      })
      // The trunk first, then the newest.
      .sort((a, b) => Number(b.name === trunk) - Number(a.name === trunk) || b.at - a.at);
    return { trunk, branches };
  }

  /** A file's change since the last commit, staged or not; a new file is all inserted. */
  async diff(cwd: string, file: string): Promise<DiffLine[]> {
    const root = await this.root(cwd);
    if (!root) return [];
    const full = path.resolve(root, file);
    // Only files inside the repository.
    if (path.relative(root, full).startsWith('..') || path.isAbsolute(path.relative(root, full))) {
      return [];
    }
    const out = await this.git(
      root,
      'diff',
      'HEAD',
      '--no-color',
      '--no-ext-diff',
      '--',
      file,
    ).catch(() => '');
    if (out.trim()) return parseDiff(out);
    try {
      const text = await readFile(full, 'utf8');
      if (text.length > LARGEST_NEW_FILE || text.includes('\0')) return [];
      return linesOf(text).map((line) => ({ kind: 'inserted', text: line }));
    } catch {
      return [];
    }
  }

  /**
   * A file as last committed, when it has changed since: null for a file
   * that's new. Undefined when it hasn't changed, or outside a repository.
   * The path is from the repository's top folder.
   */
  async committed(cwd: string, file: string): Promise<string | null | undefined> {
    const root = await this.root(cwd);
    if (!root) return undefined;
    const status = await this.git(
      root,
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--',
      file,
    ).catch(() => '');
    if (!status) return undefined;
    if (status.startsWith('??') || status.startsWith('A')) return null;
    return this.git(root, 'show', `HEAD:${file}`).catch(() => null);
  }

  /** Which of the paths, from the repository's top folder, git ignores. */
  async ignored(root: string, paths: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    // A few at a time, to stay inside the command line's limit.
    for (let i = 0; i < paths.length; i += 100) {
      const some = paths.slice(i, i + 100);
      const out = await this.git(
        root,
        '-c',
        'core.quotePath=false',
        'check-ignore',
        '--',
        ...some,
      ).catch(() => '');
      for (const file of out.split(/\r?\n/)) if (file) found.add(file);
    }
    return found;
  }

  /** The repository's files that git doesn't ignore, committed or not, from its top folder. */
  async files(root: string): Promise<string[]> {
    const out = await this.git(
      root,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    );
    return [...new Set(out.split('\0').filter(Boolean))];
  }

  /** The pull request for the folder's branch, as gh sees it; kept for half a minute. */
  pullRequest(cwd: string): Promise<PullRequest | null> {
    const folder = expand(cwd);
    const kept = this.pullRequests.get(folder);
    if (kept && Date.now() - kept.at < PULL_REQUEST_FRESH_MS) return kept.pr;
    const pr = this.run(
      'gh',
      ['pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'],
      folder,
    )
      .then((out) => toPullRequest(JSON.parse(out) as GhPullRequest))
      // No pull request, no GitHub remote, or gh missing or signed out.
      .catch(() => null);
    this.pullRequests.set(folder, { at: Date.now(), pr });
    return pr;
  }

  private git(cwd: string, ...args: string[]): Promise<string> {
    return this.run('git', args, cwd);
  }
}

/** `git status --porcelain=v2 --branch -z`, read. */
export function parseStatus(root: string, out: string): GitStatus {
  const fields = out.split('\0');
  let branch: string | null = null;
  let head: string | null = null;
  let upstream: GitStatus['upstream'];
  const changes: GitChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const words = field.split(' ');
    const after = (count: number) => words.slice(count).join(' ');
    if (field.startsWith('# branch.oid ')) {
      head = words[2] === '(initial)' ? null : words[2]!.slice(0, 7);
    } else if (field.startsWith('# branch.head ')) {
      branch = words[2] === '(detached)' ? null : after(2);
    } else if (field.startsWith('# branch.upstream ')) {
      upstream = { name: after(2), ahead: 0, behind: 0 };
    } else if (field.startsWith('# branch.ab ') && upstream) {
      upstream.ahead = Math.abs(Number(words[2]));
      upstream.behind = Math.abs(Number(words[3]));
    } else if (field.startsWith('1 ')) {
      changes.push(changeOf(words[1]!, after(8)));
    } else if (field.startsWith('2 ')) {
      // A rename names the file it was in the next field.
      changes.push({
        path: after(9),
        kind: 'renamed',
        from: fields[++i]!,
        staged: words[1]![0] !== '.',
      });
    } else if (field.startsWith('u ')) {
      changes.push({ path: after(10), kind: 'conflicted', staged: false });
    } else if (field.startsWith('? ')) {
      changes.push({ path: field.slice(2), kind: 'new', staged: false });
    }
  }
  return { root, branch, head, ...(upstream ? { upstream } : {}), changes };
}

function changeOf(xy: string, file: string): GitChange {
  const [staged = '.', unstaged = '.'] = xy;
  const either = (code: string) => staged === code || unstaged === code;
  const kind = either('A') ? 'new' : either('D') ? 'deleted' : 'modified';
  return { path: file, kind, staged: staged !== '.' };
}

/** A unified diff as diff lines; the lines between its hunks are left out, marked "⋯". */
export function parseDiff(out: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let hunks = 0;
  let inHunk = false;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('@@')) {
      if (hunks++) lines.push({ kind: 'same', text: '⋯' });
      inHunk = true;
    } else if (!inHunk) continue;
    else if (line.startsWith('+')) lines.push({ kind: 'inserted', text: line.slice(1) });
    else if (line.startsWith('-')) lines.push({ kind: 'removed', text: line.slice(1) });
    else if (line.startsWith(' ')) lines.push({ kind: 'same', text: line.slice(1) });
  }
  return lines;
}

function linesOf(text: string): string[] {
  return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** What `gh pr view --json` gives for the fields asked for. */
export interface GhPullRequest {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  reviewDecision: string | null;
  statusCheckRollup?: {
    __typename: 'CheckRun' | 'StatusContext';
    status?: string;
    conclusion?: string;
    state?: string;
  }[];
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PENDING = new Set(['PENDING', 'EXPECTED', '']);

export function toPullRequest(pr: GhPullRequest): PullRequest {
  const checks = { passed: 0, failed: 0, pending: 0 };
  for (const check of pr.statusCheckRollup ?? []) {
    const outcome =
      check.__typename === 'StatusContext'
        ? (check.state ?? '')
        : check.status === 'COMPLETED'
          ? (check.conclusion ?? '')
          : 'PENDING';
    if (PASSED.has(outcome)) checks.passed++;
    else if (PENDING.has(outcome)) checks.pending++;
    else checks.failed++;
  }
  const REVIEWS: Record<string, PullRequest['review']> = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes-requested',
    REVIEW_REQUIRED: 'review-required',
  };
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state:
      pr.state === 'MERGED'
        ? 'merged'
        : pr.state === 'CLOSED'
          ? 'closed'
          : pr.isDraft
            ? 'draft'
            : 'open',
    review: REVIEWS[pr.reviewDecision ?? ''] ?? null,
    checks,
  };
}
