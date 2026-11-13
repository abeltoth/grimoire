import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { OptimizeSettings } from './optimize-settings';

/** The Optimize module: its Tune-up section on the Settings page runs checks of the agent's own setup. */
export function provideOptimize(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.settingsSections.add({ id: 'optimize', order: 10, component: OptimizeSettings });
  });
}
