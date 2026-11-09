import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Profiles } from '@ui/app/core/profiles';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { SettingsPage } from './settings-page';

/**
 * The Settings module (ADR-008): its page tab turns the right page to
 * Grimoire's settings. A profile switched to so it could be signed in
 * opens on it, to ask for the account.
 */
export function provideSettings(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const profiles = inject(Profiles);
    const rightPage = inject(RightPageState);
    effect(() => {
      if (profiles.signInNext()) rightPage.openPageTab('settings');
    });
    shell.pageTabs.add({
      id: 'settings',
      label: 'Colophon',
      plainLabel: 'Settings',
      order: 60,
      component: SettingsPage,
    });
  });
}
