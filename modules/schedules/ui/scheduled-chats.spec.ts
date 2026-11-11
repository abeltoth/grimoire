import { TestBed } from '@angular/core/testing';
import type { ScheduleInfo, ScheduleRun } from '@grimoire/contract';
import { ChatList } from '@ui/app/core/chat-list';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { ScheduledChats } from './scheduled-chats';

const schedule = (id: string, nextAt: number | null): ScheduleInfo => ({
  id,
  name: id,
  agent: 'claude-code',
  settings: { cwd: 'C:/w' },
  prompt: 'Go',
  days: [1],
  time: '08:00',
  enabled: true,
  nextAt,
  runs: [],
});

async function withSchedules() {
  const fake = fakeBridge();
  fake.answers['schedules.list'] = () => [schedule('later', 2_000), schedule('sooner', 1_000)];
  const rendered = await render(fake.bridge);
  return { ...fake, ...rendered, scheduled: TestBed.inject(ScheduledChats) };
}

describe('ScheduledChats', () => {
  it('mirrors the service’s schedules, and knows the one that runs next', async () => {
    const { scheduled, emit } = await withSchedules();
    expect(scheduled.next()?.id).toBe('sooner');
    emit('schedules.changed', { schedules: [schedule('paused', null)] });
    expect(scheduled.next()).toBeUndefined();
  });

  it('says why a run couldn’t begin, or why a change was turned away', async () => {
    const { scheduled, answers } = await withSchedules();
    const failed: ScheduleRun = {
      scheduleId: 'sooner',
      dueAt: 1,
      outcome: 'failed',
      error: 'Claude Code is not signed in',
    };
    answers['schedules.run'] = () => failed;
    expect(await scheduled.run('sooner')).toEqual(failed);
    expect(scheduled.failed()).toBe('Claude Code is not signed in');

    answers['schedules.remove'] = () => {
      throw new Error('There is no such schedule');
    };
    expect(await scheduled.remove('nope')).toBe(false);
    expect(scheduled.failed()).toBe('There is no such schedule');
  });

  it('opens a closed run’s chat again, and does nothing for a run without one', async () => {
    const { scheduled, calls } = await withSchedules();
    const openChat = vi.spyOn(TestBed.inject(ChatList), 'openChat').mockResolvedValue();
    const of = schedule('sooner', 1_000);
    await scheduled.openRun(of, { scheduleId: 'sooner', dueAt: 1, outcome: 'missed' });
    expect(openChat).not.toHaveBeenCalled();
    await scheduled.openRun(of, {
      scheduleId: 'sooner',
      dueAt: 1,
      ranAt: 5,
      outcome: 'began',
      chatId: 'run-1',
      cwd: 'C:/w',
    });
    expect(openChat).toHaveBeenCalledWith({
      id: 'run-1',
      agent: 'claude-code',
      title: '',
      cwd: 'C:/w',
      updatedAt: 5,
    });
    expect(calls.some((c) => c.command === 'schedules.run')).toBe(false);
  });
});
