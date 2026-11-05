import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '../shell/shell-registry';

/**
 * Entries for features that aren't built yet, as screen 1 shows them. Each
 * one moves to its feature's module when that is built; until then a thumb
 * tab opens a blank page, and the rest show but do nothing.
 */
export function providePlaceholders(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    // The Table of contents, at 0, the Ledger, at 50, and Scheduled chats, at 40, are modules of
    // their own, as are the Git page, the branch in the running foot and the next scheduled run.
    const thumbs: [string, number][] = [
      ['Front matter', 10],
      ['Kanban', 20],
      ['Memory map', 30],
      ['Colophon', 60],
    ];
    thumbs.forEach(([label, order]) =>
      shell.thumbs.add({ id: label.toLowerCase().replaceAll(' ', '-'), label, order }),
    );

    shell.facingPages.add({ id: 'files', label: 'Files', order: 20 });
    shell.facingPages.add({ id: 'second-chapter', label: 'Second chapter', order: 40 });
  });
}
