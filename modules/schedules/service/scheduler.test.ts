import type { EventName, OpenChat, ScheduleDraft } from '@grimoire/contract';
import { beforeEach, describe, expect, it } from 'vitest';
import { setActiveProfile } from '@grimoire/service/core/app-state';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { type BeginChat, Scheduler, runTitle } from './scheduler';
import { ScheduleStore } from './store';

// Local times; 4 November 2026 is a Wednesday.
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 10, day, hours, minutes).getTime();

const draft: ScheduleDraft = {
  name: 'Morning repo summary',
  agent: 'claude-code',
  settings: { cwd: '/git/grimoire', model: 'opus' },
  prompt: 'Summarize what changed in this repository since yesterday.',
  days: [5, 1, 2, 3, 4, 1],
  time: '08:00',
  enabled: true,
};

let now: number;
let begun: Parameters<BeginChat>[];
let refuse: string | undefined;
let events: { event: EventName; payload: unknown }[];
let scheduler: Scheduler;
let db: ReturnType<typeof openDatabase>;

const chat = (id: string, cwd: string): OpenChat =>
  ({
    id,
    agent: 'claude-code',
    title: '',
    settings: { cwd },
    status: 'thinking',
    entries: [],
  }) as unknown as OpenChat;

beforeEach(() => {
  now = at(4, 7);
  begun = [];
  refuse = undefined;
  events = [];
  db = openDatabase(':memory:');
  migrate(db, 'schedules', MIGRATIONS);
  scheduler = new Scheduler(
    new ScheduleStore(db),
    async (...args) => {
      if (refuse) throw new Error(refuse);
      begun.push(args);
      return chat(`chat-${begun.length}`, args[1].cwd ?? '/home');
    },
    (event, payload) => events.push({ event, payload }),
    () => now,
  );
});

const save = (change: Partial<ScheduleDraft> = {}) => scheduler.save({ ...draft, ...change })[0]!;
const runs = () => scheduler.list()[0]!.runs.map(({ dueAt, outcome }) => [dueAt, outcome]);

describe('Scheduler', () => {
  it('saves a schedule, tidying its days, and tells when it runs next', () => {
    const schedule = save();
    expect(schedule).toMatchObject({
      name: 'Morning repo summary',
      days: [1, 2, 3, 4, 5],
      nextAt: at(4, 8),
      runs: [],
    });
    expect(events.map((e) => e.event)).toEqual(['schedules.changed']);
    expect(scheduler.save({ ...draft, id: schedule.id, enabled: false })[0]!.nextAt).toBeNull();
  });

  it('begins a new chat with Full access when one is due, and only once', async () => {
    const { id } = save();
    await scheduler.check();
    expect(begun).toEqual([]);

    now = at(4, 8, 0) + 10_000;
    await scheduler.check();
    await scheduler.check();
    expect(begun).toEqual([
      [
        'claude-code',
        { cwd: '/git/grimoire', model: 'opus', mode: 'allow-all' },
        draft.prompt,
        runTitle('Morning repo summary', at(4, 8)),
      ],
    ]);
    const run = {
      scheduleId: id,
      dueAt: at(4, 8),
      outcome: 'began',
      ranAt: now,
      chatId: 'chat-1',
      cwd: '/git/grimoire',
    };
    expect(scheduler.list()[0]!.runs).toEqual([run]);
    expect(events.find((e) => e.event === 'schedules.began')?.payload).toEqual({
      run,
      chat: chat('chat-1', '/git/grimoire'),
    });
    expect(scheduler.list()[0]!.nextAt).toBe(at(5, 8));
  });

  it('catches up once on a time it was away for, and counts the earlier ones missed', async () => {
    now = at(6, 7);
    save();
    // Away from Friday morning until Tuesday at half past nine.
    now = at(10, 9, 30);
    await scheduler.check();
    expect(begun).toHaveLength(1);
    expect(runs()).toEqual([
      [at(10, 8), 'began'],
      [at(9, 8), 'missed'],
      [at(6, 8), 'missed'],
    ]);
  });

  it('counts a time missed when it is back more than three hours late', async () => {
    save();
    now = at(4, 11, 1);
    await scheduler.check();
    expect(begun).toEqual([]);
    expect(runs()).toEqual([[at(4, 8), 'missed']]);
  });

  it("doesn't run while paused, nor catch up on the paused time when it's resumed", async () => {
    const { id } = save({ enabled: false });
    now = at(4, 9);
    await scheduler.check();
    scheduler.save({ ...draft, id, enabled: true });
    await scheduler.check();
    expect(begun).toEqual([]);
    expect(runs()).toEqual([]);
  });

  it("records a run that couldn't begin, and doesn't try it again", async () => {
    save();
    refuse = 'Claude Code is not signed in';
    now = at(4, 8, 1);
    await scheduler.check();
    await scheduler.check();
    expect(scheduler.list()[0]!.runs).toEqual([
      expect.objectContaining({ outcome: 'failed', error: 'Claude Code is not signed in' }),
    ]);
  });

  it('runs a schedule now, whatever its days', async () => {
    const { id } = save({ days: [] });
    now = at(4, 13);
    await expect(scheduler.run(id)).resolves.toMatchObject({
      outcome: 'began',
      dueAt: now,
      chatId: 'chat-1',
    });
    expect(begun[0]![3]).toBe(runTitle('Morning repo summary', now));
    await expect(scheduler.run('nope')).rejects.toThrow('There is no such schedule');
  });

  it('skips a time due in a profile not in use, and doesn’t run it when that profile is back', async () => {
    const { id } = save();
    setActiveProfile(db, 'work');
    expect(scheduler.list()).toEqual([]);
    now = at(4, 8, 1);
    await scheduler.check();
    expect(begun).toEqual([]);

    setActiveProfile(db, 'personal');
    await scheduler.check();
    expect(begun).toEqual([]);
    expect(scheduler.list()[0]!.runs).toEqual([
      { scheduleId: id, dueAt: at(4, 8), outcome: 'skipped' },
    ]);

    // Away too long, the earlier times are missed as ever; the last is skipped.
    setActiveProfile(db, 'work');
    now = at(6, 8, 1);
    await scheduler.check();
    setActiveProfile(db, 'personal');
    expect(runs()).toEqual([
      [at(6, 8), 'skipped'],
      [at(5, 8), 'missed'],
      [at(4, 8), 'skipped'],
    ]);
  });

  it('begins only the time due in the profile in use', async () => {
    save({ name: 'Personal' });
    setActiveProfile(db, 'work');
    save({ name: 'Work' });
    now = at(4, 8, 1);
    await scheduler.check();
    expect(begun.map(([, , , title]) => title)).toEqual([runTitle('Work', at(4, 8))]);
    setActiveProfile(db, 'personal');
    expect(runs()).toEqual([[at(4, 8), 'skipped']]);
  });
});
