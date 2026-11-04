import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Facing } from '@ui/app/shell/facing';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ScheduledChats } from './scheduled-chats';
import { SchedulesPage } from './schedules-page';
import { upcoming } from './wording';

/**
 * The scheduled chats module (ADR-008): its thumb tab turns the facing
 * page to the schedules, and the running foot names the next run. A run's
 * chapter joins the book as it begins, whichever page is open.
 */
export function provideScheduledChats(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const scheduled = inject(ScheduledChats);
    const facing = inject(Facing);
    shell.thumbs.add({ id: 'scheduled-chats', label: 'Scheduled chats', order: 40, component: SchedulesPage });

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
          open: () => facing.openThumb('scheduled-chats'),
        }),
      );
    });
  });
}
