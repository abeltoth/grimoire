import { homedir } from 'node:os';
import type { AgentEntry, EventName, EventPayload } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database';
import type { ChatEvents, LiveChat } from './adapter';
import { FakeAdapter } from './fake-adapter';
import { AgentHub, hubStore } from './hub';

type Sent = { [K in EventName]: { event: K; payload: EventPayload<K> } }[EventName];

const settings = { cwd: '/work' };
const reply = (id: string, text = ''): AgentEntry => ({
  kind: 'agent',
  id,
  blocks: [{ kind: 'text', text }],
});

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

/** An agent that picks a new chat's ID itself, as Claude Code does on a spare process. */
class PickingAdapter extends FakeAdapter {
  started?: {
    text: string;
    id: string;
    events: ChatEvents;
    live: LiveChat & { closed: boolean };
  };
  disposed = false;

  async start(
    chatSettings: typeof settings,
    text: string,
    id: string,
    bind: (chatId: string) => ChatEvents,
  ) {
    await Promise.resolve();
    const live = {
      closed: false,
      send() {},
      interrupt: async () => {},
      configure: async () => {},
      close: () => void (live.closed = true),
    };
    this.started = { text, id, events: bind('picked'), live };
    return live;
  }

  dispose() {
    this.disposed = true;
  }
}

describe('AgentHub', () => {
  it('starts a chat with your first message', async () => {
    const chat = await hub.start('fake', settings, 'Hello');

    expect(chat.status).toBe('thinking');
    expect(chat.entries).toEqual([
      { kind: 'user', id: expect.any(String), text: 'Hello', at: expect.any(Number) },
    ]);
    expect(chat.title).toBe('');
    const run = fake.runOf(chat.id);
    expect(run).toMatchObject({ resume: false, settings, sent: ['Hello'] });
    expect(events()).toEqual(['agents.entry', 'agents.status']);
  });

  it('batches streamed text, and keeps it in the transcript', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const { events: agent } = fake.runOf(id);
    agent.entry(reply('r1'));
    sent = [];

    agent.text('r1', 0, 'Hel');
    agent.text('r1', 0, 'lo ');
    agent.text('r1', 0, 'there');
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(50);
    expect(sent).toEqual([
      {
        event: 'agents.text',
        payload: { chatId: id, entryId: 'r1', block: 0, text: 'Hello there' },
      },
    ]);
    await expect(hub.open('fake', id, settings)).resolves.toMatchObject({
      entries: [{}, reply('r1', 'Hello there')],
    });
  });

  it('sends batched text before any later event', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const { events: agent } = fake.runOf(id);
    agent.entry(reply('r1'));
    agent.status('writing');
    sent = [];

    agent.text('r1', 0, 'Done');
    agent.turnEnded();

    expect(events()).toEqual(['agents.text', 'agents.status', 'agents.turnEnded']);
    expect(sent[1]!.payload).toEqual({ chatId: id, status: 'idle' });
  });

  it('waits for your decision on an approval', async () => {
    const { id } = await hub.start('fake', settings, 'Make a file');
    const { events: agent } = fake.runOf(id);
    sent = [];

    const decision = agent.approval(
      { id: 'a1', tool: 'Write', input: { path: 'x' }, alwaysAllow: { scope: 'project' } },
      new AbortController().signal,
    );
    expect(events()).toEqual(['agents.approval', 'agents.status']);
    expect(sent[1]!.payload).toEqual({ chatId: id, status: 'waiting' });
    expect((await hub.open('fake', id, settings)).approvals).toEqual([
      {
        id: 'a1',
        chatId: id,
        tool: 'Write',
        input: { path: 'x' },
        alwaysAllow: { scope: 'project' },
        at: expect.any(Number),
      },
    ]);

    // The agent's own status updates don't hide that it waits for you.
    agent.status('writing');
    expect(events()).toHaveLength(2);

    hub.decide('a1', 'allow-always');
    await expect(decision).resolves.toBe('allow-always');
    expect(events().slice(2)).toEqual(['agents.approvalSettled', 'agents.status']);
    expect(() => hub.decide('a1', 'deny')).toThrow('no longer pending');
  });

  it('drops an approval the agent stops waiting for', async () => {
    const { id } = await hub.start('fake', settings, 'Make a file');
    const abort = new AbortController();
    const decision = fake
      .runOf(id)
      .events.approval({ id: 'a1', tool: 'Write', input: {} }, abort.signal);

    abort.abort();
    await expect(decision).resolves.toBe('deny');
    expect(events()).toContain('agents.approvalSettled');
  });

  it('takes your answers to an approval that asks questions', async () => {
    const { id } = await hub.start('fake', settings, 'Build it');
    const questions = [
      { question: 'Where?', options: [{ label: 'Here' }, { label: 'There' }], multiSelect: false },
    ];
    const verdict = fake
      .runOf(id)
      .events.approval(
        { id: 'q1', tool: 'Ask', input: {}, questions },
        new AbortController().signal,
      );

    expect(() => hub.decide('q1', 'allow-once')).toThrow('answer them instead');
    expect(() => hub.answer('q1', [])).toThrow('Expected 1 answers, got 0');
    hub.answer('q1', [{ chosen: ['Here'], ownWords: 'near the top' }]);
    await expect(verdict).resolves.toEqual({
      answers: [{ chosen: ['Here'], ownWords: 'near the top' }],
    });
    expect(() => hub.answer('q1', [{ chosen: [] }])).toThrow('no longer pending');
  });

  it('opens a saved chat once, and continues it when you send', async () => {
    fake.transcripts.set('c1', [{ kind: 'user', id: 'u1', text: 'Earlier' }]);

    const first = await hub.open('fake', 'c1', settings);
    await hub.open('fake', 'c1', settings);
    expect(first).toMatchObject({ id: 'c1', status: 'idle', entries: [{ text: 'Earlier' }] });
    expect(fake.transcriptLoads).toBe(1);
    expect(fake.runs).toEqual([]);

    hub.send('c1', 'And now?');
    expect(fake.runOf('c1')).toMatchObject({ resume: true, sent: ['And now?'] });
  });

  it('ends the turn when the agent process stops by itself, and restarts it on the next message', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.runOf(id).events.closed('Not signed in');

    expect(sent.at(-1)).toEqual({
      event: 'agents.turnEnded',
      payload: { chatId: id, error: 'Not signed in' },
    });
    hub.send(id, 'Again');
    expect(fake.runs).toHaveLength(2);
    expect(fake.runOf(id).resume).toBe(true);
  });

  it('closes a chat: stops its process and ignores what it still reports', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    hub.close(id);
    sent = [];

    run.events.entry(reply('late'));
    expect(run.closed).toBe(true);
    expect(sent).toEqual([]);
    expect(() => hub.send(id, 'Hi')).toThrow('not open');
  });

  it('opens a chat with its title, and passes on new titles', async () => {
    fake.chats = [{ id: 'c1', agent: 'fake', title: 'Earlier chat', updatedAt: 0 }];
    expect((await hub.open('fake', 'c1', settings)).title).toBe('Earlier chat');

    hub.send('c1', 'Hi');
    const { events: agent } = fake.runOf('c1');
    agent.title('Renamed');
    agent.title('Renamed');
    expect(sent.filter((s) => s.event === 'agents.title')).toEqual([
      { event: 'agents.title', payload: { chatId: 'c1', title: 'Renamed' } },
    ]);
  });

  it('starts new chats in your home folder unless told otherwise', async () => {
    expect((await hub.start('fake', {}, 'Hi')).settings.cwd).toBe(homedir());
  });

  it('remembers the open chats, and reopens them after a restart', async () => {
    const store = hubStore(openDatabase(':memory:'));
    const { chapters } = store;
    hub = new AgentHub(() => {}, 50, store);
    hub.addAdapter(fake);
    fake.transcripts.set('saved', [{ kind: 'user', id: 'u1', text: 'Earlier' }]);
    const started = await hub.start('fake', settings, 'Hello');
    await hub.open('fake', 'saved', settings);
    const closed = await hub.start('fake', settings, 'Bye');
    hub.close(closed.id);
    hub.closeAll();
    expect(fake.runOf(started.id).closed).toBe(true);

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    fake.transcripts.set(started.id, [{ kind: 'user', id: 'u2', text: 'Hello' }]);
    chapters.add({ chatId: 'gone', agent: 'unknown-agent', settings });
    const chats = await restarted.openChats();
    expect(chats).toMatchObject([
      { id: started.id, status: 'idle', entries: [{ text: 'Hello' }] },
      { id: 'saved', status: 'idle', entries: [{ text: 'Earlier' }] },
    ]);
    expect(chapters.list().map((c) => c.chatId)).toEqual([started.id, 'saved']);
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

  it('changes a chat\'s model and permission, live and for after a restart', async () => {
    const store = hubStore(openDatabase(':memory:'));
    const { chapters } = store;
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    await hub.configure(id, { model: 'small', mode: 'plan' });
    expect(fake.runOf(id).configured).toEqual([{ model: 'small', mode: 'plan' }]);
    expect(sent).toEqual([
      { event: 'agents.settings', payload: { chatId: id, settings: { ...settings, model: 'small', mode: 'plan' } } },
    ]);
    expect(chapters.list()[0]?.settings).toEqual({ ...settings, model: 'small', mode: 'plan' });
  });

  it('lists the folders chats ran in, most recent first', async () => {
    fake.chats = [
      { id: 'a', agent: 'fake', title: '', cwd: '/old', updatedAt: 1 },
      { id: 'b', agent: 'fake', title: '', cwd: '/new', updatedAt: 3 },
      { id: 'c', agent: 'fake', title: '', updatedAt: 4 },
      { id: 'd', agent: 'fake', title: '', cwd: '/new', updatedAt: 2 },
    ];
    expect(await hub.folders()).toEqual({ home: homedir(), recent: ['/new', '/old'] });
    expect((await hub.commands('fake', '/work')).map((c) => `${c.kind} ${c.name}`)).toEqual([
      'command compact',
      'skill simplify',
    ]);
    await hub.commands('fake');
    expect(fake.commandFolders).toEqual(['/work', homedir()]);
    expect((await hub.models('fake')).default).toBe('big');
  });

  it('passes on the agent\'s plan, and reopens a chat with it', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const plan = [{ text: 'Read the code', status: 'active' as const }];
    fake.runOf(id).events.plan(plan);
    expect(sent.at(-1)).toEqual({ event: 'agents.plan', payload: { chatId: id, plan } });
    expect((await hub.open('fake', id, settings)).plan).toEqual(plan);

    fake.plans.set('saved', [{ text: 'Earlier step', status: 'done' }]);
    expect((await hub.open('fake', 'saved', settings)).plan).toEqual([
      { text: 'Earlier step', status: 'done' },
    ]);
  });

  it('undoes an entry\'s edits and those after it, and remembers them after a restart', async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'First');
    const run = fake.runOf(id);
    run.events.turnEnded();
    hub.send(id, 'Second');
    await expect(hub.undo(id, run.sentIds[0]!)).rejects.toThrow('Stop the turn before undoing');
    run.events.turnEnded();
    hub.send(id, 'Third');
    run.events.turnEnded();
    sent = [];

    await hub.undo(id, run.sentIds[1]!);
    expect(run.undone).toEqual([run.sentIds[1]]);
    const later = run.sentIds.slice(1);
    expect(sent).toEqual([{ event: 'agents.withdrawn', payload: { chatId: id, withdrawn: later } }]);
    expect((await hub.open('fake', id, settings)).withdrawn).toEqual(later);
    await expect(hub.undo(id, run.sentIds[2]!)).rejects.toThrow('already undone');

    // After a restart the chat has no process: undo starts one, resumed.
    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    fake.transcripts.set(id, run.sentIds.map((entryId, i) => ({ kind: 'user', id: entryId, text: `${i}` })));
    expect((await restarted.open('fake', id, settings)).withdrawn).toEqual(later);
    await restarted.undo(id, run.sentIds[0]!);
    expect(fake.runOf(id)).toMatchObject({ resume: true, undone: [run.sentIds[0]] });
    expect((await restarted.open('fake', id, settings)).withdrawn).toEqual([...later, run.sentIds[0]]);
  });

  it('withdraws nothing when the agent can\'t undo', async () => {
    const { id } = await hub.start('fake', settings, 'First');
    fake.runOf(id).events.turnEnded();
    fake.undoError = 'No checkpoint for this entry';
    await expect(hub.undo(id, fake.runOf(id).sentIds[0]!)).rejects.toThrow('No checkpoint');
    expect((await hub.open('fake', id, settings)).withdrawn).toEqual([]);
  });

  it('forks a chat after an entry\'s turn into the next free variant, and opens it', async () => {
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

  it('marks a fork\'s entries as copied, which can\'t be undone', async () => {
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
    await expect(hub.undo(variant.id, 'u1')).rejects.toThrow("can't be undone");

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    expect((await restarted.open('fake', variant.id, settings)).copied).toEqual(['u1', 'u2']);
  });

  it('renames chats with the agent, and starts them with a title', async () => {
    const { id } = await hub.start('fake', settings, 'Hello', '  Login bug ');
    expect(fake.runOf(id).title).toBe('Login bug');
    expect((await hub.open('fake', id, settings)).title).toBe('Login bug');
    sent = [];

    await hub.rename(id, ' Flaky login test ');
    expect(fake.renamed.get(id)).toBe('Flaky login test');
    expect(sent).toEqual([{ event: 'agents.title', payload: { chatId: id, title: 'Flaky login test' } }]);
    expect((await hub.open('fake', id, settings)).title).toBe('Flaky login test');
    await expect(hub.rename(id, '  ')).rejects.toThrow('A chapter needs a title');
    await expect(hub.rename('missing', 'x')).rejects.toThrow('This chat is not open');
  });

  it('pins and stars chats with dog-ears, kept across restarts', async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    hub.dogEar(id, 'star', true);
    hub.dogEar(id, 'pin', true);
    hub.dogEar(id, 'star', false);
    expect(sent.map((s) => s.payload)).toEqual([
      { chatId: id, dogEars: ['star'] },
      { chatId: id, dogEars: ['pin', 'star'] },
      { chatId: id, dogEars: ['pin'] },
    ]);
    expect((await hub.open('fake', id, settings)).dogEars).toEqual(['pin']);
    fake.chats = [
      { id, agent: 'fake', title: 'Pinned', updatedAt: 0 },
      { id: 'other', agent: 'fake', title: 'Plain', updatedAt: 1 },
    ];
    expect((await hub.listChats('fake')).map((chat) => chat.dogEars)).toEqual([['pin'], []]);

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    expect((await restarted.open('fake', id, settings)).dogEars).toEqual(['pin']);
  });

  it('passes interrupts to the agent', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    expect(await hub.interrupt(id)).toEqual([]);
    expect(fake.runOf(id).interrupts).toBe(1);
  });

  it('queues messages sent during a turn and sends the next when it ends', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    hub.send(id, 'Also this');
    hub.send(id, 'And that');
    expect(run.sent).toEqual(['Hello']);
    const queued = () => sent.filter((s) => s.event === 'agents.queued').at(-1)!.payload;
    expect(queued()).toEqual({
      chatId: id,
      queued: [
        { id: expect.any(String), text: 'Also this' },
        { id: expect.any(String), text: 'And that' },
      ],
    });
    expect((await hub.open('fake', id, settings)).queued).toHaveLength(2);

    run.events.turnEnded();
    expect(run.sent).toEqual(['Hello', 'Also this']);
    expect((await hub.open('fake', id, settings)).status).toBe('thinking');
    expect(queued()).toEqual({
      chatId: id,
      queued: [{ id: expect.any(String), text: 'And that' }],
    });
  });

  it('passes on how full the context window is', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.runOf(id).events.context({ used: 62_000, limit: 100_000 });
    expect(sent.at(-1)).toEqual({
      event: 'agents.context',
      payload: { chatId: id, context: { used: 62_000, limit: 100_000 } },
    });
    expect((await hub.open('fake', id, settings)).context).toEqual({ used: 62_000, limit: 100_000 });
  });

  it('takes a message out of the queue, and Stop withdraws the rest', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    hub.send(id, 'One');
    hub.send(id, 'Two');
    hub.send(id, 'Three');
    const [one, two, three] = (await hub.open('fake', id, settings)).queued;

    expect(hub.unqueue(id, two!.id)).toBe(true);
    expect(hub.unqueue(id, two!.id)).toBe(false);
    expect(await hub.interrupt(id)).toEqual([one, three]);
    expect(sent.at(-1)).toEqual({ event: 'agents.queued', payload: { chatId: id, queued: [] } });

    run.events.turnEnded();
    expect(run.sent).toEqual(['Hello']);
  });
});
