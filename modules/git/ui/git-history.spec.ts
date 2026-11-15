import type { GitBranches, GitCommit, GitLog, GitStatus } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const now = new Date(2026, 10, 9, 15, 30).getTime();

const status: GitStatus = {
  root: 'C:/Users/me/git/grimoire',
  branch: 'feature',
  head: 'ccc3333',
  changes: [],
};

const branches: GitBranches = {
  trunk: 'main',
  branches: [
    { name: 'main', current: false, ahead: 0, behind: 0, subject: 'Root', at: now },
    { name: 'feature', current: true, ahead: 2, behind: 0, subject: 'Third', at: now },
  ],
};

const commitOf = (n: number, extra: Partial<GitCommit> = {}): GitCommit => ({
  sha: `sha${n}`,
  short: `s${n}`,
  subject: `Commit ${n}`,
  author: 'Me',
  at: now,
  parents: [],
  ...extra,
});

async function openGit() {
  const fake = fakeBridge();
  fake.answers['git.status'] = () => status;
  fake.answers['git.branches'] = () => branches;
  const page = await render(fake.bridge);
  [...page.el.querySelectorAll<HTMLButtonElement>('.tabs button')]
    .find((tab) => tab.textContent!.trim() === 'Git')!
    .click();
  await page.fixture.whenStable();
  return { ...fake, ...page };
}

describe('GitHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the checked-out branch's history, a page at a time, its own commits marked", async () => {
    const fake = fakeBridge();
    fake.answers['git.status'] = () => status;
    fake.answers['git.branches'] = () => branches;
    fake.answers['git.log'] = ({ skip }: { skip: number }): GitLog =>
      skip
        ? { commits: [commitOf(3)], more: false }
        : {
            commits: [
              commitOf(1, {
                own: true,
                chat: { id: 'c1', agent: 'claude-code', title: 'Fix it', cwd: 'C:/w' },
              }),
              commitOf(2),
            ],
            more: true,
          };
    const { fixture, el, texts } = await render(fake.bridge);
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
      .find((tab) => tab.textContent!.trim() === 'Git')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-git-page #git-history')).toEqual(['History of feature']);
    expect(texts('gr-git-history .sha')).toEqual(['s1', 's2']);
    expect(texts('gr-git-history .subject')).toEqual(['Commit 1', 'Commit 2']);
    expect(texts('gr-git-history .mark')).toEqual(['only on this branch']);
    expect(fake.calls.find((c) => c.command === 'git.log')?.request).toEqual({
      cwd: 'C:/Users/me',
      ref: 'feature',
      skip: 0,
      limit: 50,
    });

    el.querySelector<HTMLButtonElement>('gr-git-history .older')!.click();
    await fixture.whenStable();
    expect(texts('gr-git-history .subject')).toEqual(['Commit 1', 'Commit 2', 'Commit 3']);
    expect(el.querySelector('gr-git-history .older')).toBeNull();

    el.querySelector<HTMLButtonElement>('gr-git-history .chat')!.click();
    await fixture.whenStable();
    expect(fake.calls.find((c) => c.command === 'agents.open')?.request).toEqual({
      agent: 'claude-code',
      chatId: 'c1',
      settings: { cwd: 'C:/w' },
    });
  });

  it("shows a branch's history when you pick it", async () => {
    const { answers, calls, fixture, el, texts } = await openGit();
    answers['git.log'] = ({ ref }: { ref: string }): GitLog => ({
      commits: [commitOf(ref === 'main' ? 9 : 1)],
      more: false,
    });
    el.querySelectorAll<HTMLButtonElement>('gr-git-page .branch-row')[0]!.click();
    await fixture.whenStable();
    expect(texts('gr-git-page #git-history')).toEqual(['History of main']);
    expect(texts('gr-git-page .branch-row[aria-pressed="true"] .name')).toEqual(['main']);
    expect(texts('gr-git-history .subject')).toEqual(['Commit 9']);
    expect(calls.filter((c) => c.command === 'git.log').at(-1)?.request).toMatchObject({
      ref: 'main',
    });
  });

  it('says so when a branch has no commits', async () => {
    const { texts } = await openGit();
    expect(texts('gr-git-history .none')).toEqual(['No commits here.']);
  });
});
