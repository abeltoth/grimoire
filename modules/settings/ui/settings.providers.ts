import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Profiles } from '@ui/app/core/profiles';
import { Settings } from '@ui/app/core/settings';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { stepScale } from './scale';

/**
 * The Settings module: its page tab turns the right page to
 * Grimoire's settings. A profile switched to so it could be signed in
 * opens on it, to ask for the account. Its commands scale every window.
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
      load: () => import('./settings-page').then((m) => m.SettingsPage),
    });
    const settings = inject(Settings);
    const scaleBy = (steps: number) =>
      void settings.set({ scale: stepScale(settings.all().scale ?? 1, steps) });
    shell.commands.add({
      id: 'settings.zoomIn',
      label: 'Larger pages',
      plainLabel: 'Zoom in',
      shortcut: 'Mod+=',
      run: () => scaleBy(1),
    });
    shell.commands.add({
      id: 'settings.zoomOut',
      label: 'Smaller pages',
      plainLabel: 'Zoom out',
      shortcut: 'Mod+-',
      run: () => scaleBy(-1),
    });
    shell.commands.add({
      id: 'settings.zoomReset',
      label: 'Pages as drawn',
      plainLabel: 'Actual size',
      shortcut: 'Mod+0',
      run: () => void settings.set({ scale: 1 }),
    });
  });
}
