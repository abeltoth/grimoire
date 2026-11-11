import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { render, write } from '@ui/testing/app-testing';
import { note, withNotes } from './notes-testing';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/grimoire' };

describe('notes.providers', () => {
  it('counts the reminders due in the page footer, which turns to the notes', async () => {
    const { bridge, emit } = withNotes([note('a', 'Check the PR\nThe meter one', { due: true })]);
    const { fixture, el } = await render(bridge);
    const indicator = () =>
      TestBed.inject(ShellRegistry)
        .indicators.all()
        .find((i) => i.id === 'notes.due');
    expect(indicator()).toMatchObject({
      label: '1 reminder due',
      tone: 'alert',
      detail: 'Check the PR',
    });

    emit('notes.changed', {
      notes: [note('a', 'A', { due: true }), note('b', 'B', { due: true }), note('c', 'C')],
    });
    TestBed.tick();
    expect(indicator()!.label).toBe('2 reminders due');
    indicator()!.open!();
    await fixture.whenStable();
    expect(el.querySelector('gr-notes-page')).not.toBeNull();

    emit('notes.changed', { notes: [note('a', 'A', { due: true, doneAt: 1 })] });
    TestBed.tick();
    expect(indicator()).toBeUndefined();
  });

  it('writes a new note from anywhere with New note', async () => {
    const { bridge } = withNotes();
    const { fixture, el } = await render(bridge);
    const command = TestBed.inject(ShellRegistry)
      .commands.all()
      .find((c) => c.id === 'notes.new')!;
    expect(command.shortcut).toBe('Mod+Shift+N');
    command.run!();
    await fixture.whenStable();
    expect(el.querySelector('gr-notes-page gr-note-form')).not.toBeNull();
  });

  it('gives a chat whose agent made notes a badge for them, which turns to the notes', async () => {
    const { bridge, emit } = withNotes();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Remind me to check the PR');
    expect(texts('gr-header-badges button')).toEqual([]);

    emit('notes.changed', { notes: [note('a', 'Check the PR', { madeIn: chat })] });
    await fixture.whenStable();
    expect(texts('gr-header-badges button')).toEqual(['1 note']);
    const badge = el.querySelector<HTMLButtonElement>('gr-header-badges button')!;
    expect(badge.getAttribute('title')).toBe('Notes made in this chapter: Check the PR');
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(badge.getAttribute('title')).toBe('Notes made in this chat: Check the PR');
    badge.click();
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Notes']);
  });
});
