import { homedir } from 'node:os';
import type { AgentEntry, EventName, EventPayload } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter';
import { AgentHub } from './hub';

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

describe('AgentHub', () => {
  it('starts a chat with your first message', () => {
    const chat = hub.start('fake', settings, 'Hello');

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
    const { id } = hub.start('fake', settings, 'Hello');
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

  it('sends batched text before any later event', () => {
    const { id } = hub.start('fake', settings, 'Hello');
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
    const { id } = hub.start('fake', settings, 'Make a file');
    const { events: agent } = fake.runOf(id);
    sent = [];

    const decision = agent.approval(
      { id: 'a1', tool: 'Write', input: { path: 'x' }, canAlwaysAllow: true },
      new AbortController().signal,
    );
    expect(events()).toEqual(['agents.approval', 'agents.status']);
    expect(sent[1]!.payload).toEqual({ chatId: id, status: 'waiting' });
    expect((await hub.open('fake', id, settings)).approvals).toEqual([
      { id: 'a1', chatId: id, tool: 'Write', input: { path: 'x' }, canAlwaysAllow: true },
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
    const { id } = hub.start('fake', settings, 'Make a file');
    const abort = new AbortController();
    const decision = fake
      .runOf(id)
      .events.approval({ id: 'a1', tool: 'Write', input: {}, canAlwaysAllow: false }, abort.signal);

    abort.abort();
    await expect(decision).resolves.toBe('deny');
    expect(events()).toContain('agents.approvalSettled');
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

  it('ends the turn when the agent process stops by itself, and restarts it on the next message', () => {
    const { id } = hub.start('fake', settings, 'Hello');
    fake.runOf(id).events.closed('Not signed in');

    expect(sent.at(-1)).toEqual({
      event: 'agents.turnEnded',
      payload: { chatId: id, error: 'Not signed in' },
    });
    hub.send(id, 'Again');
    expect(fake.runs).toHaveLength(2);
    expect(fake.runOf(id).resume).toBe(true);
  });

  it('closes a chat: stops its process and ignores what it still reports', () => {
    const { id } = hub.start('fake', settings, 'Hello');
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

  it('starts new chats in your home folder unless told otherwise', () => {
    expect(hub.start('fake', {}, 'Hi').settings.cwd).toBe(homedir());
  });

  it('passes interrupts to the agent', async () => {
    const { id } = hub.start('fake', settings, 'Hello');
    await hub.interrupt(id);
    expect(fake.runOf(id).interrupts).toBe(1);
  });
});
