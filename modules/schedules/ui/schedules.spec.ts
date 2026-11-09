import type { ScheduleInfo, ScheduleRun } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { clock, dateline, upcoming, when } from './wording';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('schedules', () => {
  it("keeps scheduled chats as journal entries, names the next run, and adds a run's chat to the book", async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextAt = tomorrow.setHours(8, 0, 0, 0);
    const dueAt = new Date(nextAt - 24 * 60 * 60_000).getTime();
    const schedule: ScheduleInfo = {
      id: 's1',
      name: 'Morning repo summary',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me/git/grimoire', model: 'opus' },
      prompt: 'Summarize what changed since yesterday.',
      days: [1, 2, 3, 4, 5],
      time: '08:00',
      enabled: true,
      nextAt,
      runs: [
        { scheduleId: 's1', dueAt, outcome: 'skipped' },
        { scheduleId: 's1', dueAt: dueAt - 24 * 60 * 60_000, outcome: 'missed' },
      ],
    };
    answers['schedules.list'] = () => [schedule];
    answers['schedules.save'] = () => [schedule];
    answers['schedules.run'] = (): ScheduleRun => {
      const run: ScheduleRun = {
        scheduleId: 's1',
        dueAt: Date.now(),
        outcome: 'began',
        chatId: 'run-1',
        cwd: 'C:/Users/me/git/grimoire',
      };
      emit('schedules.began', {
        run,
        chat: {
          id: 'run-1',
          agent: 'claude-code',
          title: 'Morning repo summary · today',
          settings: { cwd: 'C:/Users/me/git/grimoire', mode: 'allow-all' },
          status: 'thinking',
          entries: [{ kind: 'user', id: 'u1', text: schedule.prompt }],
          approvals: [],
          queued: [],
          plan: [],
          withdrawn: [],
          copied: [],
        },
      });
      return run;
    };
    const { fixture, el, texts } = await render(bridge);

    const indicator = `Morning repo summary ${upcoming(nextAt, Date.now())}`;
    expect(indicator).toMatch(/^Morning repo summary tomorrow at /);
    expect(texts('gr-status-indicators button')).toEqual([indicator]);
    el.querySelector<HTMLButtonElement>('gr-status-indicators button')!.click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Scheduled chats']);
    expect(texts('gr-schedules-page .dateline')).toEqual([dateline(nextAt)]);
    expect(texts('gr-schedules-page h2')).toEqual(['Morning repo summary']);
    expect(texts('gr-schedules-page .sub')).toEqual([
      `Weekdays at ${clock('08:00')} · Claude Code · Opus 5.5, extra high effort · ~/git/grimoire`,
    ]);
    expect(texts('gr-schedules-page .runs li')).toEqual([
      `${when(dueAt)} Skipped: another volume was open`,
      `${when(dueAt - 24 * 60 * 60_000)} Missed: the service wasn’t running in time`,
    ]);
    emit('settings.changed', { settings: { ...DEFAULT_SETTINGS, wording: 'plain' } });
    await fixture.whenStable();
    expect(texts('gr-schedules-page .runs li')[0]).toBe(
      `${when(dueAt)} Skipped: another profile was in use`,
    );
    emit('settings.changed', { settings: DEFAULT_SETTINGS });
    await fixture.whenStable();

    // Run now begins its chat, which joins the book and is turned to.
    [...el.querySelectorAll<HTMLButtonElement>('gr-schedules-page .actions button')]
      .find((b) => b.textContent!.includes('Run now'))!
      .click();
    await fixture.whenStable();
    expect(texts('.spine gr-chat-tab b')).toContain('Morning repo summary · today');
    expect(texts('gr-page-header h1')).toEqual(['Morning repo summary · today']);
    expect(texts('.meta button')).toContain('Full access');

    // A new schedule is written out in place.
    el.querySelector<HTMLButtonElement>('gr-schedules-page .add')!.click();
    await fixture.whenStable();
    const field = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    field('gr-schedule-name', 'Dependency check');
    field('gr-schedule-prompt', 'Check for outdated dependencies.');
    field('gr-schedule-time', '09:00');
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-schedule-form .word')].find(
        (b) => b.textContent!.trim() === text,
      )!;
    for (const day of ['Tue', 'Wed', 'Thu', 'Fri']) word(day).click();
    word('Sonnet 5.5').click();
    await fixture.whenStable();
    word('Low').click();
    await fixture.whenStable();
    expect(texts('gr-schedule-form .note')).toEqual([
      'Each run begins a new chapter with Full access: it edits files and runs commands without asking, as no one is there to approve.',
    ]);
    el.querySelector<HTMLButtonElement>('gr-schedule-form .send')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'schedules.save')!.request).toEqual({
      name: 'Dependency check',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me/git/grimoire', model: 'sonnet', effort: 'low' },
      prompt: 'Check for outdated dependencies.',
      days: [1],
      time: '09:00',
      enabled: true,
    });
    expect(el.querySelector('gr-schedule-form')).toBeNull();
  });
});
