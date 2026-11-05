import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ContentsPage } from './contents-page';

/** The history module (ADR-008): its thumb tab turns the facing page to the Table of contents. */
export function provideTableOfContents(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({
      id: 'table-of-contents',
      label: 'Table of contents',
      order: 0,
      component: ContentsPage,
    });
  });
}
