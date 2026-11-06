import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '../shell/shell-registry';

/**
 * Entries for features that aren't built yet, as screen 1 shows them. Each
 * one moves to its feature's module when that is built; until then a thumb
 * tab opens a blank page, and the rest show but do nothing.
 */
export function providePlaceholders(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    // The Table of contents, at 0, the Front matter, at 10, the Memory map, at 30, Scheduled chats,
    // at 40, the Ledger, at 50, the Scriptorium, at 55, and the Colophon, at 60, are modules of
    // their own, as are the Git page, the branch in the running foot and the next scheduled run.
    const thumbs: [label: string, plainLabel: string, order: number][] = [['Kanban', 'Kanban', 20]];
    thumbs.forEach(([label, plainLabel, order]) =>
      shell.thumbs.add({ id: label.toLowerCase().replaceAll(' ', '-'), label, plainLabel, order }),
    );

    shell.facingPages.add({ id: 'files', label: 'Files', order: 20 });
  });
}
