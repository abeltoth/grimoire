import { render } from '@ui/testing/app-testing';
import { card, cardEl, openBoard, withBoard } from './kanban-testing';

describe('card-large', () => {
  // jsdom has no modal dialogs, so here they open and close by their attribute.
  const dialogs = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
  beforeEach(() => {
    dialogs.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    dialogs.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => {
    delete dialogs.showModal;
    delete dialogs.close;
  });

  it('opens a card large on a click, with its notes whole, and a click beside it puts it away', async () => {
    const notes = 'One.\nTwo.\nThree.\nFour.\nFive.';
    const { bridge, emit } = withBoard([card('a', 'Track the meter', 'todo', { notes })]);
    const { fixture, el } = await render(bridge);
    await openBoard(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-kanban-page dialog.large')!;
    expect(dialog.hasAttribute('open')).toBe(false);

    cardEl(el, 'Track the meter').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('.title')!.textContent).toBe('Track the meter');
    expect(dialog.querySelector('.notes')!.textContent).toBe(notes);

    emit('kanban.changed', { cards: [card('a', 'Track the meter', 'todo', { notes: 'Done.' })] });
    await fixture.whenStable();
    expect(dialog.querySelector('.notes')!.textContent).toBe('Done.');

    dialog.querySelector<HTMLElement>('.slip')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);

    dialog.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('.slip')).toBeNull();
  });
});
