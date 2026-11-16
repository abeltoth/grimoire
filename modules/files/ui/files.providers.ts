import { type EnvironmentProviders, inject } from '@angular/core';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { Focus } from '@ui/app/shell/focus';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { FilesPage } from './files-page';
import { FilesViews } from './files-views';

/**
 * The files module: the Files page, on the right page or alone in focus
 * mode; Open in Files, which turns to it with a file open; and a shortcut
 * that turns to it, or in focus mode between it and the chat.
 */
export function provideFiles(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.rightPages.add({ id: 'files', label: 'Files', order: 20, component: FilesPage });

    const rightPage = inject(RightPageState);
    const focus = inject(Focus);
    const views = inject(FilesViews);
    /** Shows the Files page: alone in focus mode, or else on the right page; false when it can't turn there. */
    const show = (): boolean => {
      if (focus.on()) {
        focus.lay('files');
        return true;
      }
      rightPage.showPage('files');
      // A page that holds changes you haven't saved keeps the right page from turning.
      return !rightPage.turned() && rightPage.page() === 'files';
    };

    shell.commands.add({
      id: 'files.show',
      label: 'Files',
      shortcut: 'Mod+Shift+E',
      run: () => {
        if (focus.on() && focus.alone() === 'files') focus.lay(null);
        else show();
      },
    });
    shell.openFile.set((path, line) => {
      if (!show()) return;
      const cwd = views.cwd();
      void views.open(views.of(cwd), inFull(path, cwd), line === undefined, line);
    });
  });
}

/** A path from the chat's folder, written in full; one already in full stays as it is. */
function inFull(path: string, cwd: string): string {
  return /^([a-zA-Z]:)?[\\/]|^~([\\/]|$)/.test(path)
    ? path
    : `${cwd.replace(/[\\/]$/, '')}/${path}`;
}
