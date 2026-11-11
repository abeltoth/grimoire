import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { render } from '@ui/testing/app-testing';
import { button, note, noteEl, openNotes, withNotes } from './notes-testing';

const chat = { chatId: 'chat-9', agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' };

describe('notes-page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 15, 20));
  });
  afterEach(() => vi.useRealTimers());

  it('shows due notes first, edged and dated in rubric, then pinned ones, then the rest', async () => {
    const { bridge } = withNotes([
      note('a', 'Buy ink'),
      note('b', 'Call the binder', { pinned: true, remindAt: new Date(2026, 10, 12, 9).getTime() }),
      note('c', 'Check the PR', { due: true, remindAt: new Date(2026, 10, 11, 14).getTime() }),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);
    expect(texts('gr-tab-page .title')).toEqual(['Marginalia']);
    expect(texts('gr-notes-page .note[data-note] .text')).toEqual([
      'Check the PR',
      'Call the binder',
      'Buy ink',
    ]);
    expect(noteEl(el, 'c').classList).toContain('due');
    expect(noteEl(el, 'b').classList).toContain('pinned');
    expect(noteEl(el, 'c').querySelector('.when')!.textContent).toMatch(/^Due today at /);
    expect(noteEl(el, 'c').querySelector('.when.alert')).not.toBeNull();
    expect(noteEl(el, 'b').querySelector('.when')!.textContent).toMatch(
      /^Reminds you tomorrow at /,
    );
    expect(noteEl(el, 'a').querySelector('.meta')).toBeNull();
  });

  it('snoozes a due note an hour, or till tomorrow morning', async () => {
    const { bridge, calls } = withNotes([note('c', 'Check the PR', { due: true, remindAt: 1 })]);
    const { fixture, el } = await render(bridge);
    await openNotes(fixture, el);
    button(noteEl(el, 'c'), 'An hour').click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'notes.save')!.request).toEqual({
      id: 'c',
      text: 'Check the PR',
      pinned: false,
      remindAt: new Date(2026, 10, 11, 16, 20).getTime(),
    });
    expect(el.querySelector('gr-notes-page .due')).toBeNull();
  });

  it('pins, marks done and reopens, and deletes a note', async () => {
    const { bridge } = withNotes([note('a', 'Buy ink'), note('b', 'Old idea')]);
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);
    button(noteEl(el, 'a'), 'Pin').click();
    await fixture.whenStable();
    expect(button(noteEl(el, 'a'), 'Unpin')).toBeDefined();

    button(noteEl(el, 'b'), 'Done').click();
    await fixture.whenStable();
    expect(texts('gr-notes-page .note[data-note] .text')).toEqual(['Buy ink']);
    button(el.querySelector('gr-notes-page .finished')!, 'Show the done note').click();
    await fixture.whenStable();
    expect(texts('.finished .done-text')).toEqual(['Old idea']);
    button(el.querySelector('.finished')!, 'Reopen').click();
    await fixture.whenStable();
    expect(texts('gr-notes-page .note[data-note] .text')).toEqual(['Buy ink', 'Old idea']);

    button(noteEl(el, 'b'), 'Delete').click();
    await fixture.whenStable();
    expect(texts('gr-notes-page .note[data-note] .text')).toEqual(['Buy ink']);
  });

  it('opens a note’s chat, begins a new one from it, and sends it to Kanban', async () => {
    const { bridge, calls } = withNotes([note('a', 'Look into the meter', { madeIn: chat })]);
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);
    expect(texts('[data-note="a"] .meta button')).toEqual(['From a chapter']);
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('[data-note="a"] .meta button')).toEqual(['From a chat']);

    button(noteEl(el, 'a'), 'New chat').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-message')!.value).toBe(
      'Look into the meter',
    );

    button(noteEl(el, 'a'), 'To Kanban').click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'kanban.save')!.request).toEqual({
      title: 'Look into the meter',
      notes: '',
      cwd: 'C:/Users/me/git/breeder',
    });
    expect(el.querySelector('[data-note="a"]')).toBeNull();
  });

  it('says why a change was turned away', async () => {
    const { bridge, answers } = withNotes([note('a', 'Buy ink')]);
    answers['notes.done'] = () => {
      throw new Error('There is no such note');
    };
    const { fixture, el, texts } = await render(bridge);
    await openNotes(fixture, el);
    button(noteEl(el, 'a'), 'Done').click();
    await fixture.whenStable();
    expect(texts('gr-notes-page .error')).toEqual(['There is no such note']);
  });
});
