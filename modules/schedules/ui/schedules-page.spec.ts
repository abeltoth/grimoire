import type { ScheduleInfo, ScheduleRun } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { clock, dateline, when } from './wording';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('schedules', () => {
  it("keeps scheduled chats as journal entries, and adds a run's chat to the book", async () => {
    // The next run is named from today, so the test fixes today.
    const now = new Date(2026, 10, 9, 15, 30).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { bridge, answers, emit } = fakeBridge();
    const tomorrow = new Date(now);
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
        dueAt: now,
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

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Scheduled chats')!
      .click();
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
  });
});
