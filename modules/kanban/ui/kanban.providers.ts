import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { Board, COLUMNS } from './board';
import { KanbanPage } from './kanban-page';

/** How much of a card's title its badge shows. */
const BADGE_LENGTH = 32;

/**
 * The Kanban module (ADR-008): its page tab turns the right page to the
 * board, and a chat begun from a card bears that card's badge in its
 * page header, which turns there too.
 */
export function provideKanban(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const board = inject(Board);
    const rightPage = inject(RightPageState);
    const wording = inject(Wording);
    shell.pageTabs.add({ id: 'kanban', label: 'Kanban', order: 20, component: KanbanPage });

    effect((onCleanup) => {
      const card = board.current();
      if (!card) return;
      const label =
        card.title.length > BADGE_LENGTH
          ? `${card.title.slice(0, BADGE_LENGTH - 1).trimEnd()}…`
          : card.title;
      const column = COLUMNS.find((c) => c.column === card.column)!.label;
      onCleanup(
        shell.badges.add({
          id: 'kanban.card',
          label,
          tone: 'quiet',
          order: 10,
          detail: wording.say(
            `This chapter’s card on the Kanban board, in ${column}: ${card.title}`,
            `This chat’s card on the Kanban board, in ${column}: ${card.title}`,
          ),
          open: () => rightPage.openPageTab('kanban'),
        }),
      );
    });
  });
}
