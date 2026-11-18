import { type EnvironmentProviders, effect, inject } from '@angular/core';
import type { Card } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { type Badge, provideShellEntries } from '@ui/app/shell/shell-registry';
import { Board, COLUMNS } from './board';
import { JiraLink } from './jira-link';

/** How much of a card's title its badge shows. */
const BADGE_LENGTH = 32;

/**
 * The Kanban module: its page tab turns the right page to the
 * board, and a chat begun from a card bears that card's badge in its
 * page header, which turns there too; a Jira card's names its issue and
 * opens it in Jira. A chat with no Jira issue says so after its title,
 * while Jira is on; Jira's settings are a section of the Settings page.
 */
export function provideKanban(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const board = inject(Board);
    const rightPage = inject(RightPageState);
    const wording = inject(Wording);
    shell.pageTabs.add({
      id: 'kanban',
      label: 'Kanban',
      order: 20,
      load: () => import('./kanban-page').then((m) => m.KanbanPage),
    });
    shell.afterTitle.add({ id: 'kanban.jira', order: 10, component: JiraLink });
    shell.settingsSections.add({
      id: 'jira',
      order: 10,
      load: () => import('./jira-settings').then((m) => m.JiraSettings),
    });

    effect((onCleanup) => {
      const card = board.current();
      if (!card) return;
      onCleanup(
        shell.badges.add({
          id: 'kanban.card',
          tone: 'quiet',
          order: 10,
          ...(card.jira
            ? issueBadge(card, card.jira, () => board.openInJira(card), wording)
            : taskBadge(card, () => rightPage.openPageTab('kanban'), wording)),
        }),
      );
    });
  });
}

type BadgeText = Pick<Badge, 'label' | 'detail' | 'open'>;

/** A task's badge: its title, shortened, turning to the board. */
function taskBadge(card: Card, open: () => void, wording: Wording): BadgeText {
  const label =
    card.title.length > BADGE_LENGTH
      ? `${card.title.slice(0, BADGE_LENGTH - 1).trimEnd()}…`
      : card.title;
  const column = COLUMNS.find((c) => c.column === card.column)!.label;
  return {
    label,
    detail: wording.say(
      `This chapter’s card on the Kanban board, in ${column}: ${card.title}`,
      `This chat’s card on the Kanban board, in ${column}: ${card.title}`,
    ),
    open,
  };
}

/** A Jira card's badge: its issue's key and status, opening the issue in Jira. */
function issueBadge(
  card: Card,
  jira: NonNullable<Card['jira']>,
  open: () => void,
  wording: Wording,
): BadgeText {
  return {
    label: `${jira.key} · ${jira.status}`,
    detail: wording.say(
      `This chapter’s Jira issue, in ${jira.status}: ${card.title}. Opens it in Jira.`,
      `This chat’s Jira issue, in ${jira.status}: ${card.title}. Opens it in Jira.`,
    ),
    open,
  };
}
