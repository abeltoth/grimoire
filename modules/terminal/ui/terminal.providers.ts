import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { TerminalPage } from './terminal-page';

/** The terminal module: its page tab turns the right page to the Terminal, your shells. */
export function provideTerminal(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'terminals',
      label: 'Scriptorium',
      plainLabel: 'Terminal',
      order: 55,
      component: TerminalPage,
    });
  });
}
