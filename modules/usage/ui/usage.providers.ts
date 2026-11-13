import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { UsagePage } from './usage-page';

/** The Usage module: its page tab turns the right page to your agents' usage. */
export function provideUsage(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'usage',
      label: 'Ledger',
      plainLabel: 'Usage',
      order: 50,
      component: UsagePage,
    });
  });
}
