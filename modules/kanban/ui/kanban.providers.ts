import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { Facing } from '@ui/app/shell/facing';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { Board, COLUMNS } from './board';
import { KanbanPage } from './kanban-page';

/** How much of a card's title its stamp shows. */
const STAMP_LENGTH = 32;

/**
 * The Kanban module (ADR-008): its thumb tab turns the facing page to the
 * board, and a chapter begun from a card bears that card's stamp in its
 * running head, which turns there too.
 */
export function provideKanban(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const board = inject(Board);
    const facing = inject(Facing);
    const wording = inject(Wording);
    shell.thumbs.add({ id: 'kanban', label: 'Kanban', order: 20, component: KanbanPage });

    effect((onCleanup) => {
      const card = board.current();
      if (!card) return;
      const label =
        card.title.length > STAMP_LENGTH ? `${card.title.slice(0, STAMP_LENGTH - 1).trimEnd()}…` : card.title;
      const column = COLUMNS.find((c) => c.column === card.column)!.label;
      onCleanup(
        shell.stamps.add({
          id: 'kanban.card',
          label,
          tone: 'quiet',
          order: 10,
          detail: wording.say(
            `This chapter’s card on the Kanban board, in ${column}: ${card.title}`,
            `This chat’s card on the Kanban board, in ${column}: ${card.title}`,
          ),
          open: () => facing.openThumb('kanban'),
        }),
      );
    });
  });
}
