import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { WorkflowSetupPage } from './workflow-setup-page';

/** The Workflow setup module (ADR-008): its page tab turns the right page to what your agents load. */
export function provideWorkflowSetup(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'workflow-setup',
      label: 'Front matter',
      plainLabel: 'Workflow setup',
      order: 10,
      component: WorkflowSetupPage,
    });
  });
}
