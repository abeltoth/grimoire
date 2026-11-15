import path from 'node:path';
import type {
  CommitChat,
  DiffLine,
  GitCommit,
  GitCommitDetail,
  GitCommitFile,
  GitLog,
  GitRef,
} from '@grimoire/contract';
import { type Git, type Run, inside, parseDiff, runTool } from './git';

/** Separates a commit's fields; a record ends at a NUL. */
const FIELD = '\x1f';
const FORMAT = ['%H', '%h', '%P', '%an', '%at', '%s'].join('%x1f');
/** What `for-each-ref` gives of each ref; a tag's own object comes before the commit it names. */
const REF_FIELDS = [
  '%(objectname)',
  '%(*objectname)',
  '%(refname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(worktreepath)',
];

/** Which of the commits a chat made, by sha. */
export type ChatsOf = (shas: string[]) => Map<string, CommitChat>;

/** A repository's history: its commits and labels, what each changed, and the chat that made it. */
export class History {
  constructor(
    private readonly git: Git,
    private readonly chatsOf: ChatsOf = () => new Map(),
    private readonly run: Run = runTool,
  ) {}

  /** A page of every branch's, remote's and tag's history, in graph order, with their labels. */
  async log(cwd: string, skip: number, limit: number): Promise<GitLog | null> {
    const root = await this.git.root(cwd);
    if (!root) return null;
    const count = Math.max(1, Math.floor(limit));
    const head = await this.resolve(root, 'HEAD');
    const [out, refs] = await Promise.all([
      this.tool(
        root,
        'log',
        '-z',
        `--format=${FORMAT}`,
        '--topo-order',
        `--skip=${Math.max(0, Math.floor(skip))}`,
        `--max-count=${count + 1}`,
        '--branches',
        '--remotes',
        '--tags',
        'HEAD',
        '--',
      ).catch(() => ''),
      this.refs(root, head),
    ]);
    const all = parseLog(out);
    const commits = all.slice(0, count);
    const chats = this.chatsOf(commits.map((commit) => commit.sha));
    return {
      commits: commits.map((commit) => {
        const labels = refs.get(commit.sha);
        return withChat(labels ? { ...commit, refs: labels } : commit, chats);
      }),
      more: all.length > count,
      head,
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

  /** The branches, remotes and tags by the commit they point at, and HEAD when it's detached. */
  private async refs(root: string, head: string | null): Promise<Map<string, GitRef[]>> {
    const [out, detached] = await Promise.all([
      this.tool(
        root,
        'for-each-ref',
        `--format=${REF_FIELDS.join('%00')}`,
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ).catch(() => ''),
      this.tool(root, 'rev-parse', '--symbolic-full-name', 'HEAD')
        .then((name) => name.trim() === 'HEAD')
        .catch(() => false),
    ]);
    return parseRefs(out, root, detached ? head : null);
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

const ORDER: Record<GitRef['kind'], number> = { head: 0, branch: 1, remote: 2, tag: 3 };

/**
 * `git for-each-ref` with the fields above, read: each commit's labels, the
 * branch checked out first. `head` is HEAD's commit when it's detached.
 */
export function parseRefs(out: string, root: string, head: string | null): Map<string, GitRef[]> {
  const here = path.resolve(root).toLowerCase();
  const refs = new Map<string, GitRef[]>();
  const add = (sha: string, ref: GitRef) => refs.set(sha, [...(refs.get(sha) ?? []), ref]);
  if (head) add(head, { name: 'HEAD', kind: 'head', current: true });
  for (const line of out.split('\n')) {
    const [object = '', peeled = '', full = '', star, upstream, worktree] = line.split('\0');
    const sha = peeled || object;
    if (!sha) continue;
    if (full.startsWith('refs/heads/')) {
      const elsewhere = worktree && path.resolve(worktree).toLowerCase() !== here;
      add(sha, {
        name: full.slice('refs/heads/'.length),
        kind: 'branch',
        ...(star === '*' ? { current: true as const } : {}),
        ...(upstream ? { upstream } : {}),
        ...(elsewhere ? { worktree } : {}),
      });
    } else if (full.startsWith('refs/remotes/') && !full.endsWith('/HEAD')) {
      add(sha, { name: full.slice('refs/remotes/'.length), kind: 'remote' });
    } else if (full.startsWith('refs/tags/')) {
      add(sha, { name: full.slice('refs/tags/'.length), kind: 'tag' });
    }
  }
  for (const list of refs.values()) {
    list.sort((a, b) => Number(!!b.current) - Number(!!a.current) || ORDER[a.kind] - ORDER[b.kind]);
  }
  return refs;
}
