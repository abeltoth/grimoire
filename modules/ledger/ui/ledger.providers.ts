import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { LedgerPage } from './ledger-page';

/** The Ledger module (ADR-008): its thumb tab turns the facing page to your agents' usage. */
export function provideLedger(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.thumbs.add({ id: 'ledger', label: 'Ledger', order: 50, component: LedgerPage });
  });
}
