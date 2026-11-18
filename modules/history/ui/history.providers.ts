import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChatTags } from './chat-tags';
import { Pins } from './pins';

/**
 * The history module: its page tab turns the right page to the
 * History. It puts the pins on the open chat's corners and its tags after
 * its title, and your tag list on the Settings page, before the labels that pick from it.
 */
export function provideHistory(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'history',
      label: 'Table of contents',
      plainLabel: 'History',
      order: 0,
      load: () => import('./history-page').then((m) => m.HistoryPage),
    });
    shell.chatCorners.add({ id: 'pins', component: Pins });
    shell.afterTitle.add({ id: 'tags', component: ChatTags });
    shell.settingsSections.add({
      id: 'tags',
      order: -1,
      load: () => import('./tag-settings').then((m) => m.TagSettings),
    });
  });
}
