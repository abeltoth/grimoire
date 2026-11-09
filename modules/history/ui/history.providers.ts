import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChatTags } from './chat-tags';
import { HistoryPage } from './history-page';
import { Pins } from './pins';

/**
 * The history module (ADR-008): its page tab turns the right page to the
 * History. It puts the pins on the open chat's corners and its tags after
 * its title, and pinned chats first in the command palette.
 */
export function provideHistory(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.pageTabs.add({
      id: 'history',
      label: 'Table of contents',
      plainLabel: 'History',
      order: 0,
      component: HistoryPage,
    });
    shell.chatCorners.add({ id: 'pins', component: Pins });
    shell.afterTitle.add({ id: 'tags', component: ChatTags });
    shell.rankChat.set((chat) => Number(chat.pins.includes('pin')));
  });
}
