import { TestBed } from '@angular/core/testing';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBridge, render, write } from '@ui/testing/app-testing';
import { ChatPage } from './chat-page';
import { ApprovalsPage } from './approvals/approvals-page';
import { Subagents } from './subagents/subagents';

describe('chat.providers', () => {
  it('fills the left page with the chat, and the right with its Plan, a second chat and a helper', async () => {
    const { bridge } = fakeBridge();
    await render(bridge);
    const shell = TestBed.inject(ShellRegistry);
    expect(shell.chatPage()).toBe(ChatPage);
    expect(shell.approvalsPage()).toBe(ApprovalsPage);
    const pages = shell.rightPages
      .all()
      .filter((page) => ['plan', 'second-chat', 'subagent'].includes(page.id));
    expect(pages.map(({ id, label, plainLabel }) => [id, label, plainLabel])).toEqual([
      ['plan', 'Outline', 'Plan'],
      ['second-chat', 'Second chapter', 'Second chat'],
      ['subagent', 'Helper', 'Subagent'],
    ]);
  });

  it('heads the helper’s page with the task its subagent was given', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.subagent'] = () => ({ entries: [] });
    const { fixture, el } = await render(bridge);
    const helper = TestBed.inject(ShellRegistry)
      .rightPages.all()
      .find((page) => page.id === 'subagent')!;
    expect(helper.heading!()).toBeUndefined();

    await write(fixture, el, 'Find the meter');
    const call = {
      kind: 'tool' as const,
      id: 't1',
      tool: 'Agent',
      input: { description: 'Find the meter' },
    };
    emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [call] } });
    await fixture.whenStable();
    TestBed.inject(Subagents).show('chat-1', call);
    expect(helper.heading!()).toBe('Find the meter');
  });
});
