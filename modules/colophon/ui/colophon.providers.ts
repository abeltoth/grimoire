import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Profiles } from '@ui/app/core/profiles';
import { Facing } from '@ui/app/shell/facing';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ColophonPage } from './colophon-page';

/**
 * The Colophon module (ADR-008): its thumb tab turns the facing page to
 * Grimoire's settings. A profile switched to so it could be signed in
 * opens on it, to ask for the account.
 */
export function provideColophon(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const profiles = inject(Profiles);
    const facing = inject(Facing);
    effect(() => {
      if (profiles.signInNext()) facing.openThumb('colophon');
    });
    shell.thumbs.add({
      id: 'colophon',
      label: 'Colophon',
      plainLabel: 'Settings',
      order: 60,
      component: ColophonPage,
    });
  });
}
