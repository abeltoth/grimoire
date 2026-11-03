import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ScriptoriumPage } from './scriptorium-page';

/** The terminal module (ADR-008): its thumb tab turns the facing page to the Scriptorium, your shells. */
export function provideScriptorium(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({ id: 'scriptorium', label: 'Scriptorium', order: 55, component: ScriptoriumPage });
  });
}
