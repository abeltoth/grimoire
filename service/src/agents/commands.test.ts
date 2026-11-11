import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../registry';
import { registerAgentCommands } from './commands';
import type { AgentHub } from './hub';

/** A hub that records which of its methods each command calls, and with what. */
function recordingHub(): { hub: AgentHub; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const hub = new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args: unknown[]) =>
          calls.push([String(method), args]),
    },
  );
  return { hub: hub as AgentHub, calls };
}

describe('the agent commands', () => {
  it('pass each request on to the hub, with its fields in order', async () => {
    const { hub, calls } = recordingHub();
    const registry = new CommandRegistry();
    registerAgentCommands(registry, hub);
    const ask = (command: string, request: object) => registry.dispatch(command, request);

    await ask('agents.list', {});
    await ask('agents.chats', { agent: 'claude-code', cwd: '/w' });
    await ask('agents.start', {
      agent: 'claude-code',
      settings: { cwd: '/w' },
      text: 'Hi',
      title: 'T',
      attachments: [],
    });
    await ask('agents.parallel', { from: 'a', model: 'opus', text: 'Hi', attachments: [] });
    await ask('agents.decide', { approvalId: 'p1', decision: 'allow' });
    await ask('agents.close', { chatId: 'a' });

    expect(calls).toEqual([
      ['agents', []],
      ['listChats', ['claude-code', '/w']],
      ['start', ['claude-code', { cwd: '/w' }, 'Hi', 'T', []]],
      ['parallel', ['a', 'opus', 'Hi', []]],
      ['decide', ['p1', 'allow']],
      ['close', ['a']],
    ]);
  });

  it('name the hub method of each the same, but for the list and the saved chats', async () => {
    const { hub, calls } = recordingHub();
    const registry = new CommandRegistry();
    const names: string[] = [];
    const register = registry.register.bind(registry);
    registry.register = ((name: string, handler: never) => {
      names.push(name);
      register(name as never, handler);
    }) as typeof registry.register;
    registerAgentCommands(registry, hub);

    for (const name of names) await registry.dispatch(name, {});
    const renamed: Record<string, string> = { list: 'agents', chats: 'listChats' };
    expect(calls.map(([method]) => method)).toEqual(
      names.map((name) => renamed[name.slice('agents.'.length)] ?? name.slice('agents.'.length)),
    );
  });
});
