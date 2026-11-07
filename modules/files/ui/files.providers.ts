import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { FilesPage } from './files-page';

/** The files module (ADR-008): the Files page, on the facing page. */
export function provideFiles(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.facingPages.add({ id: 'files', label: 'Files', order: 20, component: FilesPage });
  });
}
