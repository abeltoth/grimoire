import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { forgetRemovedProfiles } from './forget-profiles';

/** The browser module: its page tab turns the right page to web pages, such as Gemini or Pinterest. */
export function provideBrowser(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'browser',
      label: 'Atlas',
      plainLabel: 'Browser',
      order: 57,
      load: () => import('./browser-page').then((m) => m.BrowserPage),
    });
    forgetRemovedProfiles();
  });
}
