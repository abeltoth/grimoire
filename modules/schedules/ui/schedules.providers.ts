import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ScheduledChats } from './scheduled-chats';
import { SchedulesPage } from './schedules-page';
import { upcoming } from './wording';

/**
 * The scheduled chats module (ADR-008): its page tab turns the right
 * page to the schedules, and the page footer names the next run. A run's
 * chat joins the open chats as it begins, whichever page is open.
 */
export function provideScheduledChats(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const scheduled = inject(ScheduledChats);
    const rightPage = inject(RightPageState);
    shell.pageTabs.add({ id: 'scheduled-chats', label: 'Scheduled chats', order: 40, component: SchedulesPage });

    effect((onCleanup) => {
      const next = scheduled.next();
      if (next?.nextAt == null) return;
      onCleanup(
        shell.indicators.add({
          id: 'schedules.next',
          label: `${next.name} ${upcoming(next.nextAt, Date.now())}`,
          order: 20,
          detail: `The next scheduled chat: ${new Date(next.nextAt).toLocaleString([], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
          })}`,
          open: () => rightPage.openPageTab('scheduled-chats'),
        }),
      );
    });
  });
}
