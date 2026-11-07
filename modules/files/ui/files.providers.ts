import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { LEAF } from '@ui/app/core/leaf';
import { Facing } from '@ui/app/shell/facing';
import { Focus } from '@ui/app/shell/focus';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { FilesPage } from './files-page';
import { FilesViews } from './files-views';

/**
 * The files module (ADR-008): the Files page, on the facing page, and Open
 * in Files, which turns to it with a file open, where there's a facing page.
 */
export function provideFiles(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.facingPages.add({ id: 'files', label: 'Files', order: 20, component: FilesPage });

    const facing = inject(Facing);
    const focus = inject(Focus);
    const leaf = inject(LEAF);
    const views = inject(FilesViews);
    const open = (path: string) => {
      facing.showPage('files');
      // A page that holds changes you haven't saved keeps the facing page from turning.
      if (facing.turned() || facing.page() !== 'files') return;
      const cwd = views.cwd();
      void views.open(views.of(cwd), inFull(path, cwd), true);
    };
    effect(() => shell.openFile.set(leaf || focus.on() ? undefined : open));
  });
}

/** A path from the chapter's folder, written in full; one already in full stays as it is. */
function inFull(path: string, cwd: string): string {
  return /^([a-zA-Z]:)?[\\/]|^~([\\/]|$)/.test(path)
    ? path
    : `${cwd.replace(/[\\/]$/, '')}/${path}`;
}
