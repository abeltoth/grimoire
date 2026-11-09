import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { MemoriesPage } from './memories-page';

/** The Memories module (ADR-008): its page tab turns the right page to your agents' memories. */
export function provideMemories(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'memories',
      label: 'Memory map',
      plainLabel: 'Memories',
      order: 30,
      component: MemoriesPage,
    });
  });
}
