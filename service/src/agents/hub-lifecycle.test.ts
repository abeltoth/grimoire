import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveProfile } from '../core/app-state';
import { openDatabase } from '../storage/database';
import { hubStore } from './chat-table';
import { FakeAdapter } from './fake-adapter';
import { AgentHub } from './hub';
import { settings } from './hub-testing';

let fake: FakeAdapter;
let hub: AgentHub;

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeAdapter();
  hub = new AgentHub(() => {}, 50);
  hub.addAdapter(fake);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('putting the chats away for another profile', () => {
  it('is refused, naming them, while a turn runs or an approval waits', async () => {
    const idle = await hub.start('fake', settings, 'Hello');
    fake.runOf(idle.id).events.turnEnded();
    expect(hub.busy()).toBeUndefined();

    const working = await hub.start('fake', settings, 'Working');
    fake.runOf(working.id).events.title('Fix the ribbon');
    expect(hub.busy()).toBe('Wait for "Fix the ribbon" to finish, or stop it, first');
    fake.runOf(working.id).events.turnEnded();

    void fake
      .runOf(idle.id)
      .events.approval({ id: 'a1', tool: 'Write', input: {} }, new AbortController().signal);
    const asking = await hub.start('fake', settings, 'Asking');
    expect(hub.busy()).toBe(
      'Wait for an untitled chat, an untitled chat to finish, or stop them, first',
    );
    fake.runOf(asking.id).events.turnEnded();
  });

  it('is refused while a sign-in is under way', async () => {
    const signing = Object.assign(new FakeAdapter(), {
      signIn: () => ({ done: new Promise<void>(() => {}), code: () => {}, cancel: () => {} }),
    });
    hub = new AgentHub(() => {}, 50);
    hub.addAdapter(signing);
    void hub.signIn('fake', 'mum@example.com');
    expect(hub.busy()).toBe('A sign-in is under way: finish or cancel it first');
  });

  it('stops the processes, keeps the chats, and opens the new profile’s', async () => {
    const db = openDatabase(':memory:');
    const store = hubStore(db);
    hub = new AgentHub(() => {}, 50, store);
    hub.addAdapter(fake);
    const personal = await hub.start('fake', settings, 'Hello');
    fake.runOf(personal.id).events.turnEnded();

    hub.putAway();
    expect(fake.runOf(personal.id).closed).toBe(true);
    setActiveProfile(db, 'work');
    expect(await hub.openChats()).toEqual([]);
    fake.transcripts.set('w', [{ kind: 'user', id: 'u1', text: 'At work' }]);
    await hub.open('fake', 'w', settings);
    hub.putAway();

    setActiveProfile(db, 'personal');
    expect((await hub.openChats()).map((chat) => chat.id)).toEqual([personal.id]);
    setActiveProfile(db, 'work');
    expect(await hub.openChats()).toMatchObject([{ id: 'w', entries: [{ text: 'At work' }] }]);
  });
});
