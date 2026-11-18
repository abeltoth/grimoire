import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';

/** The Memories module: its page tab turns the right page to your agents' memories. */
export function provideMemories(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'memories',
      label: 'Memory map',
      plainLabel: 'Memories',
      order: 30,
      load: () => import('./memories-page').then((m) => m.MemoriesPage),
    });
  });
}
