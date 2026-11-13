import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { OpenChat } from '@grimoire/contract';
import { fakeBridge } from '../../testing/app-testing';
import { GRIMOIRE_BRIDGE } from './bridge';
import { ChatList } from './chat-list';
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

async function list(
  setup: (fake: ReturnType<typeof fakeBridge>) => void = () => {},
  popout: string | null = null,
) {
  const fake = fakeBridge();
  setup(fake);
  TestBed.configureTestingModule({
    providers: [
      { provide: GRIMOIRE_BRIDGE, useValue: fake.bridge },
      { provide: POPOUT, useValue: popout },
    ],
  });
  const chats = TestBed.inject(ChatList);
  await TestBed.inject(ApplicationRef).whenStable();
  const ids = () => chats.all().map((c) => c.id);
  const layouts = () =>
    fake.calls.filter((call) => call.command === 'layout.set').map((call) => call.request);
  return { chats, fake, ids, layouts };
}

describe('ChatList', () => {
  it('opens the chats the hub has open, on the pages you were on', async () => {
    const { chats, ids } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2'), chat('c3')];
      answers['layout.get'] = () => ({ current: 'c2', beside: 'c3', popouts: [{ chatId: 'c1' }] });
    });
    expect(ids()).toEqual(['c2', 'c3']);
    expect(chats.currentId()).toBe('c2');
    expect(chats.besideId()).toBe('c3');
  });

  it('opens on a blank page when no chat is open', async () => {
    const { chats } = await list();
    expect(chats.current()?.status).toBe('blank');
  });

  it("keeps each chat as the hub's events say", async () => {
    const { chats, fake } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1')];
      answers['layout.get'] = () => ({ current: 'c1' });
    });
    fake.emit('agents.title', { chatId: 'c1', title: 'Meter', by: 'agent' });
    fake.emit('agents.status', { chatId: 'c1', status: 'thinking' });
    fake.emit('agents.suggestion', { chatId: 'c1', suggestion: 'Run the tests' });
    expect(chats.current()).toMatchObject({
      title: 'Meter',
      status: 'thinking',
      suggestion: 'Run the tests',
    });
    fake.emit('agents.suggestion', { chatId: 'c1', suggestion: null });
    expect(chats.current()?.suggestion).toBeUndefined();
  });

  it('turns to the next chat when one closes, and to a blank page after the last', async () => {
    const { chats, ids, fake } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2')];
      answers['layout.get'] = () => ({ current: 'c1' });
    });
    await chats.close('c1');
    expect(chats.currentId()).toBe('c2');
    await chats.close('c2');
    expect(chats.current()?.status).toBe('blank');
    expect(ids()).toHaveLength(1);
    expect(fake.calls.filter((call) => call.command === 'agents.close')).toHaveLength(2);
  });

  it('swaps the pages when you turn to the chat beside', async () => {
    const { chats, layouts } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2')];
      answers['layout.get'] = () => ({ current: 'c1' });
    });
    chats.putBeside('c2');
    chats.open('c2');
    expect([chats.currentId(), chats.besideId()]).toEqual(['c2', 'c1']);
    expect(layouts().slice(-2)).toEqual([{ beside: 'c1' }, { current: 'c2' }]);
  });

  it("closes a chat's settings card when you turn to another", async () => {
    const { chats } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2')];
      answers['layout.get'] = () => ({ current: 'c1' });
    });
    chats.openSettings('c1', 'model');
    expect(chats.settingsCard()).toEqual({ id: 'c1', on: 'model' });
    chats.open('c2');
    expect(chats.settingsCard()).toBeNull();
  });

  it('pops a chat out, and takes it back when its window closes', async () => {
    const { chats, fake, ids } = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2')];
      answers['layout.get'] = () => ({ current: 'c1' });
    });
    chats.popOut('c2');
    expect(ids()).toEqual(['c1']);
    expect(fake.bridge.popOut).toHaveBeenCalledWith('c2');
    fake.closePopout('c2');
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    expect(ids()).toEqual(['c1', 'c2']);
    expect(chats.currentId()).toBe('c2');
  });

  it("holds only its chat in a popout's window", async () => {
    const popout = await list(({ answers }) => {
      answers['agents.openChats'] = () => [chat('c1'), chat('c2')];
    }, 'c2');
    expect(popout.ids()).toEqual(['c2']);
    expect(popout.chats.currentId()).toBe('c2');
  });

  it("closes a popout's window when its chat isn't open", async () => {
    const gone = await list(() => {}, 'c9');
    expect(gone.fake.bridge.window.close).toHaveBeenCalled();
  });

  it('opens a saved chat, in your home folder when it names none', async () => {
    const { chats, fake } = await list(({ answers }) => {
      answers['agents.open'] = () => chat('saved');
    });
    await new Promise((resolve) => setTimeout(resolve));
    await chats.openChat({ id: 'saved', agent: 'claude-code', title: 'Saved', updatedAt: 1 });
    expect(chats.currentId()).toBe('saved');
    expect(fake.calls.find((call) => call.command === 'agents.open')?.request).toEqual({
      agent: 'claude-code',
      chatId: 'saved',
      settings: { cwd: 'C:/Users/me' },
    });
  });
});
