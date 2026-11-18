import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { fakeBridge } from '../../testing/app-testing';
import { GRIMOIRE_BRIDGE } from './bridge';
import { NewChats } from './new-chats';

async function newChats(settings: Partial<GrimoireSettings> = {}) {
  const fake = fakeBridge();
  fake.answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, ...settings });
  fake.answers['presets.list'] = () => [
    { name: 'Bug fix', agent: 'claude-code', settings: { mode: 'plan' }, prompt: 'Fix it' },
  ];
  TestBed.configureTestingModule({
    providers: [{ provide: GRIMOIRE_BRIDGE, useValue: fake.bridge }],
  });
  const chats = TestBed.inject(NewChats);
  await chats.ready();
  return { chats, calls: fake.calls };
}

describe('NewChats', () => {
  afterEach(() => vi.useRealTimers());

  it('begins with the settings used last, with the default agent', async () => {
    const { chats } = await newChats();
    expect(chats.startOf()).toEqual({ agent: 'claude-code', settings: {} });
    chats.restored({ agent: 'claude-code', settings: { model: 'opus' } });
    expect(chats.startOf()).toEqual({ agent: 'claude-code', settings: { model: 'opus' } });
    chats.restored({ agent: 'other', settings: { model: 'gpt' } });
    expect(chats.startOf()).toEqual({ agent: 'other', settings: { model: 'gpt' } });
  });

  it('begins with the agent, model and effort Settings fixes, in the folder used last', async () => {
    const { chats } = await newChats({
      newChatDefault: { agent: 'claude-code', model: 'opus', effort: 'max' },
    });
    expect(chats.startOf()).toEqual({
      agent: 'claude-code',
      settings: { model: 'opus', effort: 'max' },
    });
    chats.restored({
      agent: 'claude-code',
      settings: { cwd: '/work', mode: 'plan', model: 'sonnet', effort: 'low', autoModel: true },
    });
    expect(chats.startOf()).toEqual({
      agent: 'claude-code',
      settings: { cwd: '/work', mode: 'plan', model: 'opus', effort: 'max' },
    });
    // Another agent's folder and permission aren't this one's.
    chats.restored({ agent: 'other', settings: { cwd: '/other', model: 'gpt' } });
    expect(chats.startOf()).toEqual({
      agent: 'claude-code',
      settings: { model: 'opus', effort: 'max' },
    });
  });

  it('begins with a preset when Settings says so', async () => {
    const { chats } = await newChats({ newChat: { from: 'preset', preset: 'Bug fix' } });
    expect(chats.startOf()).toEqual({
      preset: 'Bug fix',
      name: 'Bug fix',
      agent: 'claude-code',
      settings: { mode: 'plan' },
      prompt: 'Fix it',
    });
  });

  it('keeps the settings used last for next time, without the MCP servers turned off', async () => {
    const { chats, calls } = await newChats();
    chats.remember({ agent: 'claude-code', settings: { model: 'opus', mcpOff: ['jira'] } });
    expect(chats.startOf()).toEqual({ agent: 'claude-code', settings: { model: 'opus' } });
    expect(calls.at(-1)).toEqual({
      command: 'layout.set',
      request: { lastUsed: { agent: 'claude-code', settings: { model: 'opus' } } },
    });
  });

  it('makes blank chats, each with its own local ID and when it was opened', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
    const { chats } = await newChats();
    const first = chats.blank();
    const second = chats.blank({ agent: 'claude-code', settings: {}, prompt: 'Hello' });
    expect([first.id, second.id]).toEqual(['blank-1', 'blank-2']);
    expect(first).toMatchObject({ status: 'blank', begunAt: Date.parse('2026-11-10T09:00:00Z') });
    expect(first.prompt).toBeUndefined();
    expect(second.prompt).toBe('Hello');
  });

  it('tells who asks when a blank chat begins, until they stop asking', async () => {
    const { chats } = await newChats();
    const told: string[] = [];
    const stop = chats.onBegun((blankId, chat) => told.push(`${blankId}:${chat.id}`));
    const chat = { id: 'c1' } as Parameters<typeof chats.began>[1];
    chats.began('blank-1', chat);
    stop();
    chats.began('blank-2', chat);
    expect(told).toEqual(['blank-1:c1']);
  });
});
