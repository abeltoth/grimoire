import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentCommand } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { ChatList } from '../core/chat-list';
import { CommandRuns } from './command-runs';

const command = (name: string, more: Partial<AgentCommand> = {}): AgentCommand => ({
  name,
  description: '',
  group: 'chat',
  run: 'now',
  ...more,
});

async function withChat() {
  const fake = useFakeBridge();
  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  const list = TestBed.inject(ChatList);
  const runs = TestBed.inject(CommandRuns);
  // The open chats are restored first, which takes the place of any made before.
  await stable();
  const chatId = list.currentId()!;
  return { ...fake, stable, list, runs, chatId };
}

describe('CommandRuns', () => {
  it('sends a command, or writes it in for you to finish', async () => {
    const { runs, chatId, calls, stable } = await withChat();
    runs.run(chatId, command('review', { run: 'compose' }));
    expect(runs.written()).toEqual({ chatId, text: '/review ' });

    runs.run(chatId, command('usage'));
    await stable();
    expect(calls.filter((c) => c.command === 'agents.start').map((c) => c.request)).toMatchObject([
      { text: '/usage' },
    ]);
  });

  it('sends a choice after the command, or changes what Grimoire keeps itself', async () => {
    const { runs, list, chatId, calls, stable } = await withChat();
    runs.pick(chatId, command('model', { owner: 'model' }), 'haiku');
    runs.pick(chatId, command('effort', { owner: 'effort' }), 'low');
    runs.pick(chatId, command('permissions', { owner: 'mode' }), 'plan');
    expect(list.find(chatId)?.settings).toMatchObject({
      model: 'haiku',
      effort: 'low',
      mode: 'plan',
    });

    runs.pick(chatId, command('fast'), 'on');
    await stable();
    expect(calls.filter((c) => c.command === 'agents.start').map((c) => c.request)).toMatchObject([
      { text: '/fast on' },
    ]);
  });

  it('starts a new chat, or asks the chat’s page to rewrite its title', async () => {
    const { runs, list, chatId } = await withChat();
    runs.run(chatId, command('rename', { owner: 'rename' }));
    expect(runs.renaming()).toBe(chatId);
    runs.run(chatId, command('clear', { owner: 'new-chat' }));
    expect(list.currentId()).not.toBe(chatId);
  });
});
