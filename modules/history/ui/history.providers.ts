import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { HistoryPage } from './history-page';

/** The history module (ADR-008): its page tab turns the right page to the History. */
export function provideHistory(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'history',
      label: 'Table of contents',
      plainLabel: 'History',
      order: 0,
      component: HistoryPage,
    });
  });
}
