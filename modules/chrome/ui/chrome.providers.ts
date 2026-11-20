import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';

/** The Claude in Chrome module: its section of the Settings page, with the switch and the extension's state. */
export function provideChrome(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.settingsSections.add({
      id: 'chrome',
      load: () => import('./chrome-settings').then((m) => m.ChromeSettings),
    });
  });
}
