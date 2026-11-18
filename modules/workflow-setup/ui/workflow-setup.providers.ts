import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';

/** The Workflow setup module: its page tab turns the right page to what your agents load. */
export function provideWorkflowSetup(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'workflow-setup',
      label: 'Front matter',
      plainLabel: 'Workflow setup',
      order: 10,
      load: () => import('./workflow-setup-page').then((m) => m.WorkflowSetupPage),
    });
  });
}
