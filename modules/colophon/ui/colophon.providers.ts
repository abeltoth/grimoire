import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ColophonPage } from './colophon-page';

/** The Colophon module (ADR-008): its thumb tab turns the facing page to Grimoire's settings. */
export function provideColophon(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({
      id: 'colophon',
      label: 'Colophon',
      plainLabel: 'Settings',
      order: 60,
      component: ColophonPage,
    });
  });
}
