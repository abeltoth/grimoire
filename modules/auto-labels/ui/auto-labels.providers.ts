import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { LabelSettings } from './label-settings';

/** The auto-labels module: its section of the Settings page, saying when chats are labelled. */
export function provideAutoLabels(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.settingsSections.add({ id: 'labels', component: LabelSettings });
  });
}
