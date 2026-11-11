import type { ScheduleInfo } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-testing';

/** The app on the schedules page from a chat, the service keeping `schedules`. */
async function onSchedules(schedules: ScheduleInfo[] = []) {
  const fake = fakeBridge();
  fake.answers['schedules.list'] = () => schedules;
  fake.answers['schedules.save'] = () => schedules;
  const rendered = await render(fake.bridge);
  await write(rendered.fixture, rendered.el, 'Hello');
  [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
    .find((tab) => tab.textContent!.trim() === 'Scheduled chats')!
    .click();
  await rendered.fixture.whenStable();
  return { ...fake, ...rendered };
}

describe('ScheduleForm', () => {
  it('writes a new schedule out in place, in the folder of the chat you’re on, and saves it', async () => {
    const { fixture, el, texts, calls } = await onSchedules();
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
      settings: { cwd: 'C:/work/grimoire', model: 'sonnet', effort: 'low' },
      prompt: 'Check for outdated dependencies.',
      days: [1],
      time: '09:00',
      enabled: true,
    });
    expect(el.querySelector('gr-schedule-form')).toBeNull();
  });
});
