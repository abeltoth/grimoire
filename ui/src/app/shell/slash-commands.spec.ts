import { fakeBridge, render, write } from '../../testing/app-testing';

describe('SlashCommands', () => {
  it('uses a command clicked on the right page', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
    ];
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    field.value = '/';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-slash-commands .entry')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(document.activeElement).toBe(field);
  });

  it("says why the agent's commands could not be listed", async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => {
      throw new Error('Claude Code is not installed');
    };
    const { fixture, el, texts } = await render(bridge);
    const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    field.value = '/';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // A blank chat's folder isn't chosen yet: the agent looks in your home folder.
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);
    expect(texts('gr-slash-commands .entries .note')).toEqual([
      'Claude Code’s commands and skills couldn’t be listed: Claude Code is not installed',
    ]);
  });
});
