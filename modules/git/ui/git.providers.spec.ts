import type { GitStatus, PullRequest } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const status: GitStatus = {
  root: 'C:/Users/me/git/grimoire',
  branch: 'feature/context-meter',
  head: 'abc1234',
  upstream: { name: 'origin/feature/context-meter', ahead: 2, behind: 0 },
  changes: [
    { path: 'ui/src/context-meter.component.ts', kind: 'modified', staged: false },
    { path: 'ui/src/context-meter.component.spec.ts', kind: 'new', staged: true },
  ],
};

describe('git.providers', () => {
  it("shows the chat's branch in the footer and its pull request's badges in the header, each turning to Git", async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.branches'] = () => ({ trunk: 'master', branches: [] });
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
    expect(texts('gr-header-badges button')).toEqual(['PR #12: in review', 'CI: 1 check failing']);
    expect(el.querySelector('gr-header-badges .alert')!.textContent!.trim()).toBe(
      'CI: 1 check failing',
    );
    expect(calls.find((c) => c.command === 'git.status')!.request).toEqual({ cwd: 'C:/Users/me' });

    el.querySelector<HTMLButtonElement>('gr-header-badges button')!.click();
    await fixture.whenStable();
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Git']);
  });

  it('shows no branch outside a repository, and no badges without a pull request', async () => {
    const { bridge, answers } = fakeBridge();
    answers['git.status'] = () => null;
    const { el } = await render(bridge);
    expect(el.querySelector('gr-status-indicators button')).toBeNull();
    expect(el.querySelector('gr-header-badges button')).toBeNull();
  });
});
