import type { ScheduleInfo } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { upcoming } from './wording';

const schedule = (id: string, name: string, nextAt: number | null): ScheduleInfo => ({
  id,
  name,
  agent: 'claude-code',
  settings: { cwd: 'C:/Users/me/git/grimoire' },
  prompt: 'Summarize what changed.',
  days: [1, 2, 3, 4, 5],
  time: '08:00',
  enabled: nextAt !== null,
  nextAt,
  runs: [],
});

describe('schedules.providers', () => {
  it('names the next run in the footer, which turns to the schedules', async () => {
    // The next run is named from today, so the test fixes today.
    const now = new Date(2026, 10, 9, 15, 30).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const tomorrow = new Date(2026, 10, 10, 8, 0).getTime();
    const { bridge, answers } = fakeBridge();
    answers['schedules.list'] = () => [
      schedule('s1', 'Weekly review', new Date(2026, 10, 13, 8, 0).getTime()),
      schedule('s2', 'Morning repo summary', tomorrow),
      schedule('s3', 'Paused', null),
    ];
    const { fixture, el, texts } = await render(bridge);

    const indicator = `Morning repo summary ${upcoming(tomorrow, now)}`;
    expect(indicator).toMatch(/^Morning repo summary tomorrow at /);
    expect(texts('gr-status-indicators button')).toEqual([indicator]);
    const button = el.querySelector<HTMLButtonElement>('gr-status-indicators button')!;
    expect(button.getAttribute('title')).toMatch(/^The next scheduled chat: Tuesday/);
    button.click();
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Scheduled chats']);
  });

  it('names nothing when no schedule runs', async () => {
    const { bridge, answers } = fakeBridge();
    answers['schedules.list'] = () => [schedule('s3', 'Paused', null)];
    const { el } = await render(bridge);
    expect(el.querySelector('gr-status-indicators button')).toBeNull();
  });
});
