import type {
  GitBranches,
  GitStatus,
  PullRequest,
} from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('git', () => {
  it("shows the chapter's branch and review stamps, and its repository on the Git page", async () => {
    const { bridge, calls, answers } = fakeBridge();
    const now = Date.now();
    answers['git.status'] = (): GitStatus => ({
      root: 'C:/Users/me/git/grimoire',
      branch: 'feature/context-meter',
      head: 'abc1234',
      upstream: { name: 'origin/feature/context-meter', ahead: 2, behind: 0 },
      changes: [
        { path: 'ui/src/context-meter.component.ts', kind: 'modified', staged: false },
        { path: 'ui/src/context-meter.component.spec.ts', kind: 'new', staged: true },
      ],
    });
    answers['git.branches'] = (): GitBranches => ({
      trunk: 'master',
      branches: [
        { name: 'master', current: false, ahead: 0, behind: 0, subject: 'Merge the outline', at: now },
        { name: 'feature/context-meter', current: true, ahead: 3, behind: 1, subject: 'Draw the meter', at: now },
        {
          name: 'feature/storage-migrations',
          current: false,
          ahead: 1,
          behind: 4,
          subject: 'Add the migrations table',
          at: now,
          worktree: 'C:/Users/me/git/grimoire/.claude/worktrees/storage',
        },
      ],
    });
    answers['git.diff'] = () => [
      { kind: 'same', text: 'export class ContextMeter {' },
      { kind: 'removed', text: '  used = 0;' },
      { kind: 'inserted', text: '  used = input(0);' },
    ];
    answers['git.pullRequest'] = (): PullRequest => ({
      number: 12,
      title: 'Context meter',
      url: 'https://github.com/me/grimoire/pull/12',
      state: 'open',
      review: 'review-required',
      checks: { passed: 3, failed: 1, pending: 0 },
    });
    const { fixture, el, texts } = await render(bridge);

    expect(texts('gr-status-indicators button')).toEqual(['feature/context-meter']);
    const branch = el.querySelector<HTMLButtonElement>('gr-status-indicators button')!;
    expect(branch.getAttribute('title')).toBe(
      '2 files not committed · 2 ahead of origin/feature/context-meter',
    );
    expect(texts('gr-review-stamps button')).toEqual(['PR #12: in review', 'CI: 1 check failing']);
    expect(el.querySelector('gr-review-stamps .alert')!.textContent!.trim()).toBe('CI: 1 check failing');
    expect(calls.find((c) => c.command === 'git.status')!.request).toEqual({ cwd: 'C:/Users/me' });

    branch.click();
    await fixture.whenStable();
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Git']);
    expect(texts('gr-git-page h2')).toEqual(['~/git/grimoire']);
    expect(texts('gr-git-page .sub')).toEqual([
      'On feature/context-meter at abc1234· 2 ahead of origin/feature/context-meter',
      'Pull request #12: Context meter',
    ]);
    expect(texts('gr-git-page .change')).toEqual([
      'ui/src/context-meter.component.ts modified',
      'ui/src/context-meter.component.spec.ts new · staged',
    ]);
    expect(texts('gr-git-page .branch-row .name')).toEqual([
      'master',
      'feature/context-meter',
      'feature/storage-migrations',
    ]);
    expect(texts('gr-git-page .branch-row .distance')).toEqual([
      'the trunk',
      '3 ahead, 1 behind',
      '1 ahead, 4 behind',
    ]);
    expect(texts('gr-git-page .current .here')).toEqual(['checked out']);
    expect(texts('gr-git-page .grown .branch-row .name')).toHaveLength(2);
    expect(texts('gr-git-page .last')[2]).toContain(
      'in the worktree at ~/git/grimoire/.claude/worktrees/storage',
    );

    el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'git.diff').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', path: 'ui/src/context-meter.component.ts' },
    ]);
    expect(texts('gr-git-page gr-corrections .code')).toEqual([
      'export class ContextMeter {',
      'used = 0;',
      'used = input(0);',
    ]);
    expect(texts('gr-git-page gr-corrections .head .detail')[0]).toBe('corrections, not committed yet');

    // Folded back in.
    el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-page gr-corrections')).toBeNull();
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
