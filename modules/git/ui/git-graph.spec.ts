import type { GitCommit, GitLog, GitStatus } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { labelsOf } from './git-graph';

const now = new Date(2026, 10, 9, 15, 30).getTime();

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  root: 'C:/Users/me/git/grimoire',
  branch: 'main',
  head: 'm000000',
  changes: [],
  ...over,
});

const commit = (sha: string, parents: string[], extra: Partial<GitCommit> = {}): GitCommit => ({
  sha,
  short: sha.slice(0, 7),
  subject: `Commit ${sha}`,
  author: 'Me',
  at: now,
  parents,
  ...extra,
});

/** main merges feature: m has b and f as parents, and both grew from a. */
const commits = [
  commit('m000000', ['b000000', 'f000000'], {
    refs: [
      { name: 'main', kind: 'branch', current: true, upstream: 'origin/main' },
      { name: 'origin/main', kind: 'remote' },
    ],
    chat: { id: 'c1', agent: 'claude-code', title: 'Fix it', cwd: 'C:/w' },
  }),
  commit('f000000', ['a000000'], {
    refs: [
      { name: 'feature', kind: 'branch' },
      { name: 'origin/feature', kind: 'remote' },
      { name: 'v2', kind: 'tag' },
    ],
  }),
  commit('b000000', ['a000000']),
  commit('a000000', [], { refs: [{ name: 'v1', kind: 'tag' }] }),
];

async function openGit(answer: (request: { skip: number; limit: number }) => GitLog, over = {}) {
  const fake = fakeBridge();
  let current = status(over);
  fake.answers['git.status'] = () => current;
  fake.answers['git.log'] = answer;
  const page = await render(fake.bridge);
  [...page.el.querySelectorAll<HTMLButtonElement>('.tabs button')]
    .find((tab) => tab.textContent!.trim() === 'Git')!
    .click();
  await page.fixture.whenStable();
  const moveTo = (next: Partial<GitStatus>) => (current = status(next));
  return { ...fake, ...page, moveTo };
}

describe('GitGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it('draws every branch in its lane, with its labels, author, date and sha', async () => {
    const { el, texts, calls } = await openGit(() => ({ commits, more: false, head: 'm000000' }));
    expect(calls.find((c) => c.command === 'git.log')?.request).toEqual({
      cwd: 'C:/Users/me',
      skip: 0,
      limit: 200,
    });
    expect(texts('gr-git-graph .row .open')).toEqual([
      'Commit m000000',
      'Commit f000000',
      'Commit b000000',
      'Commit a000000',
    ]);
    expect(texts('gr-git-graph .row:first-child .ref')).toEqual(['main']);
    expect(el.querySelector('gr-git-graph .ref.current.synced')?.getAttribute('title')).toBe(
      'Branch main, checked out, even with origin/main',
    );
    expect(texts('gr-git-graph .ref.tag')).toEqual(['v1']);
    // Past the first, a commit's labels fold into one that names them on hover.
    expect(texts('gr-git-graph .row:nth-child(2) .ref')).toEqual(['feature', '+2']);
    expect(el.querySelector('gr-git-graph .ref.more')?.getAttribute('title')).toBe(
      'Remote branch origin/feature\nTag v2',
    );
    expect(texts('gr-git-graph .chat')).toEqual(['Fix it']);
    expect(texts('gr-git-graph .sha')).toEqual(['m000000', 'f000000', 'b000000', 'a000000']);
    // The merge's dot is in lane 0, the feature's in lane 1.
    const dots = [...el.querySelectorAll('gr-git-lanes circle')].map((c) => c.getAttribute('cx'));
    expect(dots).toEqual(['0.5', '1.5', '0.5', '0.5']);
  });

  it('puts the changes not committed yet on top, joined to the commit checked out', async () => {
    const { el, texts } = await openGit(() => ({ commits, more: false, head: 'b000000' }), {
      changes: [
        { path: 'a.ts', kind: 'modified', staged: false },
        { path: 'b.ts', kind: 'new', staged: false },
      ],
    });
    expect(texts('gr-git-graph .changes .open')).toEqual(['Not committed yet · 2 files']);
    expect(el.querySelector('gr-git-graph .changes circle.hollow')).not.toBeNull();
  });

  it('reads older commits as asked, and reads it again when the repository moves', async () => {
    const { el, texts, calls, fixture, moveTo } = await openGit(({ skip }) =>
      skip
        ? { commits: commits.slice(2), more: false, head: 'm000000' }
        : { commits: commits.slice(0, 2), more: true, head: 'm000000' },
    );
    expect(texts('gr-git-graph .row .open')).toHaveLength(2);
    el.querySelector<HTMLButtonElement>('gr-git-graph .older')!.click();
    await fixture.whenStable();
    expect(texts('gr-git-graph .row .open')).toHaveLength(4);
    expect(el.querySelector('gr-git-graph .older')).toBeNull();

    moveTo({ head: 'n000000' });
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'git.log').at(-1)?.request).toEqual({
      cwd: 'C:/Users/me',
      skip: 0,
      limit: 200,
    });
  });

  it("opens a commit's chat", async () => {
    const { el, calls, fixture } = await openGit(() => ({ commits, more: false, head: null }));
    el.querySelector<HTMLButtonElement>('gr-git-graph .chat')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')?.request).toEqual({
      agent: 'claude-code',
      chatId: 'c1',
      settings: { cwd: 'C:/w' },
    });
  });

  it('says so when there are no commits yet', async () => {
    const { texts } = await openGit(() => ({ commits: [], more: false, head: null }));
    expect(texts('gr-git-graph .none')).toEqual(['No commits yet.']);
  });
});

describe('labelsOf', () => {
  it('folds an upstream at the same commit into its branch, and names each kind', () => {
    expect(
      labelsOf([
        { name: 'HEAD', kind: 'head', current: true },
        { name: 'main', kind: 'branch', upstream: 'origin/main', worktree: 'C:/w' },
        { name: 'origin/main', kind: 'remote' },
        { name: 'origin/dev', kind: 'remote' },
        { name: 'v1', kind: 'tag' },
      ]).map((label) => [label.name, label.synced, label.title]),
    ).toEqual([
      ['HEAD', false, 'Detached HEAD'],
      ['main', true, 'Branch main, even with origin/main, in the worktree at C:/w'],
      ['origin/dev', false, 'Remote branch origin/dev'],
      ['v1', false, 'Tag v1'],
    ]);
  });
});
