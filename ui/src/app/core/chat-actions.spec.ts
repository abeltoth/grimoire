import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { OpenChat } from '@grimoire/contract';
import { fakeBridge } from '../../testing/app-harness';
import { GRIMOIRE_BRIDGE } from './bridge';
import { ChatActions } from './chat-actions';
import { ChatList } from './chat-list';
import { NewChats } from './new-chats';
import { POPOUT } from './popout';

const chat = (id: string, title = id): OpenChat => ({
  id,
  agent: 'claude-code',
  title,
  settings: { cwd: 'C:/work' },
  status: 'idle',
  entries: [],
  approvals: [],
  queued: [],
  plan: [],
  withdrawn: [],
  copied: [],
});

async function actions(setup: (fake: ReturnType<typeof fakeBridge>) => void = () => {}) {
  const fake = fakeBridge();
  setup(fake);
  TestBed.configureTestingModule({
    providers: [
      { provide: GRIMOIRE_BRIDGE, useValue: fake.bridge },
      { provide: POPOUT, useValue: null },
    ],
  });
  const act = TestBed.inject(ChatActions);
  const list = TestBed.inject(ChatList);
  await TestBed.inject(ApplicationRef).whenStable();
  const sent = (command: string) =>
    fake.calls.filter((call) => call.command === command).map((call) => call.request);
  return { act, list, fake, sent };
}

const onChat = (fake: ReturnType<typeof fakeBridge>, ...open: OpenChat[]) => {
  fake.answers['agents.openChats'] = () => open;
  fake.answers['layout.get'] = () => ({ current: open[0]?.id ?? null });
};

describe('ChatActions', () => {
  it("starts a blank chat with its first message, and tells who asked when it's begun", async () => {
    const { act, list } = await actions();
    const begun: string[] = [];
    TestBed.inject(NewChats).onBegun((blankId, opened) => begun.push(`${blankId}:${opened.id}`));
    const blank = list.currentId()!;
    expect(await act.send(blank, 'Hello')).toBe('chat-1');
    expect(list.currentId()).toBe('chat-1');
    expect(list.all().map((c) => c.id)).toEqual(['chat-1']);
    expect(begun).toEqual([`${blank}:chat-1`]);
  });

  it('sends what you write while a blank chat starts to it once it has', async () => {
    const { act, list, sent } = await actions();
    const blank = list.currentId()!;
    const first = act.send(blank, 'Hello');
    const second = act.send(blank, 'And this');
    expect(await Promise.all([first, second])).toEqual(['chat-1', 'chat-1']);
    expect(sent('agents.send')).toEqual([{ chatId: 'chat-1', text: 'And this' }]);
  });

  it("shows a failed request as the chat's error, until the next message", async () => {
    const { act, list } = await actions(({ answers }) => {
      onChat({ answers } as ReturnType<typeof fakeBridge>, chat('c1'));
      answers['agents.send'] = () => {
        throw new Error('The agent is busy');
      };
    });
    expect(await act.send('c1', 'Hello')).toBeUndefined();
    expect(list.find('c1')?.error).toBe('The agent is busy');
  });

  it("changes a blank chat's agent, which starts on its own default model", async () => {
    const { act, list } = await actions();
    const blank = list.currentId()!;
    await act.configure(blank, { model: 'sonnet', effort: 'high' });
    await act.configure(blank, { agent: 'other' });
    expect(list.find(blank)).toMatchObject({ agent: 'other', settings: {} });
  });

  it('asks the service to change a begun chat, and keeps the change for new chats', async () => {
    const { act, sent } = await actions(({ answers }) => {
      onChat({ answers } as ReturnType<typeof fakeBridge>, chat('c1'));
    });
    await act.configure('c1', { mode: 'plan', cwd: 'D:/elsewhere' });
    expect(sent('agents.configure')).toEqual([{ chatId: 'c1', change: { mode: 'plan' } }]);
    expect(TestBed.inject(NewChats).startOf().settings).toEqual({ cwd: 'C:/work', mode: 'plan' });
  });

  it('puts the title back when renaming fails', async () => {
    const { act, list } = await actions(({ answers }) => {
      onChat({ answers } as ReturnType<typeof fakeBridge>, chat('c1', 'Meter'));
      answers['agents.rename'] = () => {
        throw new Error('No');
      };
    });
    await act.rename('c1', '  Context meter ');
    expect(list.find('c1')).toMatchObject({ title: 'Meter', error: 'No' });
  });

  it("puts the second model's chat on the right page", async () => {
    const { act, list } = await actions(({ answers }) => {
      onChat({ answers } as ReturnType<typeof fakeBridge>, chat('c1'));
      answers['agents.parallel'] = () => chat('c2');
    });
    await act.sendParallel('c1', 'sonnet', 'Try both');
    expect([list.currentId(), list.besideId()]).toEqual(['c1', 'c2']);
  });

  it('turns to a fork, and to a blank chat with a follow-up written in', async () => {
    const { act, list } = await actions(({ answers }) => {
      onChat({ answers } as ReturnType<typeof fakeBridge>, chat('c1'));
      answers['agents.fork'] = () => chat('c1-fork');
      answers['agents.takeFollowUp'] = () => ({
        agent: 'claude-code',
        settings: { cwd: 'C:/work' },
        prompt: 'Write the docs',
      });
    });
    await act.fork('c1', 'u1');
    expect(list.currentId()).toBe('c1-fork');
    await act.takeFollowUp('c1', 0);
    expect(list.current()).toMatchObject({ status: 'blank', prompt: 'Write the docs' });
  });
});
