import { type EnvironmentProviders, inject } from '@angular/core';
import { Chats } from '@ui/app/core/chats';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChapterPage } from './chapter-page';
import { Outline, outlineFoot } from './outline';
import { SealsPage } from './seals-page';

/**
 * The chat module (ADR-008): it fills the left page with the open chapter,
 * the facing page's Outline with its plan, and the facing page with the
 * slips awaiting your seal when it's turned there.
 */
export function provideChat(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.chapterPage.set(ChapterPage);
    shell.sealsPage.set(SealsPage);
    const chats = inject(Chats);
    shell.facingPages.add({
      id: 'outline',
      label: 'Outline',
      plainLabel: 'Plan',
      order: 10,
      component: Outline,
      foot: () => outlineFoot(chats),
    });
  });
}
