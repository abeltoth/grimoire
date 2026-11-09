import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { POPOUT } from '@ui/app/core/popout';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { Focus } from '@ui/app/shell/focus';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { FilesPage } from './files-page';
import { FilesViews } from './files-views';

/**
 * The files module (ADR-008): the Files page, on the right page, and Open
 * in Files, which turns to it with a file open, where there's a right page.
 */
export function provideFiles(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.rightPages.add({ id: 'files', label: 'Files', order: 20, component: FilesPage });

    const rightPage = inject(RightPageState);
    const focus = inject(Focus);
    const popout = inject(POPOUT);
    const views = inject(FilesViews);
    const open = (path: string) => {
      rightPage.showPage('files');
      // A page that holds changes you haven't saved keeps the right page from turning.
      if (rightPage.turned() || rightPage.page() !== 'files') return;
      const cwd = views.cwd();
      void views.open(views.of(cwd), inFull(path, cwd), true);
    };
    effect(() => shell.openFile.set(popout || focus.on() ? undefined : open));
  });
}

/** A path from the chat's folder, written in full; one already in full stays as it is. */
function inFull(path: string, cwd: string): string {
  return /^([a-zA-Z]:)?[\\/]|^~([\\/]|$)/.test(path)
    ? path
    : `${cwd.replace(/[\\/]$/, '')}/${path}`;
}
