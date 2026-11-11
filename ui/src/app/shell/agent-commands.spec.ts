import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentCommand } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { AgentCommands } from './agent-commands';
import type { CommandSearch } from './right-page-state';

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Free up context', kind: 'command' },
  { name: 'review', description: 'Review a pull request', kind: 'command' },
  { name: 'code-review', description: 'Review the diff', kind: 'skill' },
];

const search = (query: string, cwd = 'C:/work'): CommandSearch => ({
  chatId: 'chat-1',
  agent: 'claude-code',
  cwd,
  query,
  use: () => {},
});

function withCommands() {
  const fake = useFakeBridge();
  fake.answers['agents.commands'] = () => COMMANDS;
  const commands = TestBed.inject(AgentCommands);
  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  const asked = () => fake.calls.filter((c) => c.command === 'agents.commands');
  return { ...fake, commands, stable, asked };
}

describe('AgentCommands', () => {
  it('lists the commands, then the skills, holding the query, those starting with it first', async () => {
    const { commands, stable } = withCommands();
    commands.open(search('re'));
    await stable();
    expect(commands.listed().map(({ parts }) => parts)).toEqual([
      ['', '/re', 'view'],
      ['code-', 're', 'view'],
    ]);
    expect(commands.chosen()?.name).toBe('review');
  });

  it('moves the choice within the list, and back to the first as the list changes', async () => {
    const { commands, stable } = withCommands();
    commands.open(search(''));
    await stable();
    commands.move(-1);
    expect(commands.selected()).toBe('compact');
    commands.move(5);
    expect(commands.selected()).toBe('code-review');
    commands.open(search('comp'));
    expect(commands.selected()).toBe('compact');
  });

  it('asks the agent again only for another folder', async () => {
    const { commands, stable, asked } = withCommands();
    commands.open(search('c'));
    commands.open(search('co'));
    await stable();
    commands.open(search('co', 'D:/other'));
    await stable();
    expect(asked().map((c) => c.request)).toEqual([
      { agent: 'claude-code', cwd: 'C:/work' },
      { agent: 'claude-code', cwd: 'D:/other' },
    ]);
    commands.close();
    expect(commands.search()).toBeNull();
  });

  it('keeps a list it has when asking again fails, and says why when it has none', async () => {
    const { commands, stable, answers } = withCommands();
    commands.open(search(''));
    await stable();
    commands.close();
    answers['agents.commands'] = () => Promise.reject(new Error('gone'));
    commands.open(search(''));
    await stable();
    expect(commands.listed()).toHaveLength(3);

    commands.open(search('', 'D:/other'));
    await stable();
    expect(commands.all()).toEqual({ error: 'gone' });
  });
});
