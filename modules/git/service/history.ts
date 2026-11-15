import type {
  CommitChat,
  DiffLine,
  GitCommit,
  GitCommitDetail,
  GitCommitFile,
  GitLog,
} from '@grimoire/contract';
import { type Git, type Run, inside, parseDiff, runTool } from './git';

/** How many of a branch's own commits are looked for, so a long-lived branch stays quick. */
const MOST_OWN = 500;
/** Separates a commit's fields; a record ends at a NUL. */
const FIELD = '\x1f';
const FORMAT = ['%H', '%h', '%P', '%an', '%at', '%s'].join('%x1f');

/** Which of the commits a chat made, by sha. */
export type ChatsOf = (shas: string[]) => Map<string, CommitChat>;

/** A repository's history: its commits, what each changed, and the chat that made it. */
export class History {
  constructor(
    private readonly git: Git,
    private readonly chatsOf: ChatsOf = () => new Map(),
    private readonly run: Run = runTool,
  ) {}

  /** A page of the history from a branch or commit, newest first, its own commits marked. */
  async log(cwd: string, ref: string, skip: number, limit: number): Promise<GitLog | null> {
    const root = await this.git.root(cwd);
    if (!root) return null;
    const sha = await this.resolve(root, ref);
    if (!sha) return null;
    const out = await this.tool(
      root,
      'log',
      '-z',
      `--format=${FORMAT}`,
      `--skip=${Math.max(0, Math.floor(skip))}`,
      `--max-count=${Math.max(1, Math.floor(limit)) + 1}`,
      sha,
    );
    const all = parseLog(out);
    const commits = all.slice(0, limit);
    const own = await this.ownOf(root, sha);
    const chats = this.chatsOf(commits.map((commit) => commit.sha));
    return {
      commits: commits.map((commit) =>
        withChat(own.has(commit.sha) ? { ...commit, own: true } : commit, chats),
      ),
      more: all.length > limit,
    };
  }

  /** A commit's whole message and the files it changed against its first parent. */
  async commit(cwd: string, sha: string): Promise<GitCommitDetail | null> {
    const root = await this.git.root(cwd);
    const full = root && (await this.resolve(root, sha));
    if (!root || !full) return null;
    const out = await this.tool(root, 'show', '-s', `--format=${FORMAT}%x1f%b`, full);
    const [head, body = ''] = splitAt(out, FIELD, 6);
    const commit = parseCommit(head);
    if (!commit) return null;
    const range = rangeOf(commit);
    const [names, counts] = await Promise.all([
      this.tool(root, 'diff-tree', '--no-commit-id', '-r', '-z', '-M', '--name-status', ...range),
      this.tool(root, 'diff-tree', '--no-commit-id', '-r', '-z', '-M', '--numstat', ...range),
    ]);
    const lines = parseNumstat(counts);
    const files = parseNameStatus(names).map((file) => ({
      ...file,
      ...(lines.get(file.path) ?? { added: null, removed: null }),
    }));
    return withChat({ ...commit, body: body.trim(), files }, this.chatsOf([commit.sha]));
  }

  /** A file's change in a commit, against its first parent; `from` is where a renamed file was. */
  async commitDiff(cwd: string, sha: string, file: string, from?: string): Promise<DiffLine[]> {
    const root = await this.git.root(cwd);
    if (!root || !inside(root, file) || (from !== undefined && !inside(root, from))) return [];
    const full = await this.resolve(root, sha);
    if (!full) return [];
    const parents = (await this.tool(root, 'rev-parse', `${full}^@`).catch(() => ''))
      .split(/\s+/)
      .filter(Boolean);
    const out = await this.tool(
      root,
      'diff-tree',
      '--no-commit-id',
      '-p',
      '-M',
      '--no-color',
      ...rangeOf({ sha: full, parents }),
      '--',
      file,
      ...(from && from !== file ? [from] : []),
    ).catch(() => '');
    return parseDiff(out);
  }

  /** The full sha of a branch or commit; null for one the repository hasn't got. */
  private async resolve(root: string, ref: string): Promise<string | null> {
    // A name starting with a dash would be read as an option.
    if (!ref || ref.startsWith('-')) return null;
    const sha = await this.tool(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).catch(
      () => '',
    );
    return sha.trim() || null;
  }

  /** The commits reachable from the sha and not from the trunk. */
  private async ownOf(root: string, sha: string): Promise<Set<string>> {
    const trunk = await this.git.trunk(root).catch(() => null);
    if (!trunk) return new Set();
    const out = await this.tool(
      root,
      'rev-list',
      `--max-count=${MOST_OWN}`,
      sha,
      '--not',
      `refs/heads/${trunk}`,
    ).catch(() => '');
    return new Set(out.split(/\s+/).filter(Boolean));
  }

  private tool(root: string, ...args: string[]): Promise<string> {
    return this.run('git', args, root);
  }
}

/** What diff-tree compares a commit with: its first parent, or nothing for the first commit. */
function rangeOf({ sha, parents }: Pick<GitCommit, 'sha' | 'parents'>): string[] {
  return parents[0] ? [parents[0], sha] : ['--root', sha];
}

function withChat<T extends GitCommit>(commit: T, chats: Map<string, CommitChat>): T {
  const chat = chats.get(commit.sha);
  return chat ? { ...commit, chat } : commit;
}

/** Splits at the first `count` separators, keeping the rest whole. */
function splitAt(text: string, separator: string, count: number): [string, string | undefined] {
  let at = -1;
  for (let i = 0; i < count; i++) {
    at = text.indexOf(separator, at + 1);
    if (at < 0) return [text, undefined];
  }
  return [text.slice(0, at), text.slice(at + 1)];
}

function parseCommit(record: string): GitCommit | null {
  const [sha, short, parents, author, at, subject] = record.replace(/^\n/, '').split(FIELD);
  if (!sha || !short || at === undefined || subject === undefined) return null;
  return {
    sha,
    short,
    subject,
    author: author ?? '',
    at: Number(at) * 1000,
    parents: (parents ?? '').split(' ').filter(Boolean),
  };
}

/** `git log -z` with the fields above, read. */
export function parseLog(out: string): GitCommit[] {
  return out
    .split('\0')
    .map(parseCommit)
    .filter((commit): commit is GitCommit => commit !== null);
}

const KINDS: Record<string, GitCommitFile['kind']> = { A: 'new', D: 'deleted', R: 'renamed' };

/** `git diff-tree -z --name-status`, read; the line counts are left for `parseNumstat`. */
export function parseNameStatus(out: string): Omit<GitCommitFile, 'added' | 'removed'>[] {
  const fields = out.split('\0');
  const files: Omit<GitCommitFile, 'added' | 'removed'>[] = [];
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i]!.trim()[0];
    if (!code || !/^[A-Z]$/.test(code)) continue;
    // A rename or copy names the file it came from first.
    if (code === 'R' || code === 'C') {
      const from = fields[++i]!;
      const path = fields[++i]!;
      files.push(code === 'R' ? { path, kind: 'renamed', from } : { path, kind: 'new' });
    } else {
      files.push({ path: fields[++i]!, kind: KINDS[code] ?? 'modified' });
    }
  }
  return files;
}

/** `git diff-tree -z --numstat`, read: each file's inserted and removed lines, null when not text. */
export function parseNumstat(
  out: string,
): Map<string, { added: number | null; removed: number | null }> {
  const fields = out.split('\0');
  const counts = new Map<string, { added: number | null; removed: number | null }>();
  for (let i = 0; i < fields.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]!.replace(/^\n/, ''));
    if (!match) continue;
    // A rename leaves the name empty and gives where it was and where it is next.
    const path = match[3] ? match[3] : (i++, fields[++i]!);
    const count = (n: string) => (n === '-' ? null : Number(n));
    counts.set(path, { added: count(match[1]!), removed: count(match[2]!) });
  }
  return counts;
}
