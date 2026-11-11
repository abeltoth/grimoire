import { render } from '@ui/testing/app-testing';
import { button, field, note, noteEl, openNotes, withNotes } from './notes-testing';

describe('note-form', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 15, 20));
  });
  afterEach(() => vi.useRealTimers());

  it('writes a new note with a reminder for tomorrow morning, and changes it in place', async () => {
    const { bridge, calls } = withNotes([note('a', 'Buy ink')]);
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);

    el.querySelector<HTMLButtonElement>('gr-notes-page .add')!.click();
    await fixture.whenStable();
    expect(document.activeElement!.classList).toContain('text');
    field(el, 'gr-note-form .text', 'Call the binder');
    button(el.querySelector('gr-note-form')!, 'Tomorrow morning').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('gr-note-form .when')!.value).toBe(
      '2026-11-12T09:00',
    );
    el.querySelector<HTMLButtonElement>('gr-note-form .send')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'notes.save')!.request).toEqual({
      text: 'Call the binder',
      pinned: false,
      remindAt: new Date(2026, 10, 12, 9).getTime(),
    });
    expect(el.querySelector('gr-note-form')).toBeNull();
    expect(texts('gr-notes-page .note[data-note] .text')).toEqual(['Call the binder', 'Buy ink']);

    button(noteEl(el, 'note-2'), 'Change').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('gr-note-form .text')!.value).toBe(
      'Call the binder',
    );
    button(el.querySelector('gr-note-form')!, 'No reminder').click();
    field(el, 'gr-note-form .text', 'Call the binder about the spine');
    el.querySelector<HTMLButtonElement>('gr-note-form .send')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'notes.save').at(-1)!.request).toEqual({
      id: 'note-2',
      text: 'Call the binder about the spine',
      pinned: false,
    });
  });

  it('saves with Ctrl+Enter, sets a reminder in an hour, and puts the note away with Escape', async () => {
    const { bridge, calls } = withNotes();
    const { fixture, el } = await render(bridge);
    await openNotes(fixture, el);
    el.querySelector<HTMLButtonElement>('gr-notes-page .add')!.click();
    await fixture.whenStable();
    const text = el.querySelector<HTMLTextAreaElement>('gr-note-form .text')!;
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    await fixture.whenStable();
    expect(calls.some((c) => c.command === 'notes.save')).toBe(false);

    field(el, 'gr-note-form .text', 'Buy ink');
    button(el.querySelector('gr-note-form')!, 'In an hour').click();
    await fixture.whenStable();
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'notes.save')!.request).toEqual({
      text: 'Buy ink',
      pinned: false,
      remindAt: new Date(2026, 10, 11, 16, 20).getTime(),
    });

    el.querySelector<HTMLButtonElement>('gr-notes-page .add')!.click();
    await fixture.whenStable();
    el.querySelector('gr-note-form form')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-note-form')).toBeNull();
  });
});
