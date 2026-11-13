import type { AgentCommand, CommandRequest } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

const command = (name: string): AgentCommand => ({ name, description: '', kind: 'command' });

describe('optimize-settings', () => {
  it('tells what each check the agent offers does, and runs one in a new chat', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['agents.commands'] = () => [command('doctor'), command('fewer-permission-prompts')];
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');

    expect(texts('gr-optimize-settings li .name')).toEqual([
      'Full checkup changes files',
      'Clean up instructions',
      'Fewer approvals changes files',
    ]);
    expect(
      [...el.querySelectorAll<HTMLElement>('gr-optimize-settings .mark')].map((m) => m.title),
    ).toEqual([
      'Can fix what it finds in your setup files.',
      'Edits .claude/settings.json in this folder.',
    ]);
    const run = el.querySelector<HTMLButtonElement>(
      'gr-optimize-settings [data-check="prompt-audit"] .run',
    )!;
    expect(run.title).toBe('Sends /doctor prompt-audit');

    run.click();
    await fixture.whenStable();
    const start = calls.find((c) => c.command === 'agents.start')?.request as
      CommandRequest<'agents.start'> | undefined;
    expect(start).toMatchObject({ agent: 'claude-code', text: '/doctor prompt-audit' });
  });

  it('says why the checks couldn’t be listed for another folder', async () => {
    const { bridge, answers } = fakeBridge({ chooseFolder: async () => 'D:/elsewhere' });
    answers['agents.commands'] = () => [command('compact'), command('doctor')];
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    expect(texts('gr-optimize-settings h2')).toEqual(['Tune-up']);

    answers['agents.commands'] = () => {
      throw new Error('not running');
    };
    el.querySelector<HTMLButtonElement>('gr-optimize-settings .lead .gr-link')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-optimize-settings .error')).toEqual([
      'Claude Code’s checks couldn’t be listed: not running',
    ]);
  });

  it('shows nothing when the agent offers none of the checks', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.commands'] = () => [command('compact')];
    const { fixture, el } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    expect(el.querySelector('gr-optimize-settings section')).toBeNull();
  });
});
