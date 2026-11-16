import { fakeDialogs, render } from '@ui/testing/app-testing';
import {
  button,
  card,
  cardEl,
  field,
  issue,
  openBoard,
  openJira,
  withBoard,
} from './kanban-testing';

describe('card-large', () => {
  fakeDialogs();

  it('opens a card large on a click, written out to change, with its buttons, and saves it', async () => {
    const { bridge, calls } = withBoard([
      card('a', 'Track the meter', 'todo', { notes: 'One.\nTwo.' }),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-kanban-page dialog.large')!;
    expect(dialog.hasAttribute('open')).toBe(false);

    cardEl(el, 'Track the meter').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('gr-card-form .name')!.value).toBe(
      'Track the meter',
    );
    expect(dialog.querySelector<HTMLTextAreaElement>('gr-card-form .notes')!.value).toBe(
      'One.\nTwo.',
    );
    expect(texts('gr-kanban-page dialog .held > .actions button')).toEqual([
      'New chapter',
      'Move to…',
      'Close',
    ]);
    expect(cardEl(el, 'Track the meter').querySelector('.actions')).toBeNull();

    field(dialog, 'gr-card-form .notes', 'One.\nTwo.\nThree.');
    dialog.querySelector<HTMLButtonElement>('gr-card-form .send')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.save').at(-1)!.request).toMatchObject({
      id: 'a',
      title: 'Track the meter',
      notes: 'One.\nTwo.\nThree.',
    });
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(cardEl(el, 'Track the meter').querySelector('.actions')).not.toBeNull();
  });

  it('moves a card while it’s large, and puts it away once it’s closed', async () => {
    const { bridge } = withBoard([card('a', 'Track the meter', 'todo')]);
    const { fixture, el } = await render(bridge);
    await openBoard(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-kanban-page dialog.large')!;
    cardEl(el, 'Track the meter').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();

    button(dialog, 'Move to…').click();
    await fixture.whenStable();
    button(dialog, 'In progress').click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('.move'));

    button(dialog, 'Close').click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('shows a Jira card large with its notes whole, and puts it away on a click beside it', async () => {
    const notes = 'One.\nTwo.\nThree.\nFour.\nFive.';
    const { bridge } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo', { notes })]);
    const { fixture, el } = await render(bridge);
    await openJira(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-kanban-page dialog.large')!;
    cardEl(el, 'Context meter').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();
    expect(dialog.querySelector('gr-card-form')).toBeNull();
    expect(dialog.querySelector('.key')!.textContent).toBe('GRIM-12');
    expect(dialog.querySelector('.notes.whole')!.textContent).toBe(notes);

    dialog.querySelector<HTMLElement>('.slip')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    dialog.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
