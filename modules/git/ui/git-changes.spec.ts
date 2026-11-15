import type { GitLog, GitStatus } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const status: GitStatus = {
  root: 'C:/Users/me/git/grimoire',
  branch: 'main',
  head: 'abc1234',
  changes: [
    { path: 'ui/src/context-meter.component.ts', kind: 'modified', staged: false },
    { path: 'ui/src/context-meter.component.spec.ts', kind: 'new', staged: true },
    { path: 'merge.txt', kind: 'conflicted', staged: false },
  ],
};

const log: GitLog = { commits: [], more: false, head: null };

describe('GitChanges', () => {
  it('lists what is not committed yet, each change opening as its diff', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['git.status'] = () => status;
    answers['git.log'] = () => log;
    answers['git.diff'] = () => [
      { kind: 'same', text: 'export class ContextMeter {' },
      { kind: 'removed', text: '  used = 0;' },
      { kind: 'inserted', text: '  used = input(0);' },
    ];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-git-graph .changes .open')!.click();
    await fixture.whenStable();

    expect(texts('gr-git-changes .change')).toEqual([
      'ui/src/context-meter.component.ts modified',
      'ui/src/context-meter.component.spec.ts new · staged',
      'merge.txt conflicted',
    ]);
    expect(texts('gr-git-changes .kind.alert')).toEqual(['conflicted']);

    el.querySelector<HTMLButtonElement>('gr-git-changes .change')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'git.diff').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', path: 'ui/src/context-meter.component.ts' },
    ]);
    expect(texts('gr-git-changes gr-diff-view .code')).toEqual([
      'export class ContextMeter {',
      'used = 0;',
      'used = input(0);',
    ]);
    expect(texts('gr-git-changes gr-diff-view .head .detail')).toEqual(['+1 −1']);

    // Collapsed again.
    el.querySelector<HTMLButtonElement>('gr-git-changes .change')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-git-changes gr-diff-view')).toBeNull();
  });
});
