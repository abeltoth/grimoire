import type { OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('restart-notice', () => {
  const opened = (more: Partial<OpenChat> = {}): OpenChat => ({
    id: 'c1',
    agent: 'claude-code',
    title: 'Jira',
    settings: { cwd: 'C:/work/grimoire' },
    status: 'idle',
    entries: [{ kind: 'user', id: 'u1', text: 'Hello' }],
    approvals: [],
    queued: [],
    plan: [],
    withdrawn: [],
    copied: [],
    ...more,
  });

  it('shows under the last reply only while the chat is outdated', async () => {
    const { bridge, answers, emit } = fakeBridge();
    answers['agents.openChats'] = () => [opened()];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el, texts } = await render(bridge);
    expect(el.querySelector('gr-restart-notice')).toBeNull();

    emit('agents.outdated', { chatId: 'c1', outdated: 'jira added' });
    await fixture.whenStable();
    expect(texts('gr-transcript gr-restart-notice .what')).toEqual(['jira added']);
    expect(el.querySelector('gr-restart-notice .slip')!.getAttribute('title')).toBe(
      'The chapter takes it in once it starts again',
    );
    expect(texts('gr-restart-notice .restart')).toEqual(['Restart']);
    expect(el.querySelector('gr-restart-notice .dismiss')!.getAttribute('aria-label')).toBe(
      'Dismiss',
    );

    emit('agents.outdated', { chatId: 'c1', outdated: null });
    await fixture.whenStable();
    expect(el.querySelector('gr-restart-notice')).toBeNull();
  });

  it('restarts the chat, or keeps it as it is, when you ask', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['agents.openChats'] = () => [opened({ outdated: 'jira added' })];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el } = await render(bridge);
    const [restart, dismiss] = el.querySelectorAll<HTMLButtonElement>('gr-restart-notice button');

    restart!.click();
    dismiss!.click();
    await fixture.whenStable();
    expect(calls).toContainEqual({ command: 'agents.restart', request: { chatId: 'c1' } });
    expect(calls).toContainEqual({ command: 'agents.dismissRestart', request: { chatId: 'c1' } });
  });
});
