import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { NoteStore } from './store';

let now: number;
let profile: string;
let notes: NoteStore;

beforeEach(() => {
  now = 1_000;
  profile = 'personal';
  const db = openDatabase(':memory:');
  migrate(db, 'notes', MIGRATIONS);
  notes = new NoteStore(
    db,
    () => profile,
    () => now,
  );
});

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };

describe('notes', () => {
  it('saves a note tidied, newest first, and changes it in its place', () => {
    const [first] = notes.save({ text: ' Buy ink \n', pinned: false });
    expect(first).toEqual({
      id: first!.id,
      text: 'Buy ink',
      createdAt: 1_000,
      pinned: false,
      due: false,
    });
    now = 2_000;
    notes.save({ text: 'Call the binder', pinned: true, remindAt: 5_000 }, chat);
    expect(notes.list().map((note) => note.text)).toEqual(['Call the binder', 'Buy ink']);
    expect(notes.list()[0]).toMatchObject({ pinned: true, remindAt: 5_000, madeIn: chat });

    notes.save({ id: first!.id, text: 'Buy red ink', pinned: true, remindAt: 3_000 });
    expect(notes.list()[1]).toMatchObject({ text: 'Buy red ink', pinned: true, remindAt: 3_000 });
    notes.save({ id: first!.id, text: 'Buy red ink', pinned: false });
    expect(notes.list()[1]!.remindAt).toBeUndefined();
  });

  it('turns away a note without text, or a reminder that isn’t a time', () => {
    expect(() => notes.save({ text: '  ', pinned: false })).toThrow('A note needs some text');
    expect(() => notes.save({ text: 'A', pinned: false, remindAt: Number.NaN })).toThrow(
      'That reminder time isn’t a time',
    );
    expect(notes.list()).toEqual([]);
  });

  it('is due once its reminder’s time has come, until it’s done', () => {
    const [note] = notes.save({ text: 'A', pinned: false, remindAt: 5_000 });
    expect(note!.due).toBe(false);
    now = 5_000;
    expect(notes.list()[0]!.due).toBe(true);
    now = 6_000;
    expect(notes.done(note!.id, true)[0]).toMatchObject({ due: false, doneAt: 6_000 });
    expect(notes.done(note!.id, false)[0]).toMatchObject({ due: true });
    expect(notes.list()[0]!.doneAt).toBeUndefined();
  });

  it('removes a note, and only the profile in use’s', () => {
    const [mine] = notes.save({ text: 'Mine', pinned: false });
    profile = 'work';
    expect(notes.list()).toEqual([]);
    expect(() => notes.remove(mine!.id)).toThrow('There is no such note');
    expect(() => notes.done(mine!.id, true)).toThrow('There is no such note');
    notes.save({ text: 'Work', pinned: false });
    profile = 'personal';
    expect(notes.remove(mine!.id)).toEqual([]);
  });

  it('deletes a removed profile’s notes', () => {
    notes.save({ text: 'Mine', pinned: false });
    profile = 'work';
    notes.save({ text: 'Work', pinned: false });
    notes.removeProfile('work');
    expect(notes.list()).toEqual([]);
    profile = 'personal';
    expect(notes.list()).toHaveLength(1);
  });
});
