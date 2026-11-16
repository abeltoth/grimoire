import { fakeDialogs, render } from '@ui/testing/app-testing';
import { button, field, note, noteEl, openNotes, withNotes } from './notes-testing';

describe('note-large', () => {
  fakeDialogs();

  it('opens a note large on a click, written out to change, and saves it', async () => {
    const { bridge, calls } = withNotes([note('a', 'Buy ink'), note('b', 'Call the binder')]);
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-notes-page dialog.large')!;
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('gr-note-form')).toBeNull();

    noteEl(el, 'a').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector<HTMLTextAreaElement>('gr-note-form .text')!.value).toBe('Buy ink');
    expect(texts('gr-notes-page dialog .tools button')).toEqual([
      'Done',
      'Pin',
      'New chapter',
      'To Kanban',
      'Delete',
    ]);

    field(dialog, 'gr-note-form .text', 'Buy ink\nand a new nib');
    dialog.querySelector<HTMLButtonElement>('gr-note-form .send')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'notes.save').at(-1)!.request).toEqual({
      id: 'a',
      text: 'Buy ink\nand a new nib',
      pinned: false,
    });
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('gr-note-form')).toBeNull();
  });

  it('keeps a note large while it’s pinned, and puts it away once it’s done', async () => {
    const { bridge } = withNotes([note('a', 'Buy ink')]);
    const { fixture, el } = await render(bridge);
    await openNotes(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-notes-page dialog.large')!;
    noteEl(el, 'a').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();

    button(dialog, 'Pin').click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(button(dialog, 'Unpin')).toBeDefined();

    button(dialog, 'Done').click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('puts a note away on a click beside it, but not on one in it', async () => {
    const { bridge, calls } = withNotes([note('a', 'Buy ink')]);
    const { fixture, el } = await render(bridge);
    await openNotes(fixture, el);
    const dialog = el.querySelector<HTMLDialogElement>('gr-notes-page dialog.large')!;
    noteEl(el, 'a').querySelector<HTMLButtonElement>('.open')!.click();
    await fixture.whenStable();

    dialog.querySelector<HTMLElement>('.slip')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    dialog.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(calls.some((c) => c.command === 'notes.save')).toBe(false);
  });
});
