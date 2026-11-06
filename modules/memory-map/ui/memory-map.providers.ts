import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { MemoryMapPage } from './memory-map-page';

/** The Memory map module (ADR-008): its thumb tab turns the facing page to your agents' memories. */
export function provideMemoryMap(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({
      id: 'memory-map',
      label: 'Memory map',
      plainLabel: 'Memories',
      order: 30,
      component: MemoryMapPage,
    });
  });
}
