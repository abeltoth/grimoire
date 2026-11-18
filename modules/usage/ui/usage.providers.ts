import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';

/** The Usage module: its page tab turns the right page to your agents' usage. */
export function provideUsage(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'usage',
      label: 'Ledger',
      plainLabel: 'Usage',
      order: 50,
      load: () => import('./usage-page').then((m) => m.UsagePage),
    });
  });
}
