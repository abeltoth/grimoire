import type { AgentCommand, AgentModels, NewChatSettings } from '@grimoire/contract';
import type { Chat } from '../core/chat';
import { choicesOf } from './command-choices';

const chat = (settings: NewChatSettings): Chat => ({
  id: 'c1',
  agent: 'claude-code',
  title: '',
  settings,
  status: 'idle',
  entries: [],
  approvals: [],
  queued: [],
  plan: [],
  withdrawn: [],
  copied: [],
});

const models: AgentModels = {
  models: [
    { id: 'opus', name: 'Opus 5.5', description: 'Most capable' },
    { id: 'haiku', name: 'Haiku 5.5' },
  ],
  default: 'opus',
};

const owned = (owner: AgentCommand['owner']): AgentCommand => ({
  name: String(owner),
  description: '',
  group: 'settings',
  run: 'pick',
  owner,
});

describe('choicesOf', () => {
  it('lists the models, the chat’s own marked, or else the default', () => {
    expect(choicesOf(owned('model'), chat({}), models, { levels: [] })).toEqual([
      { value: 'opus', label: 'Opus 5.5', description: 'Most capable', current: true },
      { value: 'haiku', label: 'Haiku 5.5' },
    ]);
    expect(
      choicesOf(owned('model'), chat({ model: 'haiku' }), models, { levels: [] }).map(
        (choice) => choice.current,
      ),
    ).toEqual([undefined, true]);
  });

  it('lists the efforts the chat’s model takes', () => {
    expect(
      choicesOf(owned('effort'), chat({}), models, { levels: ['low', 'high'], level: 'high' }),
    ).toEqual([
      { value: 'low', label: 'low' },
      { value: 'high', label: 'high', current: true },
    ]);
  });

  it('shows the agent’s own choices by their value', () => {
    const fast: AgentCommand = {
      name: 'fast',
      description: '',
      group: 'settings',
      run: 'pick',
      choices: [{ value: 'on', current: true }, { value: 'off' }],
    };
    expect(choicesOf(fast, chat({}), models, { levels: [] })).toEqual([
      { value: 'on', label: 'on', current: true },
      { value: 'off', label: 'off' },
    ]);
  });
});
