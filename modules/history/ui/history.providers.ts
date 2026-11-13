import { type EnvironmentProviders, inject } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChatTags } from './chat-tags';
import { HistoryPage } from './history-page';
import { Pins } from './pins';
import { PinsAndTags } from './pins-and-tags';

/**
 * The history module: its page tab turns the right page to the
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
    const pinsAndTags = inject(PinsAndTags);
    shell.rankChat.set((chat) => Number(pinsAndTags.pins(chat.id).includes('pin')));
  });
}
