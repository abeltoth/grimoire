import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database';
import { hubStore } from './chat-table';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, settings, settle } from './hub-testing';

const opus = 'claude-opus-5-5';
const window = { limit: 400_000, compactsAt: 367_000 };

let fake: FakeAdapter;
let hub: AgentHub;
let sent: Sent[];

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeAdapter();
  sent = [];
  hub = new AgentHub(
    (event, payload) => sent.push({ event, payload } as Sent),
    50,
    hubStore(openDatabase(':memory:')),
  );
  hub.addAdapter(fake);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A saved chat whose last reply came from `model`, leaving `tokens` in its context. */
const savedChat = (chatId: string, model: string, tokens: number) => {
  fake.transcripts.set(chatId, []);
  fake.caches.set(chatId, { tokens, until: 1_000 });
  fake.lastModels.set(chatId, model);
};

const contexts = () => sent.filter((s) => s.event === 'agents.context').map((s) => s.payload);

describe('ChatWindows', () => {
  it("shows a reopened chat's last reply in the window another chat on its model measured", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    fake.runOf(id).events.context({ used: 62_000, ...window, model: opus });
    savedChat('saved', opus, 70_000);
    expect((await hub.open('fake', 'saved', settings)).context).toEqual({
      used: 70_000,
      ...window,
      model: opus,
    });
    expect(fake.measured).toEqual([]);
  });

  it('measures the window apart, once a model, when no chat on it was', async () => {
    fake.windows.set(opus, window);
    savedChat('a', opus, 70_000);
    savedChat('b', opus, 90_000);
    let measure!: () => void;
    fake.measureGate = new Promise((resolve) => (measure = resolve));
    const [a] = await Promise.all([
      hub.open('fake', 'a', settings),
      hub.open('fake', 'b', settings),
    ]);
    expect(a.context).toBeUndefined();
    measure();
    await settle();
    expect(fake.measured).toEqual([opus]);
    expect(contexts()).toEqual([
      { chatId: 'a', context: { used: 70_000, ...window, model: opus } },
      { chatId: 'b', context: { used: 90_000, ...window, model: opus } },
    ]);
    savedChat('c', opus, 10_000);
    expect((await hub.open('fake', 'c', settings)).context).toEqual({
      used: 10_000,
      ...window,
      model: opus,
    });
    expect(fake.measured).toEqual([opus]);
  });

  it('leaves the meter for the agent when the window, the model or the last reply is unknown', async () => {
    savedChat('unmeasured', 'claude-haiku-5', 5_000);
    fake.transcripts.set('empty', []);
    await hub.open('fake', 'unmeasured', settings);
    expect((await hub.open('fake', 'empty', settings)).context).toBeUndefined();
    await settle();
    expect(contexts()).toEqual([]);
  });

  it("keeps the agent's measure over one taken apart that comes after it", async () => {
    fake.windows.set(opus, window);
    savedChat('a', opus, 70_000);
    let measure!: () => void;
    fake.measureGate = new Promise((resolve) => (measure = resolve));
    await hub.open('fake', 'a', settings);
    hub.send('a', 'Go on');
    fake.runOf('a').events.context({ used: 75_000, ...window, model: opus });
    measure();
    await settle();
    expect(contexts()).toEqual([
      { chatId: 'a', context: { used: 75_000, ...window, model: opus } },
    ]);
  });
});
