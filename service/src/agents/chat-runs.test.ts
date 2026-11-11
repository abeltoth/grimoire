import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, settings } from './hub-testing';

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

describe('ChatRuns', () => {
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
    expect(sent.at(-1)).toEqual({
      event: 'agents.suggestion',
      payload: { chatId: id, suggestion: 'Run the tests' },
    });
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
        settings: {
          cwd: '/work',
          model: 'small',
          effort: 'high',
          mode: 'plan',
          mcpOff: ['github'],
        },
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
    expect((await hub.open('fake', id, settings)).context).toEqual({
      used: 62_000,
      limit: 100_000,
    });
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
