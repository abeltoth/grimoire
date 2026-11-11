import type { ChatSettings } from '@grimoire/contract';
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

describe('Editors', () => {
  describe('one chat editing of those sent one entry in parallel', () => {
    const readOnlyEvents = () =>
      sent.flatMap((s) => (s.event === 'agents.readOnly' ? [s.payload] : []));
    /** Lets the hub take in what was just settled. */
    const settle = () => vi.advanceTimersByTimeAsync(0);
    /** A second model's chat, begun afresh alongside `chatId`, at `mode`. */
    const alongside = (chatId: string, mode?: ChatSettings['mode']) =>
      hub.parallel(
        { agent: 'fake', settings: { ...settings, ...(mode ? { mode } : {}) }, alongside: chatId },
        'small',
        'Too',
      );
    let store: ReturnType<typeof hubStore>;

    beforeEach(() => {
      store = hubStore(openDatabase(':memory:'));
      hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
      hub.addAdapter(fake);
    });

    it("lets every chat in a folder edit; a second model's chat only reads, at the permission picked for it", async () => {
      const first = await hub.start('fake', { ...settings, mode: 'accept-edits' }, 'Add a meter');
      const other = await hub.start('fake', settings, 'Explain it');
      expect(first.readOnly).toBeUndefined();
      expect(other.readOnly).toBeUndefined();
      expect(fake.runOf(other.id).events.readOnly()).toBeUndefined();

      const second = await alongside(first.id, 'allow-all');
      expect(second.readOnly).toEqual({ chatId: first.id, title: '' });
      expect(second.settings).toEqual({ cwd: '/work', mode: 'allow-all', model: 'small' });
      expect(fake.runOf(second.id).settings).toEqual({
        cwd: '/work',
        mode: 'allow-all',
        model: 'small',
      });
      expect(readOnlyEvents()).toEqual([
        { chatId: second.id, readOnly: { chatId: first.id, title: '' } },
      ]);
    });

    it("tells the agent why it can't edit files, naming the chat that edits, and keeps undo from it, not its permission", async () => {
      const first = await hub.start('fake', settings, 'Add a meter');
      const second = await alongside(first.id);
      const reader = fake.runOf(second.id);
      expect(fake.runOf(first.id).events.readOnly()).toBeUndefined();
      expect(reader.events.readOnly()).toMatch(
        /^Another chat is editing this project, so this chat can't edit files in it/,
      );

      fake.runOf(first.id).events.title('Context meter');
      expect(reader.events.readOnly()).toMatch(/^"Context meter" is editing this project/);
      expect(readOnlyEvents().at(-1)).toEqual({
        chatId: second.id,
        readOnly: { chatId: first.id, title: 'Context meter' },
      });

      await hub.configure(second.id, { mode: 'allow-all' });
      await hub.configure(second.id, { model: 'small' });
      expect(reader.configured).toEqual([{ mode: 'allow-all' }, { model: 'small' }]);
      reader.events.turnEnded();
      await expect(hub.undo(second.id, reader.sentIds[0]!)).rejects.toThrow(
        'make this the editing chat to undo',
      );
    });

    it('hands over to the chat sent in parallel opened first after it when the chat that edits closes', async () => {
      const first = await hub.start('fake', settings, 'One');
      const second = await alongside(first.id, 'accept-edits');
      const third = await alongside(first.id);
      sent = [];

      hub.close(first.id);
      await settle();
      expect(readOnlyEvents()).toEqual([
        { chatId: second.id, readOnly: null },
        { chatId: third.id, readOnly: { chatId: second.id, title: '' } },
      ]);
      // Their permissions stay as picked.
      expect(fake.runOf(second.id).configured).toEqual([]);
      expect(fake.runOf(third.id).configured).toEqual([]);
      expect(fake.runOf(second.id).events.readOnly()).toBeUndefined();

      // Closing one that only reads changes nothing.
      sent = [];
      hub.close(third.id);
      await settle();
      expect(readOnlyEvents()).toEqual([]);

      // The chat that closed only reads once it's open again.
      fake.transcripts.set(first.id, []);
      expect((await hub.open('fake', first.id, settings)).readOnly).toEqual({
        chatId: second.id,
        title: '',
      });
    });

    it('makes another the editing chat, leaving both live chats at their permissions', async () => {
      const first = await hub.start('fake', { ...settings, mode: 'accept-edits' }, 'One');
      const second = await alongside(first.id, 'allow-all');
      sent = [];

      hub.takeOver(second.id);
      expect(fake.runOf(first.id).events.readOnly()).toMatch(/is editing this project/);
      expect(fake.runOf(second.id).events.readOnly()).toBeUndefined();
      expect(fake.runOf(second.id).configured).toEqual([]);
      expect(fake.runOf(first.id).configured).toEqual([]);
      expect(readOnlyEvents()).toEqual([
        { chatId: first.id, readOnly: { chatId: second.id, title: '' } },
        { chatId: second.id, readOnly: null },
      ]);
      expect((await hub.open('fake', first.id, settings)).readOnly).toEqual({
        chatId: second.id,
        title: '',
      });
      expect((await hub.open('fake', second.id, settings)).readOnly).toBeUndefined();
    });

    it('keeps the chat that edits of those sent in parallel across a restart', async () => {
      fake.transcripts.set('c1', [
        { kind: 'user', id: 'u1', text: 'Add a meter' },
        reply('r1', 'Added.'),
      ]);
      fake.transcripts.set('c3', []);
      await hub.open('fake', 'c1', settings);
      const copy = await hub.parallel({ chatId: 'c1' }, 'small', 'Colour it');
      await hub.open('fake', 'c3', settings);
      hub.takeOver(copy.id);
      hub.closeAll();

      // The service starts again on the same database; the chats reopen in any order.
      sent = [];
      const again = new AgentHub(
        (event, payload) => sent.push({ event, payload } as Sent),
        50,
        store,
      );
      again.addAdapter(fake);
      const chats = await again.openChats();
      expect(chats.map((chat) => [chat.id, chat.readOnly?.chatId])).toEqual([
        ['c1', copy.id],
        [copy.id, undefined],
        ['c3', undefined],
      ]);
      again.send('c1', 'Go on');
      expect(fake.runOf('c1').events.readOnly()).toMatch(/is editing this project/);

      // Once it's closed, the chat it was sent in parallel with edits.
      again.close(copy.id);
      expect((await again.open('fake', 'c1', settings)).readOnly).toBeUndefined();
    });

    it("begins a second model's chat whose agent picks its ID only reading, at its permission", async () => {
      fake.transcripts.set('c1', []);
      await hub.open('fake', 'c1', settings);
      const picking = new PickingAdapter();
      hub.addAdapter(picking);
      const chat = await hub.parallel(
        { agent: 'fake', settings: { ...settings, mode: 'allow-all' }, alongside: 'c1' },
        'small',
        'Explain it',
      );
      expect(picking.started?.settings).toEqual({
        cwd: '/work',
        mode: 'allow-all',
        model: 'small',
      });
      expect(chat).toMatchObject({
        id: 'picked',
        readOnly: { chatId: 'c1' },
        settings: { mode: 'allow-all' },
      });
      expect(picking.started?.events.readOnly()).toMatch(/is editing this project/);
    });
  });
});
