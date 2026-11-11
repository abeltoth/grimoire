import type { ScheduleDraft } from '@grimoire/contract';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { ScheduleStore } from './store';

const draft: ScheduleDraft = {
  name: ' Morning repo summary ',
  agent: 'claude-code',
  settings: { cwd: '/git/grimoire', model: 'opus' },
  prompt: ' Summarize what changed. ',
  days: [5, 1, 2, 9, 3, 4, 1, 1.5],
  time: '08:00',
  enabled: true,
};

let db: ReturnType<typeof openDatabase>;
let profile: string;
let store: ScheduleStore;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, 'schedules', MIGRATIONS);
  profile = 'personal';
  store = new ScheduleStore(db, () => profile);
});

describe('ScheduleStore', () => {
  it('saves a schedule tidied, with its days once each and in order, and changes it in place', () => {
    const saved = store.save(draft, 1_000);
    expect(saved).toEqual({
      ...draft,
      id: expect.any(String),
      name: 'Morning repo summary',
      prompt: 'Summarize what changed.',
      days: [1, 2, 3, 4, 5],
    });
    expect(store.get(saved.id)).toEqual(saved);
    expect(store.handledUntil(saved.id)).toBe(1_000);

    store.save({ ...draft, name: 'Evening', id: saved.id, enabled: false }, 2_000);
    expect(store.list()).toEqual([
      { ...saved, name: 'Evening', enabled: false, days: [1, 2, 3, 4, 5] },
    ]);
    expect(store.handledUntil(saved.id)).toBe(2_000);
  });

  it('turns away a schedule without a name, a message or a time', () => {
    expect(() => store.save({ ...draft, name: ' ' }, 0)).toThrow('A schedule needs a name');
    expect(() => store.save({ ...draft, prompt: '' }, 0)).toThrow(
      'A schedule needs a first message',
    );
    expect(() => store.save({ ...draft, time: '8:00' }, 0)).toThrow(
      '"8:00" isn\'t a time such as 08:00',
    );
    expect(store.all()).toEqual([]);
  });

  it('lists the schedules of the profile in use, in the order made', () => {
    const first = store.save({ ...draft, name: 'First' }, 0);
    profile = 'work';
    const work = store.save({ ...draft, name: 'Work' }, 0);
    profile = 'personal';
    const second = store.save({ ...draft, name: 'Second' }, 0);
    expect(store.list().map(({ name }) => name)).toEqual(['First', 'Second']);
    expect(store.all().map(({ name }) => name)).toEqual(['First', 'Work', 'Second']);
    expect([store.inUse(first.id), store.inUse(work.id), store.inUse(second.id)]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('keeps the runs, newest first, with what each knows', () => {
    const { id } = store.save(draft, 0);
    store.addRun({ scheduleId: id, dueAt: 1, outcome: 'missed' });
    store.addRun({ scheduleId: id, dueAt: 3, outcome: 'failed', ranAt: 4, error: 'No agent' });
    store.addRun({ scheduleId: id, dueAt: 2, outcome: 'began', ranAt: 2, chatId: 'c', cwd: '/w' });
    expect(store.runs(id, 2)).toEqual([
      { scheduleId: id, dueAt: 3, outcome: 'failed', ranAt: 4, error: 'No agent' },
      { scheduleId: id, dueAt: 2, outcome: 'began', ranAt: 2, chatId: 'c', cwd: '/w' },
    ]);
    store.setHandledUntil(id, 3);
    expect(store.handledUntil(id)).toBe(3);
    expect(store.handledUntil('nope')).toBe(0);
  });

  it('removes a schedule with the record of its runs', () => {
    const { id } = store.save(draft, 0);
    store.addRun({ scheduleId: id, dueAt: 1, outcome: 'missed' });
    store.remove(id);
    expect(store.get(id)).toBeUndefined();
    expect(store.runs(id, 10)).toEqual([]);
  });

  it("deletes a profile's schedules and their runs, and no other's", () => {
    const { id } = store.save(draft, 0);
    store.addRun({ scheduleId: id, dueAt: 1, outcome: 'missed' });
    profile = 'work';
    store.save({ ...draft, name: 'Work' }, 0);
    store.removeProfile('personal');
    expect(store.all().map(({ name }) => name)).toEqual(['Work']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schedule_runs').get()).toEqual({ n: 0 });
  });
});
