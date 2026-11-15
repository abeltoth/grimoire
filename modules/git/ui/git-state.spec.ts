import type { GitStatus, PullRequest } from '@grimoire/contract';
import { branchLabel, badgesOf, statusDetail, whenOf } from './git-state';

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  root: '/repo',
  branch: 'main',
  head: 'abc1234',
  changes: [],
  ...over,
});

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 'Seven',
  url: '',
  state: 'open',
  review: null,
  checks: { passed: 0, failed: 0, pending: 0 },
  ...over,
});

describe('branchLabel', () => {
  it('names the branch, or the commit on a detached head', () => {
    expect(branchLabel(status())).toBe('main');
    expect(branchLabel(status({ branch: null }))).toBe('detached at abc1234');
    expect(branchLabel(status({ branch: null, head: null }))).toBe('no commits yet');
  });
});

describe('statusDetail', () => {
  it('counts what is not committed and how far the upstream is', () => {
    expect(statusDetail(status())).toBe('Nothing uncommitted');
    expect(
      statusDetail(
        status({
          changes: [{ path: 'a', kind: 'new', staged: false }],
          upstream: { name: 'origin/main', ahead: 0, behind: 3 },
        }),
      ),
    ).toBe('1 file not committed · 3 behind origin/main');
    expect(statusDetail(status({ upstream: { name: 'origin/main', ahead: 2, behind: 1 } }))).toBe(
      'Nothing uncommitted · 2 ahead, 1 behind origin/main',
    );
    expect(statusDetail(status({ upstream: { name: 'origin/main', ahead: 0, behind: 0 } }))).toBe(
      'Nothing uncommitted · even with origin/main',
    );
  });
});

describe('badgesOf', () => {
  it('badges the review, and the checks once there are any', () => {
    expect(badgesOf(pr()).map((badge) => badge.label)).toEqual(['PR #7: in review']);
    expect(
      badgesOf(pr({ review: 'approved', checks: { passed: 2, failed: 0, pending: 0 } })),
    ).toEqual([
      { id: 'git.pullRequest', label: 'PR #7: approved', detail: 'Seven' },
      { id: 'git.checks', label: 'CI: passing', tone: 'quiet', detail: '2 passed' },
    ]);
    expect(badgesOf(pr({ checks: { passed: 1, failed: 0, pending: 2 } }))[1]!.label).toBe(
      'CI: 2 checks running',
    );
  });

  it('badges changes requested and failing checks in rubric', () => {
    const badges = badgesOf(
      pr({ review: 'changes-requested', checks: { passed: 1, failed: 2, pending: 0 } }),
    );
    expect(badges.map(({ label, tone }) => [label, tone])).toEqual([
      ['PR #7: changes requested', 'alert'],
      ['CI: 2 checks failing', 'alert'],
    ]);
  });

  it('leaves the checks off a merged or closed pull request', () => {
    const checks = { passed: 1, failed: 1, pending: 0 };
    expect(badgesOf(pr({ state: 'merged', checks }))).toEqual([
      { id: 'git.pullRequest', label: 'PR #7: merged', tone: 'quiet', detail: 'Seven' },
    ]);
    expect(badgesOf(pr({ state: 'draft' }))[0]!.label).toBe('PR #7: draft');
  });
});

describe('whenOf', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();

  it('gives a time today, yesterday, a weekday this week, then a date', () => {
    expect(whenOf(new Date(2026, 10, 9, 9, 5).getTime(), now)).toMatch(/9.05/);
    expect(whenOf(new Date(2026, 10, 8, 23, 0).getTime(), now)).toBe('yesterday');
    expect(whenOf(new Date(2026, 10, 5).getTime(), now)).toBe(
      new Date(2026, 10, 5).toLocaleDateString([], { weekday: 'long' }),
    );
    expect(whenOf(new Date(2026, 9, 1).getTime(), now)).not.toMatch(/2026/);
    expect(whenOf(new Date(2025, 9, 1).getTime(), now)).toMatch(/2025/);
  });
});
