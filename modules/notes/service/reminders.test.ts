import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { Reminders } from './reminders';
import { NoteStore } from './store';

let now: number;
let store: NoteStore;
let emit: Mock;
let reminders: Reminders;

beforeEach(() => {
  now = 1_000;
  const db = openDatabase(':memory:');
  migrate(db, 'notes', MIGRATIONS);
  store = new NoteStore(
    db,
    () => 'personal',
    () => now,
  );
  emit = vi.fn();
  reminders = new Reminders(store, emit);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Reminders', () => {
  it('tells every window of the notes when a reminder comes due, once', () => {
    reminders.changed(store.save({ text: 'A', pinned: false, remindAt: 5_000 }));
    emit.mockClear();
    reminders.check();
    expect(emit).not.toHaveBeenCalled();
    now = 5_000;
    reminders.check();
    reminders.check();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('notes.changed', { notes: store.list() });
  });

  it('tells of a reminder whose time passed while the service was away, as soon as it’s back', () => {
    store.save({ text: 'A', pinned: false, remindAt: 500 });
    reminders.check();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1].notes[0].due).toBe(true);
  });

  it('checks every so often, until stopped', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    store.save({ text: 'A', pinned: false, remindAt: 5_000 });
    const stop = reminders.checkEvery(30_000);
    expect(emit).not.toHaveBeenCalled();
    now = 5_000;
    vi.advanceTimersByTime(30_000);
    expect(emit).toHaveBeenCalledTimes(1);
    stop();
    store.save({ text: 'B', pinned: false, remindAt: 6_000 });
    now = 6_000;
    vi.advanceTimersByTime(60_000);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
