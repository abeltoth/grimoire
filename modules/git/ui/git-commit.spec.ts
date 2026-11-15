import type { GitCommitDetail, GitLog, GitStatus } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const now = new Date(2026, 10, 9, 15, 30).getTime();

const status: GitStatus = {
  root: 'C:/Users/me/git/grimoire',
  branch: 'main',
  head: 'aaa1111',
  changes: [],
};

const log: GitLog = {
  commits: [{ sha: 'sha1', short: 's1', subject: 'Move it', author: 'Me', at: now, parents: [] }],
  more: false,
  head: 'sha1',
};

const detail = (sha: string): GitCommitDetail => ({
  sha,
  short: sha.slice(0, 2),
  subject: sha === 'sha1' ? 'Move it' : 'Before',
  body: 'Because.\n\nReally.',
  author: 'Me',
  at: now,
  parents: sha === 'sha1' ? ['sha0000000'] : [],
  chat: { id: 'c1', agent: 'claude-code', title: 'Fix it', cwd: 'C:/w' },
  files: [
    { path: 'src/moved.ts', kind: 'renamed', from: 'src/old.ts', added: 1, removed: 1 },
    { path: 'pic.png', kind: 'new', added: null, removed: null },
  ],
});

describe('GitCommitPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it('opens a commit from the history, its files expanding as diffs, and goes back', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.log'] = () => log;
    answers['git.commit'] = ({ sha }: { sha: string }) => detail(sha);
    answers['git.commitDiff'] = () => [
      { kind: 'removed', text: 'old' },
      { kind: 'inserted', text: 'new' },
    ];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-git-graph .open')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-page #git-changes')).toBeNull();
    expect(texts('gr-git-commit h2')).toEqual(['Move it']);
    expect(el.querySelector('gr-git-commit .body')!.textContent).toBe('Because.\n\nReally.');
    expect(texts('gr-git-commit .chat')).toEqual(['Fix it']);
    expect(texts('gr-git-commit .file')).toEqual([
      'src/moved.ts renamed from src/old.ts · +1 −1',
      'pic.png new · not text',
    ]);

    el.querySelector<HTMLButtonElement>('gr-git-commit .file')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'git.commitDiff')?.request).toEqual({
      cwd: 'C:/Users/me',
      sha: 'sha1',
      path: 'src/moved.ts',
      from: 'src/old.ts',
    });
    expect(texts('gr-git-commit gr-diff-view .code')).toEqual(['old', 'new']);

    el.querySelector<HTMLButtonElement>('gr-git-commit .parent')!.click();
    await fixture.whenStable();
    expect(texts('gr-git-commit h2')).toEqual(['Before']);
    expect(el.querySelector('gr-git-commit gr-diff-view')).toBeNull();

    el.querySelector<HTMLButtonElement>('gr-git-commit .back')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-commit')).toBeNull();
    expect(el.querySelector<HTMLElement>('gr-git-page .overview')!.hidden).toBe(false);
  });

  it("says so when the repository hasn't got the commit", async () => {
    const { bridge, answers } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.log'] = () => log;
    answers['git.commit'] = () => null;
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-git-graph .open')!.click();
    await fixture.whenStable();
    expect(texts('gr-git-commit .none')).toEqual(['The repository hasn’t got this commit.']);
  });
});
