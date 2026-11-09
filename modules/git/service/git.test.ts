import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Git, parseDiff, parseStatus, toPullRequest } from './git';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
const write = (file: string, text: string) => writeFileSync(path.join(repo, file), text);
const commit = (message: string) => git('commit', '--quiet', '-am', message);

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-git-')));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  write('a.txt', 'one\ntwo\nthree\n');
  write('b.txt', 'bee\n');
  git('add', '.');
  commit('First');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const same = (a: string | null | undefined, b: string) =>
  path.resolve(a ?? '').toLowerCase() === path.resolve(b).toLowerCase();

describe('Git', () => {
  it('gives null outside a repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'grimoire-nogit-'));
    try {
      expect(await new Git().status(outside)).toBeNull();
      expect(await new Git().branches(outside)).toBeNull();
      expect(await new Git().diff(outside, 'a.txt')).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reads the branch and the uncommitted changes', async () => {
    write('a.txt', 'one\n2\nthree\n');
    unlinkSync(path.join(repo, 'b.txt'));
    write('c.txt', 'sea\n');
    write('d.txt', 'dee\n');
    git('add', 'd.txt');
    mkdirSync(path.join(repo, 'new'));
    write('new/e.txt', 'ee\n');
    const status = await new Git().status(repo);
    expect(same(status?.root, repo)).toBe(true);
    expect(status?.branch).toBe('main');
    expect(status?.head).toMatch(/^[0-9a-f]{7}$/);
    expect(status?.upstream).toBeUndefined();
    expect(status?.changes).toEqual(
      expect.arrayContaining([
        { path: 'a.txt', kind: 'modified', staged: false },
        { path: 'b.txt', kind: 'deleted', staged: false },
        { path: 'c.txt', kind: 'new', staged: false },
        { path: 'd.txt', kind: 'new', staged: true },
        // A new folder's files, not the folder.
        { path: 'new/e.txt', kind: 'new', staged: false },
      ]),
    );
    expect(status?.changes).toHaveLength(5);
  });

  it('reads a folder inside the repository as the repository', async () => {
    const status = await new Git().status(path.join(repo, '.git', '..'));
    expect(status?.branch).toBe('main');
  });

  it('gives a change as a diff, and a new file as all inserted', async () => {
    write('a.txt', 'one\n2\nthree\n');
    write('c.txt', 'sea\nsee\n');
    expect(await new Git().diff(repo, 'a.txt')).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'removed', text: 'two' },
      { kind: 'inserted', text: '2' },
      { kind: 'same', text: 'three' },
    ]);
    expect(await new Git().diff(repo, 'c.txt')).toEqual([
      { kind: 'inserted', text: 'sea' },
      { kind: 'inserted', text: 'see' },
    ]);
  });

  it("won't read a file outside the repository", async () => {
    expect(await new Git().diff(repo, '../outside.txt')).toEqual([]);
    expect(await new Git().committed(repo, '../outside.txt')).toBeUndefined();
  });

  it('gives a changed file as last committed, null for a new one, and nothing for one unchanged', async () => {
    mkdirSync(path.join(repo, 'sub'));
    write('sub/d.txt', 'dee\n');
    git('add', 'sub/d.txt');
    commit('Sub');
    write('sub/d.txt', 'deer\n');
    write('a.txt', 'one\n2\nthree\n');
    write('c.txt', 'sea\n');
    expect(await new Git().committed(repo, 'a.txt')).toBe('one\ntwo\nthree\n');
    expect(await new Git().committed(repo, 'sub/d.txt')).toBe('dee\n');
    expect(await new Git().committed(repo, 'c.txt')).toBeNull();
    expect(await new Git().committed(repo, 'b.txt')).toBeUndefined();
  });

  it('lists the branches against the trunk, the trunk first', async () => {
    git('switch', '--quiet', '-c', 'feature');
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    commit('Four');
    write('a.txt', 'one\ntwo\nthree\nfour\nfive\n');
    commit('Five');
    git('switch', '--quiet', 'main');
    write('b.txt', 'bee\nbe\n');
    commit('Be');
    const { trunk, branches } = (await new Git().branches(repo))!;
    expect(trunk).toBe('main');
    expect(branches.map(({ name, current, ahead, behind, subject }) => ({ name, current, ahead, behind, subject }))).toEqual([
      { name: 'main', current: true, ahead: 0, behind: 0, subject: 'Be' },
      { name: 'feature', current: false, ahead: 2, behind: 1, subject: 'Five' },
    ]);
    expect(branches[0]!.worktree).toBeUndefined();
  });

  it('marks a branch checked out in another worktree', async () => {
    const elsewhere = path.join(repo, '..', `${path.basename(repo)}-tree`);
    git('worktree', 'add', '--quiet', '-b', 'side', elsewhere);
    try {
      const { branches } = (await new Git().branches(repo))!;
      const side = branches.find((branch) => branch.name === 'side');
      expect(same(side?.worktree, elsewhere)).toBe(true);
      expect(branches.find((branch) => branch.name === 'main')?.worktree).toBeUndefined();
      // Read from the worktree, its own branch is the one checked out.
      expect((await new Git().status(elsewhere))?.branch).toBe('side');
    } finally {
      git('worktree', 'remove', '--force', elsewhere);
    }
  });

  it('keeps a pull request for half a minute', async () => {
    let asked = 0;
    const git = new Git(async () => {
      asked++;
      throw new Error('no pull requests found');
    });
    expect(await git.pullRequest(repo)).toBeNull();
    expect(await git.pullRequest(repo)).toBeNull();
    expect(asked).toBe(1);
  });
});

describe('parseStatus', () => {
  it('reads renames, conflicts, a detached head and the upstream', () => {
    const out = [
      '# branch.oid 1234567890abcdef',
      '# branch.head (detached)',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc both.txt',
      '',
    ].join('\0');
    expect(parseStatus('/repo', out)).toEqual({
      root: '/repo',
      branch: null,
      head: '1234567',
      upstream: { name: 'origin/main', ahead: 2, behind: 3 },
      changes: [
        { path: 'new name.txt', kind: 'renamed', from: 'old name.txt', staged: true },
        { path: 'both.txt', kind: 'conflicted', staged: false },
      ],
    });
  });

  it('reads a repository before its first commit', () => {
    expect(parseStatus('/repo', '# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      branch: 'main',
      head: null,
    });
  });
});

describe('parseDiff', () => {
  it('marks the lines left out between hunks', () => {
    const out = [
      'diff --git a/x b/x',
      'index 1..2 100644',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -10,2 +10,2 @@',
      ' j',
      '+k',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(parseDiff(out)).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'inserted', text: 'B' },
      { kind: 'same', text: '⋯' },
      { kind: 'same', text: 'j' },
      { kind: 'inserted', text: 'k' },
    ]);
  });
});

describe('toPullRequest', () => {
  it('counts the checks and reads the review', () => {
    expect(
      toPullRequest({
        number: 12,
        title: 'Git page',
        url: 'https://github.com/o/r/pull/12',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
          { __typename: 'StatusContext', state: 'ERROR' },
          { __typename: 'StatusContext', state: 'PENDING' },
        ],
      }),
    ).toEqual({
      number: 12,
      title: 'Git page',
      url: 'https://github.com/o/r/pull/12',
      state: 'open',
      review: 'review-required',
      checks: { passed: 2, failed: 2, pending: 2 },
    });
  });

  it('reads drafts and merged pull requests', () => {
    const pr = { number: 1, title: '', url: '', reviewDecision: '', isDraft: true };
    expect(toPullRequest({ ...pr, state: 'OPEN' })).toMatchObject({ state: 'draft', review: null });
    expect(toPullRequest({ ...pr, state: 'MERGED' }).state).toBe('merged');
  });
});
