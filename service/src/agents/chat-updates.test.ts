import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter';
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

describe('ChatUpdates', () => {
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

    expect(events()).toEqual(['agents.text', 'agents.entry', 'agents.status', 'agents.turnEnded']);
    expect(sent[2]!.payload).toEqual({ chatId: id, status: 'idle' });
  });

  it('writes how long each turn took on your message that began it', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    hub.send(id, 'Also this');
    vi.advanceTimersByTime(90_000);
    run.events.turnEnded();
    // The queued message begins the next turn, which ends when the process stops.
    vi.advanceTimersByTime(5_000);
    run.events.closed();

    const { entries } = await hub.open('fake', id, settings);
    expect(entries.map((entry) => entry.kind === 'user' && entry.took)).toEqual([90_000, 5_000]);
    expect(
      sent.find(
        (s) =>
          s.event === 'agents.entry' && s.payload.entry.kind === 'user' && s.payload.entry.took,
      ),
    ).toBeTruthy();
  });

  it('writes what the running turn has spent on your message that began it', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    const uses = [
      {
        model: 'claude-opus-5-5',
        input: 2,
        cacheWritten: 0,
        cacheWrittenLong: 10,
        cacheRead: 0,
        output: 5,
      },
    ];
    vi.advanceTimersByTime(1_000);
    run.events.tokens(uses);

    const { entries } = await hub.open('fake', id, settings);
    const yours = entries[0]!;
    expect(yours.kind === 'user' && yours.tokens).toEqual({ at: yours.at, uses });
    expect(sent.at(-1)).toMatchObject({
      event: 'agents.entry',
      payload: { entry: { id: yours.id, tokens: { uses } } },
    });
  });

  it('writes the hooks run on each turn on your message that began it, as they go', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    const lint = { id: 'h1', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit' };
    const stop = { id: 'h2', name: 'Stop', event: 'Stop' };
    run.events.hooks([{ ...lint, outcome: 'running' }]);
    run.events.hooks([
      { ...lint, outcome: 'passed', took: 400 },
      { ...stop, outcome: 'running' },
    ]);
    expect(sent.at(-1)).toMatchObject({
      event: 'agents.entry',
      payload: {
        entry: {
          kind: 'user',
          hooks: [
            { id: 'h1', outcome: 'passed' },
            { id: 'h2', outcome: 'running' },
          ],
        },
      },
    });

    run.events.turnEnded();
    hub.send(id, 'Again');
    // One begun on the turn before ends on it; one begun now goes with the new turn.
    run.events.hooks([
      { ...stop, outcome: 'blocked', took: 50 },
      { id: 'h3', name: 'UserPromptSubmit', event: 'UserPromptSubmit', outcome: 'passed' },
    ]);

    const { entries } = await hub.open('fake', id, settings);
    const yours = entries.filter((entry) => entry.kind === 'user');
    expect(yours.map((entry) => entry.hooks?.map((hook) => [hook.id, hook.outcome]))).toEqual([
      [
        ['h1', 'passed'],
        ['h2', 'blocked'],
      ],
      [['h3', 'passed']],
    ]);
    // Written on with what else the turn said.
    expect(yours[0]!.took).toBeDefined();
  });

  it('cancels the hooks still running when the process ends', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    run.events.hooks([
      { id: 'h1', name: 'Stop', event: 'Stop', outcome: 'passed' },
      {
        id: 'h2',
        name: 'PostToolUse:Edit',
        event: 'PostToolUse',
        tool: 'Edit',
        outcome: 'running',
      },
    ]);
    run.events.closed();

    const { entries } = await hub.open('fake', id, settings);
    const yours = entries.find((entry) => entry.kind === 'user');
    expect(yours?.hooks?.map((hook) => [hook.id, hook.outcome])).toEqual([
      ['h1', 'passed'],
      ['h2', 'cancelled'],
    ]);
  });

  it("keeps what a subagent does as it goes, apart from the chat's transcript, and tells every window", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    run.events.subagentEntry('toolu_1', reply('h1', 'Looking'));
    run.events.subagentEntry('toolu_1', reply('h1', 'Looking around'));
    run.events.subagentEntry('toolu_1', reply('h2', 'Found it'));

    expect(await hub.subagent(id, 'toolu_1')).toMatchObject({
      entries: [
        { id: 'h1', blocks: [{ text: 'Looking around' }] },
        { id: 'h2', blocks: [{ text: 'Found it' }] },
      ],
    });
    expect((await hub.open('fake', id, settings)).entries.map((entry) => entry.id)).not.toContain(
      'h1',
    );
    expect(sent.at(-1)).toMatchObject({
      event: 'agents.subagentEntry',
      payload: { chatId: id, toolId: 'toolu_1', entry: { id: 'h2' } },
    });
  });

  it('keeps where a subagent is with its task, tells every window, and stops those at work with the process', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    run.events.subagentState('toolu_1', 'working');
    expect(sent.at(-1)).toEqual({
      event: 'agents.subagentState',
      payload: { chatId: id, toolId: 'toolu_1', state: 'working' },
    });
    expect(await hub.subagent(id, 'toolu_1')).toEqual({ entries: [], state: 'working' });

    run.events.subagentEntry('toolu_1', reply('h1', 'Found it'));
    run.events.subagentState('toolu_2', 'working');
    run.events.subagentState('toolu_2', 'done');
    expect(await hub.subagent(id, 'toolu_1')).toMatchObject({
      entries: [{ id: 'h1' }],
      state: 'working',
    });
    expect(await hub.subagent(id, 'toolu_2')).toEqual({ entries: [], state: 'done' });

    run.events.closed();
    expect(sent.filter((s) => s.event === 'agents.subagentState').at(-1)).toEqual({
      event: 'agents.subagentState',
      payload: { chatId: id, toolId: 'toolu_1', state: 'stopped' },
    });
    expect((await hub.subagent(id, 'toolu_2')).state).toBe('done');
  });
});
