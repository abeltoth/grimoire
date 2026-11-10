import type {
  Card,
  CardColumn,
  CardDraft,
  CommandRequest,
  JiraTransition,
} from '@grimoire/contract';
import { CARD_COLUMNS } from '@grimoire/contract';
import { fakeBridge } from '@ui/testing/app-harness';

/** What the Kanban page's specs share: a board the fake service keeps, and ways to read and work it. */
export const card = (
  id: string,
  title: string,
  column: CardColumn,
  change: Partial<Card> = {},
): Card => ({
  id,
  kind: 'task',
  title,
  notes: '',
  cwd: 'C:/Users/me/git/grimoire',
  column,
  createdAt: 0,
  chats: [],
  ...change,
});

/** A fake service keeping the cards as the service does: column by column, each change told to windows. */
export function withBoard(start: Card[] = []) {
  const fake = fakeBridge();
  let cards = start;
  let next = start.length + 1;
  const sorted = (all: Card[]) =>
    [...all].sort((a, b) => CARD_COLUMNS.indexOf(a.column) - CARD_COLUMNS.indexOf(b.column));
  const changed = (all: Card[]) => {
    cards = sorted(all);
    fake.emit('kanban.changed', { cards });
    return cards;
  };
  const place = (id: string, column: CardColumn, before?: string) => {
    const moved = { ...cards.find((c) => c.id === id)!, column };
    const rest = cards.filter((c) => c.id !== id);
    const at = before ? rest.findIndex((c) => c.id === before) : -1;
    rest.splice(at === -1 ? rest.length : at, 0, moved);
    return rest;
  };
  fake.answers['kanban.list'] = () => cards;
  fake.answers['kanban.save'] = ({ id, ...draft }: CardDraft) =>
    changed(
      id
        ? cards.map((c) => (c.id === id ? { ...c, ...draft } : c))
        : [...cards, card(`card-${next++}`, draft.title, 'todo', draft)],
    );
  fake.answers['kanban.move'] = ({ id, column, before }: CommandRequest<'kanban.move'>) =>
    changed(place(id, column, before));
  fake.answers['kanban.close'] = ({ id, closed }: CommandRequest<'kanban.close'>) =>
    changed(
      cards.map((c) => {
        if (c.id !== id) return c;
        const { closedAt: _, ...open } = c;
        return closed ? { ...open, closedAt: Date.now() } : open;
      }),
    );
  fake.answers['kanban.link'] = ({ id, ...chat }: CommandRequest<'kanban.link'>) => {
    cards = cards.map((c) => (c.id === id ? { ...c, chats: [...c.chats, { ...chat, at: 0 }] } : c));
    const linked = cards.find((c) => c.id === id)!;
    return changed(linked.kind === 'task' && linked.column === 'todo' ? place(id, 'doing') : cards);
  };
  /** Jira: the transitions it allows, what it says as it refuses one, and a change answered once `wait` is. */
  const jira = { transitions: TRANSITIONS, refuse: '', wait: Promise.resolve() };
  fake.answers['kanban.transitions'] = ({ column }: CommandRequest<'kanban.transitions'>) =>
    jira.transitions.filter((t) => !column || t.column === column);
  fake.answers['kanban.transition'] = async ({
    id,
    transition,
  }: CommandRequest<'kanban.transition'>) => {
    await jira.wait;
    if (jira.refuse) throw new Error(jira.refuse);
    return changed(
      cards.map((c) =>
        c.id === id
          ? { ...c, column: transition.column, jira: { ...c.jira!, status: transition.status } }
          : c,
      ),
    );
  };
  return { ...fake, jira };
}

/** The statuses Jira allows an issue in To Do. */
export const TRANSITIONS: JiraTransition[] = [
  { id: '11', name: 'Start', status: 'In Progress', column: 'doing' },
  { id: '21', name: 'Review', status: 'In Review', column: 'doing' },
  { id: '31', name: 'Finish', status: 'Done', column: 'done' },
  { id: '41', name: 'Park', status: 'Backlog', column: 'todo' },
];

/** An issue from Jira, as the service lists it. */
export const issue = (
  id: string,
  key: string,
  title: string,
  column: CardColumn,
  change: Partial<Card> = {},
): Card =>
  card(id, title, column, {
    kind: 'jira',
    cwd: '',
    jira: {
      key,
      url: `https://acme.atlassian.net/browse/${key}`,
      type: 'Bug',
      priority: 'High',
      status: column === 'doing' ? 'In Review' : 'To Do',
    },
    ...change,
  });

export async function openBoard(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement) {
  [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
    .find((tab) => tab.textContent!.trim() === 'Kanban')!
    .click();
  await fixture.whenStable();
}

export const cardEl = (el: HTMLElement, title: string) =>
  [...el.querySelectorAll<HTMLElement>('gr-kanban-page .card[data-card]')].find(
    (c) => c.querySelector('.name')?.textContent!.trim() === title,
  )!;

export const button = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
  )!;

/** Each column's card titles, in order. */
export const board = (texts: (selector: string) => string[]) =>
  Object.fromEntries(
    CARD_COLUMNS.map((column) => [
      column,
      texts(`gr-kanban-page [aria-labelledby="gr-kanban-${column}"] .card[data-card] .name`),
    ]),
  ) as Record<CardColumn, string[]>;

export const field = (el: HTMLElement, selector: string, value: string) => {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

export const drag = (type: string, target: Element) =>
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
