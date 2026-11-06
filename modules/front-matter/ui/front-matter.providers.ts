import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { FrontMatterPage } from './front-matter-page';

/** The Front matter module (ADR-008): its thumb tab turns the facing page to what your agents load. */
export function provideFrontMatter(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({
      id: 'front-matter',
      label: 'Front matter',
      plainLabel: 'Workflow setup',
      order: 10,
      component: FrontMatterPage,
    });
  });
}
