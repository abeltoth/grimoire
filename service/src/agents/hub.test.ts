import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentEntry, AgentSetup, ChatSettings, EventName, EventPayload, HookRun, SettingsChange } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveProfile } from '../storage/app-state';
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
    settings: typeof settings;
    text: string;
    id: string;
    events: ChatEvents;
    live: LiveChat & { closed: boolean; configured: SettingsChange[] };
  };
  disposed = false;
  /** When set, the agent names the chat once it settles. */
  gate?: Promise<void>;

  async start(
    chatSettings: typeof settings,
    text: string,
    id: string,
    bind: (chatId: string) => ChatEvents,
  ) {
    await (this.gate ?? Promise.resolve());
    const live = {
      closed: false,
      configured: [] as SettingsChange[],
      send() {},
      interrupt: async () => {},
      configure: async (change: SettingsChange) => void live.configured.push(change),
      close: () => void (live.closed = true),
    };
    this.started = { settings: chatSettings, text, id, events: bind('picked'), live };
    return live;
  }

  dispose() {
    this.disposed = true;
  }
}

/** An agent you can sign in to another account; the test finishes the sign-in. */
class SigningAdapter extends FakeAdapter {
  signedInAs = 'me@example.com';
  signingIn?: {
    email: string;
    page: (url: string) => void;
    codes: string[];
    finish: () => void;
    cancelled: boolean;
  };

  async account() {
    return { email: this.signedInAs, plan: 'pro', expiresAt: null };
  }

  signIn(email: string, page: (url: string) => void) {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      finish = () => {
        this.signedInAs = email;
        resolve();
      };
      fail = reject;
    });
    const signingIn = { email, page, codes: [] as string[], finish, cancelled: false };
    this.signingIn = signingIn;
    return {
      done,
      code: (code: string) => void signingIn.codes.push(code),
      cancel: () => {
        signingIn.cancelled = true;
        fail(new Error('The sign-in was cancelled'));
      },
    };
  }
}

/** Lets the hub's promises settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('AgentHub', () => {
  it('asks the agent what it loads in a folder, your home folder when none is given', async () => {
    const asked: string[] = [];
    const told = Object.assign(new FakeAdapter(), {
      setup: async (cwd: string) => {
        asked.push(cwd);
        return { cwd, sections: {} as AgentSetup['sections'], settingsFiles: [], at: 1 };
      },
    });
    hub.addAdapter(told);
    expect(await hub.setup('fake', 'C:/work')).toMatchObject({ cwd: 'C:/work' });
    await hub.setup('fake');
    expect(asked).toEqual(['C:/work', homedir()]);
  });

  it('asks the agent for the memories it keeps in a folder, and has none for one that keeps none', async () => {
    expect(await hub.memories('fake', 'C:/work')).toBeNull();
    const keeping = Object.assign(new FakeAdapter(), {
      memories: async (cwd: string) => ({
        cwd,
        folder: 'C:/mem',
        index: { path: 'C:/mem/MEMORY.md', exists: false },
        enabled: true,
        memories: [],
        problems: [],
        elsewhere: [],
        at: 1,
      }),
    });
    hub.addAdapter(keeping);
    expect(await hub.memories('fake')).toMatchObject({ cwd: homedir(), folder: 'C:/mem' });
  });

  it("has no setup to show for an agent that can't say", async () => {
    expect(await hub.setup('fake', 'C:/work')).toBeNull();
  });

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

  it('starts a chat on Auto on the model and effort picked for its first message', async () => {
    fake.picks.set('Fix the ribbon', { model: 'small', effort: 'low' });
    const chat = await hub.start('fake', { ...settings, autoModel: true, model: 'big', effort: 'max' }, 'Fix the ribbon');
    expect(chat.settings).toEqual({ cwd: '/work', autoModel: true, model: 'small', effort: 'low' });
    expect(fake.runOf(chat.id).settings).toMatchObject({ model: 'small', effort: 'low' });

    // When nothing is picked, it runs on the agent's defaults.
    const unpicked = await hub.start('fake', { ...settings, autoModel: true, model: 'small' }, 'Hello');
    expect(unpicked.settings).toEqual({ cwd: '/work', autoModel: true });

    // Picking another model ends Auto; another effort doesn't.
    await hub.configure(chat.id, { effort: 'medium' });
    expect((await hub.open('fake', chat.id, settings)).settings).toMatchObject({ autoModel: true, effort: 'medium' });
    await hub.configure(chat.id, { model: 'big' });
    expect((await hub.open('fake', chat.id, settings)).settings).toEqual({
      cwd: '/work',
      model: 'big',
      effort: 'medium',
    });
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
    expect(sent.find((s) => s.event === 'agents.entry' && s.payload.entry.kind === 'user' && s.payload.entry.took)).toBeTruthy();
  });

  it('writes what the running turn has spent on your message that began it', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    const uses = [{ model: 'claude-opus-5-5', input: 2, cacheWritten: 0, cacheWrittenLong: 10, cacheRead: 0, output: 5 }];
    vi.advanceTimersByTime(1_000);
    run.events.tokens(uses);

    const { entries } = await hub.open('fake', id, settings);
    const yours = entries[0]!;
    expect(yours.kind === 'user' && yours.tokens).toEqual({ at: yours.at, uses });
    expect(sent.at(-1)).toMatchObject({ event: 'agents.entry', payload: { entry: { id: yours.id, tokens: { uses } } } });
  });

  it('writes the hooks run on each turn on your message that began it, as they go', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    const lint = { id: 'h1', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit' };
    const stop = { id: 'h2', name: 'Stop', event: 'Stop' };
    run.events.hooks([{ ...lint, outcome: 'running' }]);
    run.events.hooks([{ ...lint, outcome: 'passed', took: 400 }, { ...stop, outcome: 'running' }]);
    expect(sent.at(-1)).toMatchObject({
      event: 'agents.entry',
      payload: { entry: { kind: 'user', hooks: [{ id: 'h1', outcome: 'passed' }, { id: 'h2', outcome: 'running' }] } },
    });

    run.events.turnEnded();
    hub.send(id, 'Again');
    // One begun on the turn before ends on it; one begun now goes with the new turn.
    run.events.hooks([{ ...stop, outcome: 'blocked', took: 50 }, { id: 'h3', name: 'UserPromptSubmit', event: 'UserPromptSubmit', outcome: 'passed' }]);

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
      { id: 'h2', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit', outcome: 'running' },
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
    expect((await hub.open('fake', id, settings)).entries.map((entry) => entry.id)).not.toContain('h1');
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
    expect(await hub.subagent(id, 'toolu_1')).toMatchObject({ entries: [{ id: 'h1' }], state: 'working' });
    expect(await hub.subagent(id, 'toolu_2')).toEqual({ entries: [], state: 'done' });

    run.events.closed();
    expect(sent.filter((s) => s.event === 'agents.subagentState').at(-1)).toEqual({
      event: 'agents.subagentState',
      payload: { chatId: id, toolId: 'toolu_1', state: 'stopped' },
    });
    expect((await hub.subagent(id, 'toolu_2')).state).toBe('done');
  });

  it("reads a saved subagent's run from the agent, and has none it kept no record of", async () => {
    fake.subagents.set('toolu_9', { entries: [reply('h9', 'Done earlier')], state: 'done' });
    await hub.open('fake', 'c1', settings);

    expect(await hub.subagent('c1', 'toolu_9')).toMatchObject({ entries: [{ id: 'h9' }], state: 'done' });
    expect(await hub.subagent('c1', 'toolu_0')).toEqual({ entries: [] });
    await expect(hub.subagent('closed', 'toolu_9')).rejects.toThrow('This chat is not open');
  });

  it("reads a subagent whose work didn't come live as saved, where it is as it came live", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.subagents.set('toolu_s', { entries: [reply('h1', 'Resumed')], state: 'done' });
    fake.runOf(id).events.subagentState('toolu_s', 'working');

    expect(await hub.subagent(id, 'toolu_s')).toMatchObject({ entries: [{ id: 'h1' }], state: 'working' });
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

  describe('sending one entry to two models', () => {
    const begun = async (cwd: string) => {
      fake.transcripts.set('c1', [{ kind: 'user', id: 'u1', text: 'Add a meter' }, reply('r1', 'Added.')]);
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
      expect(fake.runOf('c1')).toMatchObject({ resume: true, sent: ['Colour it'], settings: { cwd: '/work' } });
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
      await expect(hub.parallel({ chatId: 'c1' }, 'small', 'Bigger')).rejects.toThrow('Wait for the turn to end');
    });

    it('begins the second afresh for a new chat, its title a variant of the first', async () => {
      fake.chats = [{ id: 'c1', agent: 'fake', title: 'Login bug', cwd: '/work', updatedAt: 1 }];
      const second = await hub.parallel(
        { agent: 'fake', settings: { ...settings, mode: 'plan' }, title: 'Login bug', alongside: 'c0' },
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

      const untitled = await hub.parallel({ agent: 'fake', settings: { cwd: '/plain' }, alongside: 'c0' }, 'small', 'Fix it');
      expect(untitled).toMatchObject({ title: '', settings: { cwd: '/plain', model: 'small' } });
    });
  });

  describe('one chat editing of those sent one entry in parallel', () => {
    const readOnlyEvents = () => sent.flatMap((s) => (s.event === 'agents.readOnly' ? [s.payload] : []));
    /** Lets the hub take in what was just settled. */
    const settle = () => vi.advanceTimersByTimeAsync(0);
    /** A second model's chat, begun afresh alongside `chatId`, at `mode`. */
    const alongside = (chatId: string, mode?: ChatSettings['mode']) =>
      hub.parallel({ agent: 'fake', settings: { ...settings, ...(mode ? { mode } : {}) }, alongside: chatId }, 'small', 'Too');
    let store: ReturnType<typeof hubStore>;

    beforeEach(() => {
      store = hubStore(openDatabase(':memory:'));
      hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
      hub.addAdapter(fake);
    });

    it('lets every chat in a folder edit; a second model\'s chat only reads, at the permission picked for it', async () => {
      const first = await hub.start('fake', { ...settings, mode: 'accept-edits' }, 'Add a meter');
      const other = await hub.start('fake', settings, 'Explain it');
      expect(first.readOnly).toBeUndefined();
      expect(other.readOnly).toBeUndefined();
      expect(fake.runOf(other.id).events.readOnly()).toBeUndefined();

      const second = await alongside(first.id, 'allow-all');
      expect(second.readOnly).toEqual({ chatId: first.id, title: '' });
      expect(second.settings).toEqual({ cwd: '/work', mode: 'allow-all', model: 'small' });
      expect(fake.runOf(second.id).settings).toEqual({ cwd: '/work', mode: 'allow-all', model: 'small' });
      expect(readOnlyEvents()).toEqual([{ chatId: second.id, readOnly: { chatId: first.id, title: '' } }]);
    });

    it("tells the agent why it can't edit files, naming the chat that edits, and keeps undo from it, not its permission", async () => {
      const first = await hub.start('fake', settings, 'Add a meter');
      const second = await alongside(first.id);
      const reader = fake.runOf(second.id);
      expect(fake.runOf(first.id).events.readOnly()).toBeUndefined();
      expect(reader.events.readOnly()).toMatch(/^Another chat is editing this project, so this chat can't edit files in it/);

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
      await expect(hub.undo(second.id, reader.sentIds[0]!)).rejects.toThrow('make this the editing chat to undo');
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
      expect((await hub.open('fake', first.id, settings)).readOnly).toEqual({ chatId: second.id, title: '' });
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
      expect((await hub.open('fake', first.id, settings)).readOnly).toEqual({ chatId: second.id, title: '' });
      expect((await hub.open('fake', second.id, settings)).readOnly).toBeUndefined();
    });

    it('keeps the chat that edits of those sent in parallel across a restart', async () => {
      fake.transcripts.set('c1', [{ kind: 'user', id: 'u1', text: 'Add a meter' }, reply('r1', 'Added.')]);
      fake.transcripts.set('c3', []);
      await hub.open('fake', 'c1', settings);
      const copy = await hub.parallel({ chatId: 'c1' }, 'small', 'Colour it');
      await hub.open('fake', 'c3', settings);
      hub.takeOver(copy.id);
      hub.closeAll();

      // The service starts again on the same database; the chats reopen in any order.
      sent = [];
      const again = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
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

    it('begins a second model\'s chat whose agent picks its ID only reading, at its permission', async () => {
      fake.transcripts.set('c1', []);
      await hub.open('fake', 'c1', settings);
      const picking = new PickingAdapter();
      hub.addAdapter(picking);
      const chat = await hub.parallel(
        { agent: 'fake', settings: { ...settings, mode: 'allow-all' }, alongside: 'c1' },
        'small',
        'Explain it',
      );
      expect(picking.started?.settings).toEqual({ cwd: '/work', mode: 'allow-all', model: 'small' });
      expect(chat).toMatchObject({ id: 'picked', readOnly: { chatId: 'c1' }, settings: { mode: 'allow-all' } });
      expect(picking.started?.events.readOnly()).toMatch(/is editing this project/);
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

  describe('signing in to another account', () => {
    let signing: SigningAdapter;
    const accountEvents = () => sent.filter((s) => s.event === 'agents.account').map((s) => s.payload);

    beforeEach(() => {
      signing = new SigningAdapter();
      hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50);
      hub.addAdapter(signing);
    });

    it("says who the agent is signed in as, and nothing for an agent that can't switch", async () => {
      expect(await hub.account('fake')).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: null,
      });
      hub.addAdapter(Object.assign(new FakeAdapter(), { info: { id: 'plain', name: 'Plain', capabilities: [] } }));
      expect(await hub.account('plain')).toEqual({ agent: 'plain', account: null, pending: null });
      await expect(hub.signIn('plain', 'mum@example.com')).rejects.toThrow("Plain can't switch accounts");
      await expect(hub.signIn('fake', 'mum')).rejects.toThrow('Give the email');
    });

    it('signs in in the browser, telling every window, and moves the open chats to the new account', async () => {
      const idle = await hub.start('fake', settings, 'Hello');
      signing.runOf(idle.id).events.turnEnded();
      const busy = await hub.start('fake', settings, 'Working');
      sent = [];

      const signedIn = hub.signIn('fake', ' mum@example.com ');
      await settle();
      expect(signing.signingIn?.email).toBe('mum@example.com');
      expect(accountEvents().at(-1)).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: { email: 'mum@example.com', url: null },
      });
      signing.signingIn?.page('https://example.com/sign-in');
      await settle();
      expect(accountEvents().at(-1)?.pending).toEqual({
        email: 'mum@example.com',
        url: 'https://example.com/sign-in',
      });
      hub.signInCode('fake', 'abc#123');
      expect(signing.signingIn?.codes).toEqual(['abc#123']);

      signing.signingIn?.finish();
      const mum = { agent: 'fake', account: { email: 'mum@example.com', plan: 'pro', expiresAt: null }, pending: null };
      expect(await signedIn).toEqual(mum);
      expect(accountEvents().at(-1)).toEqual(mum);

      // The idle chat's process stopped; its next message starts another, continuing the chat.
      const before = signing.runOf(idle.id);
      expect(before.closed).toBe(true);
      hub.send(idle.id, 'Again');
      expect(signing.runOf(idle.id)).not.toBe(before);
      expect(signing.runOf(idle.id)).toMatchObject({ resume: true, sent: ['Again'] });
      // What the stopped process still reports is dropped.
      sent = [];
      before.events.closed('Stopped');
      expect(sent).toEqual([]);

      // The busy chat finishes its turn first, then moves.
      const working = signing.runOf(busy.id);
      expect(working.closed).toBe(false);
      hub.send(busy.id, 'Queued');
      working.events.turnEnded();
      expect(working.closed).toBe(true);
      expect(signing.runOf(busy.id)).toMatchObject({ resume: true, sent: ['Queued'] });
    });

    it('leaves the account and the chats as they were when the sign-in is cancelled', async () => {
      const { id } = await hub.start('fake', settings, 'Hello');
      signing.runOf(id).events.turnEnded();
      const attempt = hub.signIn('fake', 'mum@example.com');
      await settle();
      hub.cancelSignIn('fake');
      await expect(attempt).rejects.toThrow('cancelled');
      await settle();

      expect(signing.runOf(id).closed).toBe(false);
      expect(accountEvents().at(-1)).toEqual({
        agent: 'fake',
        account: { email: 'me@example.com', plan: 'pro', expiresAt: null },
        pending: null,
      });
      expect(() => hub.signInCode('fake', 'abc')).toThrow('No sign-in is under way');
    });

    it('cancels a sign-in under way when another begins', async () => {
      const first = hub.signIn('fake', 'mum@example.com');
      const firstSignIn = signing.signingIn;
      const second = hub.signIn('fake', 'dad@example.com');
      await expect(first).rejects.toThrow('cancelled');
      expect(firstSignIn?.cancelled).toBe(true);
      await settle();
      expect(accountEvents().at(-1)?.pending).toEqual({ email: 'dad@example.com', url: null });
      signing.signingIn?.finish();
      expect((await second).account?.email).toBe('dad@example.com');
    });
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
    const { chats } = store;
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    await hub.configure(id, { model: 'small', mode: 'plan' });
    expect(fake.runOf(id).configured).toEqual([{ model: 'small', mode: 'plan' }]);
    expect(sent).toEqual([
      { event: 'agents.settings', payload: { chatId: id, settings: { ...settings, model: 'small', mode: 'plan' } } },
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
      { event: 'agents.settings', payload: { chatId: id, settings: { ...settings, mcpOff: ['github'] } } },
    ]);
    expect(store.chats.list()[0]?.settings).toEqual({ ...settings, mcpOff: ['github'] });
    working.events.turnEnded();
    expect(working.closed).toBe(true);
    hub.send(id, 'Again');
    expect(fake.runOf(id)).toMatchObject({ resume: true, settings: { mcpOff: ['github'] }, sent: ['Again'] });

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

  it('lists the folders a setup can be read in: those still there, outside the temp folder', async () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'grimoire-temp-'));
    const work = mkdtempSync(path.join(tmpdir(), 'grimoire-work-'));
    const run = path.join(temp, 'test-run');
    fake.chats = [
      { id: 'a', agent: 'fake', title: '', cwd: work, updatedAt: 1 },
      { id: 'b', agent: 'fake', title: '', cwd: path.join(work, 'gone'), updatedAt: 2 },
      { id: 'c', agent: 'fake', title: '', cwd: temp, updatedAt: 3 },
      { id: 'd', agent: 'fake', title: '', cwd: homedir(), updatedAt: 4 },
    ];
    try {
      mkdirSync(run);
      fake.chats.push({ id: 'e', agent: 'fake', title: '', cwd: run, updatedAt: 5 });
      expect(await hub.setupFolders(temp)).toEqual([homedir(), work]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
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

  it('undoes a message\'s edits and those after it, and remembers them after a restart', async () => {
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

  it('forks a chat after a message\'s turn into the next free variant, and opens it', async () => {
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
    // A fork edits as any chat does.
    expect(variant.readOnly).toBeUndefined();
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
    await expect(hub.rename(id, '  ')).rejects.toThrow('A chat needs a title');
    await expect(hub.rename('missing', 'x')).rejects.toThrow('This chat is not open');
  });

  it('keeps your tags for a chat, each once, across restarts', async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    hub.tag(id, [' ui ', 'bug', '', 'UI']);
    expect(sent).toEqual([{ event: 'agents.tags', payload: { chatId: id, tags: ['ui', 'bug'] } }]);
    expect((await hub.open('fake', id, settings)).tags).toEqual(['ui', 'bug']);
    fake.chats = [
      { id, agent: 'fake', title: 'Tagged', updatedAt: 0 },
      { id: 'other', agent: 'fake', title: 'Plain', updatedAt: 1 },
    ];
    expect((await hub.listChats('fake')).map((chat) => chat.tags)).toEqual([['ui', 'bug'], []]);
    hub.tag(id, ['bug']);

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    expect((await restarted.open('fake', id, settings)).tags).toEqual(['bug']);
  });

  it('pins and stars chats, kept across restarts', async () => {
    const store = hubStore(openDatabase(':memory:'));
    hub = new AgentHub((event, payload) => sent.push({ event, payload } as Sent), 50, store);
    hub.addAdapter(fake);
    const { id } = await hub.start('fake', settings, 'Hello');
    sent = [];

    hub.pin(id, 'star', true);
    hub.pin(id, 'pin', true);
    hub.pin(id, 'star', false);
    expect(sent.map((s) => s.payload)).toEqual([
      { chatId: id, pins: ['star'] },
      { chatId: id, pins: ['pin', 'star'] },
      { chatId: id, pins: ['pin'] },
    ]);
    expect((await hub.open('fake', id, settings)).pins).toEqual(['pin']);
    fake.chats = [
      { id, agent: 'fake', title: 'Pinned', updatedAt: 0 },
      { id: 'other', agent: 'fake', title: 'Plain', updatedAt: 1 },
    ];
    expect((await hub.listChats('fake')).map((chat) => chat.pins)).toEqual([['pin'], []]);

    const restarted = new AgentHub(() => {}, 50, store);
    restarted.addAdapter(fake);
    expect((await restarted.open('fake', id, settings)).pins).toEqual(['pin']);
  });

  it('passes interrupts to the agent', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    expect(await hub.interrupt(id)).toEqual([]);
    expect(fake.runOf(id).interrupts).toBe(1);
  });

  it('sends pictures and files with a message, queued or not', async () => {
    const picture = { kind: 'picture', mediaType: 'image/png', data: 'AAAA' } as const;
    const file = { kind: 'file', path: '/work/ribbon.ts' } as const;
    const { id, entries } = await hub.start('fake', settings, 'Look', undefined, [picture]);
    const run = fake.runOf(id);
    expect(entries[0]).toMatchObject({ kind: 'user', text: 'Look', attachments: [picture] });
    expect(run.sentAttachments).toEqual([[picture]]);

    hub.send(id, '', [file]);
    expect(sent.filter((s) => s.event === 'agents.queued').at(-1)!.payload).toEqual({
      chatId: id,
      queued: [{ id: expect.any(String), text: '', attachments: [file] }],
    });
    run.events.turnEnded();
    expect(run.sentAttachments).toEqual([[picture], [file]]);
    expect(() => hub.send(id, '  ')).toThrow('Write something, or attach something, to send');
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

  it('keeps what the agent suggests you send next, until you send', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    run.events.turnEnded();
    run.events.suggestion('Run the tests');
    expect(sent.at(-1)).toEqual({ event: 'agents.suggestion', payload: { chatId: id, suggestion: 'Run the tests' } });
    expect((await hub.open('fake', id, settings)).suggestion).toBe('Run the tests');
    expect((await hub.openChats()).map((chat) => chat.suggestion)).toEqual(['Run the tests']);

    hub.send(id, 'Something else');
    expect(sent.filter((s) => s.event === 'agents.suggestion').at(-1)!.payload).toEqual({
      chatId: id,
      suggestion: null,
    });
    expect((await hub.open('fake', id, settings)).suggestion).toBeUndefined();
  });

  it('drops a suggestion that comes while a turn runs or something is queued', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    const run = fake.runOf(id);
    run.events.suggestion('Too soon');
    hub.send(id, 'Also this');
    // The queued message begins the next turn before the suggestion comes.
    run.events.turnEnded();
    run.events.suggestion('Run the tests');
    expect(events()).not.toContain('agents.suggestion');
    expect((await hub.open('fake', id, settings)).suggestion).toBeUndefined();

    run.events.turnEnded();
    run.events.suggestion('Commit it');
    expect((await hub.open('fake', id, settings)).suggestion).toBe('Commit it');
  });

  describe('separate tasks the agent offers', () => {
    const offered = [
      { title: 'Docs', prompt: 'Write the docs' },
      { title: 'Release', prompt: 'Cut a release' },
    ];
    const lastFollowUps = () => sent.filter((s) => s.event === 'agents.followUps').at(-1)?.payload;

    it('keeps them once the turn ended, until the next begins', async () => {
      const { id } = await hub.start('fake', settings, 'Hello');
      const run = fake.runOf(id);
      run.events.turnEnded();
      run.events.followUps(offered);
      expect(lastFollowUps()).toEqual({ chatId: id, followUps: offered });
      expect((await hub.open('fake', id, settings)).followUps).toEqual(offered);
      expect((await hub.openChats()).map((chat) => chat.followUps)).toEqual([offered]);

      hub.send(id, 'Something else');
      expect(lastFollowUps()).toEqual({ chatId: id, followUps: null });
      expect((await hub.open('fake', id, settings)).followUps).toBeUndefined();
    });

    it('drops those offered while a turn runs or something is queued', async () => {
      const { id } = await hub.start('fake', settings, 'Hello');
      const run = fake.runOf(id);
      run.events.followUps(offered);
      hub.send(id, 'Also this');
      // The queued message begins the next turn before they come.
      run.events.turnEnded();
      run.events.followUps(offered);
      run.events.turnEnded();
      run.events.followUps([]);
      expect(events()).not.toContain('agents.followUps');
      expect((await hub.open('fake', id, settings)).followUps).toBeUndefined();
    });

    it('gives what a new chat for one begins with, and the others stay', async () => {
      const { id } = await hub.start(
        'fake',
        { ...settings, model: 'small', effort: 'high', mode: 'plan', mcpOff: ['github'] },
        'Hello',
      );
      const run = fake.runOf(id);
      run.events.turnEnded();
      run.events.followUps(offered);
      expect(hub.takeFollowUp(id, 1)).toEqual({
        agent: 'fake',
        settings: { cwd: '/work', model: 'small', effort: 'high', mode: 'plan', mcpOff: ['github'] },
        prompt: 'Cut a release',
      });
      expect(lastFollowUps()).toEqual({ chatId: id, followUps: [offered[0]] });
      expect(() => hub.takeFollowUp(id, 1)).toThrow('no longer offered');
      hub.takeFollowUp(id, 0);
      expect(lastFollowUps()).toEqual({ chatId: id, followUps: null });
      expect((await hub.open('fake', id, settings)).followUps).toBeUndefined();
    });

    it("brings back those the saved chat's last turn offered", async () => {
      fake.transcripts.set('c1', [{ kind: 'user', id: 'u1', text: 'Earlier' }]);
      fake.followUps.set('c1', offered);
      expect((await hub.open('fake', 'c1', settings)).followUps).toEqual(offered);
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

  it('opens a saved chat with what its last reply left in the prompt cache', async () => {
    fake.transcripts.set('c1', []);
    fake.caches.set('c1', { tokens: 283_000, until: 1_000 });
    expect((await hub.open('fake', 'c1', settings)).cache).toEqual({ tokens: 283_000, until: 1_000 });
  });

  it('passes on the prompt cache each turn leaves', async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.runOf(id).events.cache({ tokens: 12_000, until: 5_000 });
    expect(sent.at(-1)).toEqual({
      event: 'agents.cache',
      payload: { chatId: id, cache: { tokens: 12_000, until: 5_000 } },
    });
    expect((await hub.open('fake', id, settings)).cache).toEqual({ tokens: 12_000, until: 5_000 });
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

describe('putting the chats away for another profile', () => {
  it('is refused, naming them, while a turn runs or an approval waits', async () => {
    const idle = await hub.start('fake', settings, 'Hello');
    fake.runOf(idle.id).events.turnEnded();
    expect(hub.busy()).toBeUndefined();

    const working = await hub.start('fake', settings, 'Working');
    fake.runOf(working.id).events.title('Fix the ribbon');
    expect(hub.busy()).toBe('Wait for "Fix the ribbon" to finish, or stop it, first');
    fake.runOf(working.id).events.turnEnded();

    void fake.runOf(idle.id).events.approval(
      { id: 'a1', tool: 'Write', input: {} },
      new AbortController().signal,
    );
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
