import { homedir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database';
import { hubStore } from './chat-table';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, reply, settings } from './hub-testing';

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

  it("reads a saved subagent's run from the agent, and has none it kept no record of", async () => {
    fake.subagents.set('toolu_9', { entries: [reply('h9', 'Done earlier')], state: 'done' });
    await hub.open('fake', 'c1', settings);

    expect(await hub.subagent('c1', 'toolu_9')).toMatchObject({
      entries: [{ id: 'h9' }],
      state: 'done',
    });
    expect(await hub.subagent('c1', 'toolu_0')).toEqual({ entries: [] });
    await expect(hub.subagent('closed', 'toolu_9')).rejects.toThrow('This chat is not open');
  });

  it("reads a subagent whose work didn't come live as saved, where it is as it came live", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.subagents.set('toolu_s', { entries: [reply('h1', 'Resumed')], state: 'done' });
    fake.runOf(id).events.subagentState('toolu_s', 'working');

    expect(await hub.subagent(id, 'toolu_s')).toMatchObject({
      entries: [{ id: 'h1' }],
      state: 'working',
    });
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

  it('remembers the open chats, and reopens them after a restart', async () => {
    const store = hubStore(openDatabase(':memory:'));
    const { chats } = store;
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
    chats.add({ chatId: 'gone', agent: 'unknown-agent', settings });
    const reopened = await restarted.openChats();
    expect(reopened).toMatchObject([
      { id: started.id, status: 'idle', entries: [{ text: 'Hello' }] },
      { id: 'saved', status: 'idle', entries: [{ text: 'Earlier' }] },
    ]);
    expect(chats.list().map((c) => c.chatId)).toEqual([started.id, 'saved']);
  });

  it("changes a chat's model and permission, live and for after a restart", async () => {
    const store = hubStore(openDatabase(':memory:'));
    const { chats } = store;
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    await hub.configure(id, { model: 'small', mode: 'plan' });
    expect(fake.runOf(id).configured).toEqual([{ model: 'small', mode: 'plan' }]);
    expect(sent).toEqual([
      {
        event: 'agents.settings',
        payload: { chatId: id, settings: { ...settings, model: 'small', mode: 'plan' } },
      },
    ]);
    expect(chats.list()[0]?.settings).toEqual({ ...settings, model: 'small', mode: 'plan' });
  });

  it("turns a chat's MCP servers off from its next turn, starting its process again", async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    const working = fake.runOf(id);
    sent = [];

    // While a turn runs, the process stays until it ends.
    await hub.configure(id, { mcpOff: ['github'] });
    expect(working.configured).toEqual([]);
    expect(working.closed).toBe(false);
    expect(sent).toEqual([
      {
        event: 'agents.settings',
        payload: { chatId: id, settings: { ...settings, mcpOff: ['github'] } },
      },
    ]);
    expect(store.chats.list()[0]?.settings).toEqual({ ...settings, mcpOff: ['github'] });
    working.events.turnEnded();
    expect(working.closed).toBe(true);
    hub.send(id, 'Again');
    expect(fake.runOf(id)).toMatchObject({
      resume: true,
      settings: { mcpOff: ['github'] },
      sent: ['Again'],
    });

    // The same servers again leave the process be; none off drops the setting.
    const again = fake.runOf(id);
    again.events.turnEnded();
    await hub.configure(id, { mcpOff: ['github'] });
    expect(again.closed).toBe(false);
    await hub.configure(id, { mcpOff: [] });
    expect(again.closed).toBe(true);
    expect(store.chats.list()[0]?.settings).toEqual(settings);

    // Those off in every chat changed: every open chat starts again, as soon as no turn runs.
    hub.send(id, 'Once more');
    const third = fake.runOf(id);
    third.events.turnEnded();
    hub.mcpChanged();
    expect(third.closed).toBe(true);
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

  it("passes on the agent's plan, and reopens a chat with it", async () => {
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

  it("undoes a message's edits and those after it, and remembers them after a restart", async () => {
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
    expect(sent).toEqual([
      { event: 'agents.withdrawn', payload: { chatId: id, withdrawn: later } },
    ]);
    expect((await hub.open('fake', id, settings)).withdrawn).toEqual(later);
    await expect(hub.undo(id, run.sentIds[2]!)).rejects.toThrow('already undone');

    // After a restart the chat has no process: undo starts one, resumed.
    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    fake.transcripts.set(
      id,
      run.sentIds.map((entryId, i) => ({ kind: 'user', id: entryId, text: `${i}` })),
    );
    expect((await restarted.open('fake', id, settings)).withdrawn).toEqual(later);
    await restarted.undo(id, run.sentIds[0]!);
    expect(fake.runOf(id)).toMatchObject({ resume: true, undone: [run.sentIds[0]] });
    expect((await restarted.open('fake', id, settings)).withdrawn).toEqual([
      ...later,
      run.sentIds[0],
    ]);
  });

  it("withdraws nothing when the agent can't undo", async () => {
    const { id } = await hub.start('fake', settings, 'First');
    fake.runOf(id).events.turnEnded();
    fake.undoError = 'No checkpoint for this entry';
    await expect(hub.undo(id, fake.runOf(id).sentIds[0]!)).rejects.toThrow('No checkpoint');
    expect((await hub.open('fake', id, settings)).withdrawn).toEqual([]);
  });

  it('renames chats with the agent, and starts them with a title', async () => {
    const { id } = await hub.start('fake', settings, 'Hello', '  Login bug ');
    expect(fake.runOf(id).title).toBe('Login bug');
    expect((await hub.open('fake', id, settings)).title).toBe('Login bug');
    sent = [];

    await hub.rename(id, ' Flaky login test ');
    expect(fake.renamed.get(id)).toBe('Flaky login test');
    expect(sent).toEqual([
      { event: 'agents.title', payload: { chatId: id, title: 'Flaky login test' } },
    ]);
    expect((await hub.open('fake', id, settings)).title).toBe('Flaky login test');
    await expect(hub.rename(id, '  ')).rejects.toThrow('A chat needs a title');
    await expect(hub.rename('missing', 'x')).rejects.toThrow('This chat is not open');
  });

  it('opens a saved chat with what its last reply left in the prompt cache', async () => {
    fake.transcripts.set('c1', []);
    fake.caches.set('c1', { tokens: 283_000, until: 1_000 });
    expect((await hub.open('fake', 'c1', settings)).cache).toEqual({
      tokens: 283_000,
      until: 1_000,
    });
  });

  it("glances at an open chat's status, cache and agent, and at nothing once it's closed", async () => {
    fake.transcripts.set('c1', []);
    fake.caches.set('c1', { tokens: 50_000, until: 1_000 });
    await hub.open('fake', 'c1', settings);

    expect(hub.glance('c1')).toEqual({
      status: 'idle',
      capabilities: [],
      cache: { tokens: 50_000, until: 1_000 },
    });
    hub.close('c1');
    expect(hub.glance('c1')).toBeUndefined();
  });
});
