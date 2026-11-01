import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '../shell/shell-registry';
import { OutlinePlaceholder } from './outline-placeholder';

/**
 * Entries for features that aren't built yet, as screen 1 shows them. Each
 * one moves to its feature's module when that is built; until then they
 * show but do nothing.
 */
export function providePlaceholders(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const thumbs = [
      'Table of contents',
      'Front matter',
      'Kanban',
      'Memory map',
      'Scheduled chats',
      'Ledger',
      'Colophon',
    ];
    thumbs.forEach((label, i) =>
      shell.thumbs.add({ id: label.toLowerCase().replaceAll(' ', '-'), label, order: i * 10 }),
    );

    shell.facingPages.add({
      id: 'outline',
      label: 'Outline',
      order: 10,
      component: OutlinePlaceholder,
    });
    shell.facingPages.add({ id: 'files', label: 'Files', order: 20 });
    shell.facingPages.add({ id: 'git', label: 'Git', order: 30 });
    shell.facingPages.add({ id: 'second-chapter', label: 'Second chapter', order: 40 });

    shell.indicators.add({
      id: 'git.branch',
      label: 'feature/context-meter',
      icon: 'branch',
      order: 10,
    });
    shell.indicators.add({ id: 'schedule.next', label: 'Morning repo summary at 8:00', order: 20 });
  });
}
