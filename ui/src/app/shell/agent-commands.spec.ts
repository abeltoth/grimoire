import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentCommand } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { AgentCatalog } from '../core/agent-catalog';
import { ChatList } from '../core/chat-list';
import { AgentCommands } from './agent-commands';
import { CommandRuns } from './command-runs';

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Free up context', group: 'chat', run: 'now' },
  { name: 'review', description: 'Review a pull request', group: 'chat', run: 'compose' },
  { name: 'code-review', description: 'Review the diff', group: 'chat', run: 'now' },
  { name: 'usage', description: 'Show usage', group: 'reports', run: 'now' },
  { name: 'model', description: 'Set the model', group: 'settings', run: 'pick', owner: 'model' },
  {
    name: 'fast',
    description: 'Toggle fast mode',
    group: 'settings',
    run: 'pick',
    choices: [{ value: 'on' }, { value: 'off', current: true }],
  },
];

/** The commands, once the open chats are restored, which takes the place of any made before. */
async function withCommands() {
  const fake = useFakeBridge();
  fake.answers['agents.commands'] = () => COMMANDS;
  TestBed.inject(AgentCatalog);
  const commands = TestBed.inject(AgentCommands);
  const list = TestBed.inject(ChatList);
  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  const asked = () => fake.calls.filter((c) => c.command === 'agents.commands');
  await stable();
  /** A blank chat in this folder. */
  const chatIn = (cwd: string) => {
    const id = list.newChat();
    list.update(id, (chat) => ({ ...chat, settings: { ...chat.settings, cwd } }));
    return id;
  };
  return { ...fake, commands, list, stable, asked, chatIn };
}

describe('AgentCommands', () => {
  it('lists the commands group by group, holding the query, those starting with it first', async () => {
    const { commands, stable, chatIn } = await withCommands();
    const chatId = chatIn('C:/work');
    commands.open({ chatId, query: '', typed: false });
    await stable();
    expect(commands.listed().map((entry) => entry.id)).toEqual([
      'model',
      'fast',
      'usage',
      'compact',
      'review',
      'code-review',
    ]);

    commands.searchFor('re');
    expect(commands.listed().map(({ parts }) => parts)).toEqual([
      ['', '/re', 'view'],
      ['/code-', 're', 'view'],
    ]);
    expect(commands.chosen()?.id).toBe('review');
  });

  it('moves the choice within the list, and back to the first as the list changes', async () => {
    const { commands, stable, chatIn } = await withCommands();
    const chatId = chatIn('C:/work');
    commands.open({ chatId, query: '', typed: true });
    await stable();
    commands.move(-1);
    expect(commands.selected()).toBe('model');
    commands.move(9);
    expect(commands.selected()).toBe('code-review');
    commands.open({ chatId, query: 'comp', typed: true });
    expect(commands.selected()).toBe('compact');
  });

  it('asks the agent again only for another folder', async () => {
    const { commands, stable, asked, chatIn } = await withCommands();
    const work = chatIn('C:/work');
    commands.open({ chatId: work, query: 'c', typed: true });
    commands.open({ chatId: work, query: 'co', typed: true });
    await stable();
    commands.open({ chatId: chatIn('D:/other'), query: 'co', typed: true });
    await stable();
    expect(asked().map((c) => c.request)).toEqual([
      { agent: 'claude-code', cwd: 'C:/work' },
      { agent: 'claude-code', cwd: 'D:/other' },
    ]);
    commands.close();
    expect(commands.search()).toBeNull();
  });

  it('keeps a list it has when asking again fails, and says why when it has none', async () => {
    const { commands, stable, answers, chatIn } = await withCommands();
    const work = chatIn('C:/work');
    commands.open({ chatId: work, query: '', typed: false });
    await stable();
    commands.close();
    answers['agents.commands'] = () => Promise.reject(new Error('gone'));
    commands.open({ chatId: work, query: '', typed: false });
    await stable();
    expect(commands.listed()).toHaveLength(6);

    commands.open({ chatId: chatIn('D:/other'), query: '', typed: false });
    await stable();
    expect(commands.all()).toEqual({ error: 'gone' });
  });

  it('lists a command’s choices to pick from, the chat’s own settings for what Grimoire keeps', async () => {
    const { commands, stable, list, chatIn } = await withCommands();
    const chatId = chatIn('C:/work');
    commands.open({ chatId, query: 'mod', typed: true });
    await stable();
    commands.use(commands.chosen()!);
    expect(commands.search()).toEqual({ chatId, query: '', typed: false });
    expect(commands.listed().map(({ id, choice }) => [id, choice?.current])).toEqual([
      ['model-opus', true],
      ['model-sonnet', undefined],
      ['model-haiku', undefined],
    ]);
    commands.searchFor('son');
    commands.use(commands.chosen()!);
    expect(list.find(chatId)?.settings.model).toBe('sonnet');
    expect(commands.search()).toBeNull();

    commands.open({ chatId, query: 'fast', typed: false });
    commands.use(commands.chosen()!);
    expect(commands.listed().map(({ parts, choice }) => [parts.join(''), choice?.current])).toEqual(
      [
        ['on', undefined],
        ['off', true],
      ],
    );
    // Esc goes back to the commands, then away.
    commands.back();
    expect(commands.picking()).toBeNull();
    commands.back();
    expect(commands.search()).toBeNull();
  });

  it('writes a command in the message field to finish, or sends it at once', async () => {
    const { commands, stable, calls, chatIn } = await withCommands();
    const runs = TestBed.inject(CommandRuns);
    const chatId = chatIn('C:/work');
    commands.open({ chatId, query: 'review', typed: false });
    await stable();
    commands.use(commands.chosen()!);
    expect(runs.written()).toEqual({ chatId, text: '/review ' });

    commands.open({ chatId, query: 'usage', typed: false });
    commands.use(commands.chosen()!);
    await stable();
    // A blank chat begins with it.
    expect(calls.filter((c) => c.command === 'agents.start').map((c) => c.request)).toMatchObject([
      { agent: 'claude-code', text: '/usage' },
    ]);
  });
});
