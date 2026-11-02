import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Facing } from '@ui/app/shell/facing';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { GitPage } from './git-page';
import { GitState, branchLabel, stampsOf, statusDetail } from './git-state';

/**
 * The git module (ADR-008): the open chapter's branch in the running foot,
 * its pull request's stamps in the running head, and the Git page, which
 * both of them turn the facing page to.
 */
export function provideGit(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const git = inject(GitState);
    const facing = inject(Facing);
    const open = () => facing.showPage('git');
    shell.facingPages.add({ id: 'git', label: 'Git', order: 30, component: GitPage });

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
      for (const [i, stamp] of stampsOf(pr).entries()) {
        onCleanup(shell.stamps.add({ ...stamp, order: i, open }));
      }
    });
  });
}
