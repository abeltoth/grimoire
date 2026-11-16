import { render } from '@ui/testing/app-testing';
import { note, noteEl, openNotes, withNotes } from './notes-testing';

describe('note-large', () => {
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

  it('opens a note large on a click, and a click beside it puts it away', async () => {
    const text = 'Buy ink\nand a new nib';
    const { bridge, emit } = withNotes([note('a', text)]);
    const { fixture, el } = await render(bridge);
    await openNotes(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-notes-page dialog.large')!;
    expect(dialog.hasAttribute('open')).toBe(false);

    noteEl(el, 'a').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('.full')!.textContent).toBe(text);

    emit('notes.changed', { notes: [note('a', 'Buy ink')] });
    await fixture.whenStable();
    expect(dialog.querySelector('.full')!.textContent).toBe('Buy ink');

    dialog.querySelector<HTMLElement>('.slip')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);

    dialog.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('.slip')).toBeNull();
  });
});
