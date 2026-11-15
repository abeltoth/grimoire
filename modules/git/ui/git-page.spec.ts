import type { GitCommitDetail, GitLog, GitStatus, PullRequest } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const now = new Date(2026, 10, 9, 15, 30).getTime();

const status: GitStatus = {
  root: 'C:/Users/me/git/grimoire',
  branch: 'feature/context-meter',
  head: 'abc1234',
  upstream: { name: 'origin/feature/context-meter', ahead: 2, behind: 0 },
  changes: [{ path: 'ui/src/context-meter.ts', kind: 'modified', staged: false }],
};

const log: GitLog = {
  commits: [
    {
      sha: 'abc1234000',
      short: 'abc1234',
      subject: 'Draw the meter',
      author: 'Me',
      at: now,
      parents: [],
      refs: [{ name: 'feature/context-meter', kind: 'branch', current: true }],
    },
  ],
  more: false,
  head: 'abc1234000',
};

const detail: GitCommitDetail = { ...log.commits[0]!, body: '', files: [] };

describe('git', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the chat's repository and its graph on the Git page, opened from its branch", async () => {
    const { bridge, answers } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.log'] = () => log;
    answers['git.pullRequest'] = (): PullRequest => ({
      number: 12,
      title: 'Context meter',
      url: 'https://github.com/me/grimoire/pull/12',
      state: 'open',
      review: 'review-required',
      checks: { passed: 3, failed: 1, pending: 0 },
    });
    const { fixture, el, texts } = await render(bridge);

    el.querySelector<HTMLButtonElement>('gr-status-indicators button')!.click();
    await fixture.whenStable();
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Git']);
    expect(texts('gr-git-page h2')).toEqual(['~/git/grimoire']);
    expect(texts('gr-git-page .sub')).toEqual([
      'On feature/context-meter at abc1234· 2 ahead of origin/feature/context-meter',
      'Pull request #12: Context meter',
    ]);
    expect(texts('gr-git-graph .row .open')).toEqual([
      'Not committed yet · 1 file',
      'Draw the meter',
    ]);
  });

  it('opens the changes and a commit in place of the graph, and comes back to it', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.log'] = () => log;
    answers['git.commit'] = () => detail;
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();
    const overview = () => el.querySelector<HTMLElement>('gr-git-page .overview')!;

    el.querySelectorAll<HTMLButtonElement>('gr-git-graph .open')[0]!.click();
    await fixture.whenStable();
    expect(overview().hidden).toBe(true);
    expect(texts('gr-git-changes .change')).toEqual(['ui/src/context-meter.ts modified']);
    el.querySelector<HTMLButtonElement>('gr-git-changes .back')!.click();
    await fixture.whenStable();
    expect(overview().hidden).toBe(false);

    el.querySelectorAll<HTMLButtonElement>('gr-git-graph .open')[1]!.click();
    await fixture.whenStable();
    expect(texts('gr-git-commit h2')).toEqual(['Draw the meter']);
    el.querySelector<HTMLButtonElement>('gr-git-commit .back')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-commit')).toBeNull();
    // The graph was kept, not read again.
    expect(calls.filter((c) => c.command === 'git.log')).toHaveLength(1);
  });

  it('says so on the Git page when the folder is not in a repository', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-git-page .none')).toEqual(['~ isn’t in a git repository.']);
  });
});
