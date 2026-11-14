import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../storage/database';
import { hubStore } from './chat-table';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { type Sent, settings, settle } from './hub-testing';

const opus = 'claude-opus-5-5';
const sonnet = 'claude-sonnet-5-5';

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

/** A chat whose agent measured it on `model`, idle. */
const chatOn = async (model: string, used: number) => {
  const { id } = await hub.start('fake', settings, 'Hello');
  const run = fake.runOf(id);
  run.events.context({ used, limit: 400_000, compactsAt: 367_000, model });
  run.events.turnEnded();
  return { id, run };
};

const contexts = () => sent.filter((s) => s.event === 'agents.context').map((s) => s.payload);

describe('Compaction', () => {
  it("gives how the agent compacts the chat's model, once the model is known", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    expect(await hub.compaction(id)).toBeNull();
    fake.runOf(id).events.context({ used: 9_000, limit: 400_000, model: opus });
    expect(await hub.compaction(id)).toEqual(fake.compactionSettings);
  });

  it("saves a model's window, and starts its chats again in it, the meter at once", async () => {
    const a = await chatOn(opus, 50_000);
    const b = await chatOn(sonnet, 60_000);
    fake.windows.set(opus, { limit: 250_000, compactsAt: 217_000 });
    sent = [];
    await hub.setCompaction(a.id, { window: 250_000 });
    await settle();
    expect(fake.compactionChanges).toEqual([{ model: opus, change: { window: 250_000 } }]);
    expect(a.run.closed).toBe(true);
    expect(b.run.closed).toBe(false);
    expect(contexts()).toEqual([
      { chatId: a.id, context: { used: 50_000, limit: 250_000, compactsAt: 217_000, model: opus } },
    ]);
  });

  it("refuses a change before the chat's model is known", async () => {
    const { id } = await hub.start('fake', settings, 'Hello');
    await expect(hub.setCompaction(id, { window: 'auto' })).rejects.toThrow(
      "This chat's compaction can't be changed yet",
    );
  });
});
