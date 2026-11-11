import { homedir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database';
import { hubStore } from './chat-table';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, PickingAdapter, reply, settings } from './hub-testing';

let fake: FakeAdapter;
let hub: AgentHub;
let sent: Sent[];

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeAdapter();
  sent = [];
  hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50);
  hub.addAdapter(fake);
});

afterEach(() => {
  vi.useRealTimers();
});

const events = () => sent.map((s) => s.event);

describe('NewChats', () => {
  it('starts a chat on Auto on the model and effort picked for its first message', async () => {
    fake.picks.set('Fix the ribbon', { model: 'small', effort: 'low' });
    const chat = await hub.start(
      'fake',
      { ...settings, autoModel: true, model: 'big', effort: 'max' },
      'Fix the ribbon',
    );
    expect(chat.settings).toEqual({ cwd: '/work', autoModel: true, model: 'small', effort: 'low' });
    expect(fake.runOf(chat.id).settings).toMatchObject({ model: 'small', effort: 'low' });

    // When nothing is picked, it runs on the agent's defaults.
    const unpicked = await hub.start(
      'fake',
      { ...settings, autoModel: true, model: 'small' },
      'Hello',
    );
    expect(unpicked.settings).toEqual({ cwd: '/work', autoModel: true });

    // Picking another model ends Auto; another effort doesn't.
    await hub.configure(chat.id, { effort: 'medium' });
    expect((await hub.open('fake', chat.id, settings)).settings).toMatchObject({
      autoModel: true,
      effort: 'medium',
    });
    await hub.configure(chat.id, { model: 'big' });
    expect((await hub.open('fake', chat.id, settings)).settings).toEqual({
      cwd: '/work',
      model: 'big',
      effort: 'medium',
    });
  });

  describe('sending one entry to two models', () => {
    const begun = async (cwd: string) => {
      fake.transcripts.set('c1', [
        { kind: 'user', id: 'u1', text: 'Add a meter' },
        reply('r1', 'Added.'),
      ]);
      fake.chats = [{ id: 'c1', agent: 'fake', title: 'Context meter', cwd, updatedAt: 1 }];
      await hub.open('fake', 'c1', { cwd });
    };

    it('copies a chat onto the second model, in the same folder, where it only reads, and sends the message to both', async () => {
      await begun('/work');
      const copy = await hub.parallel({ chatId: 'c1' }, 'small', 'Colour it');
      expect(copy).toMatchObject({
        id: 'fork-2',
        title: 'Context meter (a)',
        settings: { cwd: '/work', model: 'small' },
        status: 'thinking',
        entries: [{ id: 'u1' }, { id: 'r1' }, { kind: 'user', text: 'Colour it' }],
        copied: ['u1'],
        readOnly: { chatId: 'c1', title: 'Context meter' },
      });
      expect(fake.runOf('c1')).toMatchObject({
        resume: true,
        sent: ['Colour it'],
        settings: { cwd: '/work' },
      });
      expect(fake.runOf('fork-2')).toMatchObject({
        resume: true,
        sent: ['Colour it'],
        settings: { cwd: '/work', model: 'small' },
      });
      expect((await hub.openChats()).map((chat) => chat.id)).toEqual(['c1', 'fork-2']);
    });

    it('waits for the turn to end', async () => {
      await begun('/work');
      hub.send('c1', 'Colour it');
      await expect(hub.parallel({ chatId: 'c1' }, 'small', 'Bigger')).rejects.toThrow(
        'Wait for the turn to end',
      );
    });

    it('begins the second afresh for a new chat, its title a variant of the first', async () => {
      fake.chats = [{ id: 'c1', agent: 'fake', title: 'Login bug', cwd: '/work', updatedAt: 1 }];
      const second = await hub.parallel(
        {
          agent: 'fake',
          settings: { ...settings, mode: 'plan' },
          title: 'Login bug',
          alongside: 'c0',
        },
        'small',
        'Fix it',
      );
      expect(second).toMatchObject({
        title: 'Login bug (a)',
        settings: { cwd: '/work', mode: 'plan', model: 'small' },
        status: 'thinking',
        entries: [{ kind: 'user', text: 'Fix it' }],
      });
      expect(fake.runOf(second.id)).toMatchObject({ resume: false, sent: ['Fix it'] });

      const untitled = await hub.parallel(
        { agent: 'fake', settings: { cwd: '/plain' }, alongside: 'c0' },
        'small',
        'Fix it',
      );
      expect(untitled).toMatchObject({ title: '', settings: { cwd: '/plain', model: 'small' } });
    });
  });

  it('starts new chats in your home folder unless told otherwise', async () => {
    expect((await hub.start('fake', {}, 'Hi')).settings.cwd).toBe(homedir());
  });

  it('starts a chat under the ID the agent picks, and stops its spare on closeAll', async () => {
    const picking = new PickingAdapter();
    hub.addAdapter(picking);
    const chat = await hub.start('fake', settings, 'Hello');

    expect(chat).toMatchObject({ id: 'picked', status: 'thinking', entries: [{ text: 'Hello' }] });
    expect(picking.started?.text).toBe('Hello');
    expect(picking.started?.id).toBe(chat.entries[0]?.id);
    expect(events()).toEqual(['agents.entry', 'agents.status']);
    picking.started?.events.turnEnded();
    expect((await hub.open('fake', 'picked', settings)).status).toBe('idle');

    hub.closeAll();
    expect(picking.started?.live.closed).toBe(true);
    expect(picking.disposed).toBe(true);
  });

  it('stops a chat closed while its agent was starting it', async () => {
    const picking = new PickingAdapter();
    hub.addAdapter(picking);
    const original = picking.start.bind(picking);
    picking.start = async (chatSettings, text, entryId, bind) =>
      original(chatSettings, text, entryId, (id) => {
        const events = bind(id);
        hub.close(id);
        return events;
      });

    await hub.start('fake', settings, 'Hello');
    expect(picking.started?.live.closed).toBe(true);
  });

  it("forks a chat after a message's turn into the next free variant, and opens it", async () => {
    fake.transcripts.set('c1', [
      { kind: 'user', id: 'u1', text: 'Add a meter' },
      reply('r1', 'Added.'),
      { kind: 'user', id: 'u2', text: 'Colour it' },
      reply('r2', 'Coloured.'),
    ]);
    fake.chats = [
      { id: 'c1', agent: 'fake', title: 'Context meter', cwd: '/work', updatedAt: 1 },
      { id: 'old', agent: 'fake', title: 'Context meter (a)', cwd: '/work', updatedAt: 2 },
    ];
    await hub.open('fake', 'c1', settings);

    const variant = await hub.fork('c1', 'u1');
    expect(variant).toMatchObject({
      id: 'fork-3',
      title: 'Context meter (b)',
      settings,
      status: 'idle',
      entries: [{ id: 'u1' }, { id: 'r1' }],
    });
    expect((await hub.openChats()).map((chat) => chat.id)).toEqual(['c1', 'fork-3']);
    expect((await hub.fork('fork-3', 'u1')).title).toBe('Context meter (c)');
  });

  it("marks a fork's entries as copied, which can't be undone", async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub(() => {}, 50, store);
    hub.addAdapter(fake);
    fake.transcripts.set('c1', [
      { kind: 'user', id: 'u1', text: 'Add a meter' },
      reply('r1', 'Added.'),
      { kind: 'user', id: 'u2', text: 'Colour it' },
    ]);
    await hub.open('fake', 'c1', settings);

    const variant = await hub.fork('c1', 'u2');
    expect(variant.copied).toEqual(['u1', 'u2']);
    expect((await hub.open('fake', 'c1', settings)).copied).toEqual([]);
    // A fork edits as any chat does.
    expect(variant.readOnly).toBeUndefined();
    await expect(hub.undo(variant.id, 'u1')).rejects.toThrow("can't be undone");

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    expect((await restarted.open('fake', variant.id, settings)).copied).toEqual(['u1', 'u2']);
  });
});
