import type { AgentId, ChatId } from '@grimoire/contract';

/** One line of a file's diff. */
export interface DiffLine {
  kind: 'same' | 'removed' | 'inserted';
  text: string;
}

/** A file changed and not committed yet. */
export interface GitChange {
  /** From the repository's top folder, with forward slashes. */
  path: string;
  kind: 'modified' | 'new' | 'deleted' | 'renamed' | 'conflicted';
  /** Where a renamed file was. */
  from?: string;
  /** Staged for the next commit. */
  staged: boolean;
}

/** A folder's repository as git reports it now. */
export interface GitStatus {
  /** The top folder of the repository, or of the worktree the folder is in. */
  root: string;
  /** The branch checked out; null when no branch is, as on a detached HEAD. */
  branch: string | null;
  /** The commit checked out, abbreviated; null before the first commit. */
  head: string | null;
  /** The branch's upstream, and how many commits it is ahead of it and behind it. */
  upstream?: { name: string; ahead: number; behind: number };
  changes: GitChange[];
}

/** A local branch. */
export interface GitBranch {
  name: string;
  current: boolean;
  /** Commits on it and not on the trunk, and on the trunk and not on it. */
  ahead: number;
  behind: number;
  /** Its latest commit's subject, and when it was made, in ms since the epoch. */
  subject: string;
  at: number;
  /** The folder of the other worktree it's checked out in. */
  worktree?: string;
}

/** The repository's branches: the trunk, and the branches grown from it. */
export interface GitBranches {
  /** The main line: the remote's default branch, or main or master. */
  trunk: string | null;
  branches: GitBranch[];
}

/** A branch's pull request on GitHub, and how its checks went. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  /** The reviewers' verdict; null when none is needed or given. */
  review: 'approved' | 'changes-requested' | 'review-required' | null;
  checks: { passed: number; failed: number; pending: number };
}

/** The chat whose turn made a commit, enough to open it again. */
export interface CommitChat {
  id: ChatId;
  agent: AgentId;
  title: string;
  cwd: string;
}

/** A name pointing at a commit, as the graph labels it. */
export interface GitRef {
  /** Short, such as `main`, `origin/main` or `v1.2`; for a detached HEAD, `HEAD`. */
  name: string;
  kind: 'branch' | 'remote' | 'tag' | 'head';
  /** The branch checked out. */
  current?: true;
  /** A local branch's upstream, such as `origin/main`. */
  upstream?: string;
  /** The folder of the other worktree a branch is checked out in. */
  worktree?: string;
}

/** A commit in the repository's history. */
export interface GitCommit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  /** When it was made, in ms since the epoch. */
  at: number;
  parents: string[];
  /** The branches, remotes and tags pointing at it. */
  refs?: GitRef[];
  /** The chat that made it, when a chat's turn did. */
  chat?: CommitChat;
}

/** A file a commit changed, against its first parent. */
export interface GitCommitFile {
  path: string;
  kind: 'modified' | 'new' | 'deleted' | 'renamed';
  /** Where a renamed file was. */
  from?: string;
  /** Lines inserted and removed; null for a file that isn't text. */
  added: number | null;
  removed: number | null;
}

/** A commit with its whole message and the files it changed. */
export interface GitCommitDetail extends GitCommit {
  /** The message after the subject. */
  body: string;
  files: GitCommitFile[];
}

/** A page of the history, newest first, each branch's commits kept together. */
export interface GitLog {
  commits: GitCommit[];
  /** Older commits come after these. */
  more: boolean;
  /** The commit checked out, in full; null before the first commit. */
  head: string | null;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** The folder's repository now; null when the folder isn't in one. */
    'git.status': { request: { cwd: string }; response: GitStatus | null };
    /** The repository's branches; null when the folder isn't in one. */
    'git.branches': { request: { cwd: string }; response: GitBranches | null };
    /** A file's uncommitted change, as a diff. The path is from the repository's top folder. */
    'git.diff': { request: { cwd: string; path: string }; response: DiffLine[] };
    /**
     * A page of the history of every branch, remote and tag, in graph order,
     * skipping the first `skip`; null outside a repository.
     */
    'git.log': {
      request: { cwd: string; skip: number; limit: number };
      response: GitLog | null;
    };
    /** A commit's message and changed files; null when the repository hasn't got it. */
    'git.commit': { request: { cwd: string; sha: string }; response: GitCommitDetail | null };
    /** A file's change in a commit, against its first parent; `from` is where a renamed file was. Paths are from the repository's top folder. */
    'git.commitDiff': {
      request: { cwd: string; sha: string; path: string; from?: string };
      response: DiffLine[];
    };
    /** The pull request for the folder's branch; null when it has none or GitHub can't be asked. */
    'git.pullRequest': { request: { cwd: string }; response: PullRequest | null };
    /** The top folder of the folder's repository; null when the folder isn't in one. */
    'git.root': { request: { cwd: string }; response: string | null };
    /** The repository's files that git doesn't ignore, committed or not, from its top folder. */
    'git.files': { request: { root: string }; response: string[] };
    /** Which of the paths, from the repository's top folder, git ignores. */
    'git.ignored': { request: { root: string; paths: string[] }; response: string[] };
    /**
     * A file as last committed, when it has changed since: null for a file
     * that's new. Undefined when it hasn't changed, or outside a repository.
     * The path is from the repository's top folder.
     */
    'git.committed': {
      request: { cwd: string; path: string };
      response: string | null | undefined;
    };
  }
}
