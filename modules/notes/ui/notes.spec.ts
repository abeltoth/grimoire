import { TestBed } from '@angular/core/testing';
import type { Note } from '@grimoire/contract';
import { ChatList } from '@ui/app/core/chat-list';
import { render } from '@ui/testing/app-testing';
import { NoteList, splitNote } from './notes';
import { note, withNotes } from './notes-testing';

/** The notes on the app, kept by the fake service. */
async function withList(...notes: Note[]) {
  const fake = withNotes(notes);
  const rendered = await render(fake.bridge);
  const list = TestBed.inject(NoteList);
  await list.load();
  return { ...fake, ...rendered, list };
}

const chat = { chatId: 'chat-9', agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' };

describe('splitNote', () => {
  it('names a note by its first line, the rest under it', () => {
    expect(splitNote('  Buy ink \n\nRed and black\n')).toEqual({
      title: 'Buy ink',
      rest: 'Red and black',
    });
    expect(splitNote('Buy ink')).toEqual({ title: 'Buy ink', rest: '' });
  });
});

describe('NoteList', () => {
  it('lists those due first, soonest due first, then pinned ones, then the rest; done ones apart', async () => {
    const { list, emit } = await withList(
      note('a', 'A'),
      note('b', 'B', { pinned: true }),
      note('c', 'C', { due: true, remindAt: 20 }),
      note('d', 'D', { doneAt: 5 }),
      note('e', 'E', { due: true, remindAt: 10 }),
    );
    expect(list.open().map((n) => n.text)).toEqual(['E', 'C', 'B', 'A']);
    expect(list.due().map((n) => n.text)).toEqual(['E', 'C']);
    expect(list.done().map((n) => n.text)).toEqual(['D']);
    emit('notes.changed', { notes: [note('a', 'A')] });
    expect(list.due()).toEqual([]);
  });

  it('pins a note and sets or clears its reminder, keeping the rest of it', async () => {
    const { list, calls } = await withList(note('a', 'A', { remindAt: 50 }));
    await list.pin(list.open()[0]!, true);
    await list.remind(list.open()[0]!);
    await list.remind(list.open()[0]!, 70);
    expect(calls.filter((c) => c.command === 'notes.save').map((c) => c.request)).toEqual([
      { id: 'a', text: 'A', pinned: true, remindAt: 50 },
      { id: 'a', text: 'A', pinned: true },
      { id: 'a', text: 'A', pinned: true, remindAt: 70 },
    ]);
  });

  it('puts a note on the Kanban board in its chat’s folder, then marks it done', async () => {
    const { list, calls } = await withList(note('a', 'Meter\n\nFrom usage.', { madeIn: chat }));
    expect(await list.toKanban(list.open()[0]!)).toBe(true);
    expect(calls.find((c) => c.command === 'kanban.save')!.request).toEqual({
      title: 'Meter',
      notes: 'From usage.',
      cwd: 'C:/Users/me/git/breeder',
    });
    expect(list.done().map((n) => n.id)).toEqual(['a']);
  });

  it('keeps a note when the board turns it away, saying why', async () => {
    const { list, answers } = await withList(note('a', 'Meter'));
    answers['kanban.save'] = () => {
      throw new Error('A card needs a folder');
    };
    expect(await list.toKanban(list.open()[0]!)).toBe(false);
    expect(list.failed()).toBe('A card needs a folder');
    expect(list.done()).toEqual([]);
  });

  it('opens a new chat with the note written in, in its chat’s folder', async () => {
    const { list } = await withList(note('a', 'Look into the meter', { madeIn: chat }));
    list.newChat(list.open()[0]!);
    const current = TestBed.inject(ChatList).current()!;
    expect(current.settings.cwd).toBe('C:/Users/me/git/breeder');
    expect(current.status).toBe('blank');
  });
});
