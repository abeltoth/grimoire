import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { GitPage } from './git-page';
import { GitState, branchLabel, badgesOf, statusDetail } from './git-state';

/**
 * The git module (ADR-008): the open chat's branch in the page footer,
 * its pull request's badges in the page header, and the Git page, which
 * both of them turn the right page to.
 */
export function provideGit(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const git = inject(GitState);
    const rightPage = inject(RightPageState);
    const open = () => rightPage.showPage('git');
    shell.rightPages.add({ id: 'git', label: 'Git', order: 30, component: GitPage });

    // Outside a repository there's no branch to show.
    effect((onCleanup) => {
      const status = git.status();
      if (!status) return;
      onCleanup(
        shell.indicators.add({
          id: 'git.branch',
          label: branchLabel(status),
          icon: 'branch',
          order: 10,
          detail: statusDetail(status),
          open,
        }),
      );
    });

    effect((onCleanup) => {
      const pr = git.pullRequest();
      if (!pr) return;
      for (const [i, badge] of badgesOf(pr).entries()) {
        onCleanup(shell.badges.add({ ...badge, order: i, open }));
      }
    });
  });
}
