import { type EnvironmentProviders, effect, inject, untracked } from '@angular/core';
import { Chats } from '@ui/app/core/chats';
import { Facing } from '@ui/app/shell/facing';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChapterPage, SECOND_CHAPTER } from './chapter-page';
import { HelperPage } from './helper-page';
import { HELPER_PAGE, Helpers } from './helpers';
import { Outline, outlineFoot } from './outline';
import { SealsPage } from './seals-page';
import { SecondChapter } from './second-chapter';

/**
 * The chat module (ADR-008): it fills the left page with the open chapter,
 * the facing page's Outline with its plan, its Second chapter with
 * another chapter beside it, its Helper with what a subagent one of a
 * chapter's tool calls started did, and the facing page with the slips
 * awaiting your seal when it's turned there.
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
    shell.facingPages.add({
      id: SECOND_CHAPTER,
      label: 'Second chapter',
      plainLabel: 'Second chat',
      order: 40,
      component: SecondChapter,
      heading: () => chats.beside()?.title || undefined,
      whole: true,
    });
    const helpers = inject(Helpers);
    shell.facingPages.add({
      id: HELPER_PAGE,
      label: 'Helper',
      plainLabel: 'Subagent',
      order: 45,
      component: HelperPage,
      heading: () => {
        const input = helpers.block()?.input as { description?: unknown } | undefined;
        return typeof input?.description === 'string' && input.description ? input.description : undefined;
      },
      whole: true,
    });

    // A chapter put beside the one you're on, or found there as the book opens, shows on the facing page.
    const facing = inject(Facing);
    effect(() => {
      if (chats.besideId()) untracked(() => facing.showPage(SECOND_CHAPTER));
    });
  });
}
