import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvents } from '../adapter';
import { Spares } from './spare';

/** A parked process: its claim answers as `claimed` says, and it exits when told. */
class FakeProcess {
  closed = 0;
  claims: unknown[] = [];
  exit!: () => void;
  readonly exited = new Promise<void>((resolve) => (this.exit = resolve));
  constructor(readonly claimed: Promise<{ sessionId: string }>) {
    claimed.catch(() => {});
  }
  claim(options: unknown) {
    this.claims.push(options);
    return { [Symbol.asyncIterator]: async function* () {} };
  }
  close() {
    this.closed++;
  }
}

const made = vi.hoisted(() => ({ processes: [] as unknown[], next: undefined as unknown }));
vi.mock('./probe', async (original) => ({
  ...(await original<typeof import('./probe')>()),
  sdk: async () => ({
    prewarm: async () => {
      made.processes.push(made.next);
      return made.next;
    },
    tool: () => ({}),
    createSdkMcpServer: () => ({}),
  }),
}));

const settle = () => new Promise((resolve) => setImmediate(resolve));
const events = { closed: () => {} } as unknown as ChatEvents;

let spares: Spares;
beforeEach(() => {
  made.processes = [];
  made.next = new FakeProcess(Promise.resolve({ sessionId: 's1' }));
  spares = new Spares({
    agent: 'claude-code',
    mcpOff: () => [],
    suggestions: () => true,
    followUps: () => true,
    tools: () => [],
    models: async () => ({ models: [], default: 'opus' }),
    quickModel: () => 'haiku',
  });
});

describe('Spares', () => {
  it('keeps one spare parked', async () => {
    spares.warm();
    spares.warm();
    await settle();
    expect(made.processes).toHaveLength(1);
    expect(spares.take()).toBeDefined();
    expect(spares.take()).toBeUndefined();
  });

  it('drops a spare that dies parked, and stops one when told', async () => {
    spares.warm();
    await settle();
    (made.processes[0] as FakeProcess).exit();
    await settle();
    expect(spares.take()).toBeUndefined();
    spares.warm();
    spares.dispose();
    await settle();
    expect((made.processes[1] as FakeProcess).closed).toBe(1);
  });

  it('starts a chat on the spare under the session ID Claude Code gives it', async () => {
    spares.warm();
    const spare = spares.take()!;
    const bound: string[] = [];
    await spares.claim(
      spare,
      { cwd: 'C:/work', model: 'opus', effort: 'high', mode: 'plan' },
      'Hello',
      'u1',
      (chatId) => (bound.push(chatId), events),
      'Meter',
      [],
    );
    expect(bound).toEqual(['s1']);
    expect(await spare.claimedBy.promise).toBe(events);
    expect((made.processes[0] as FakeProcess).claims[0]).toMatchObject({
      options: {
        cwd: 'C:/work',
        model: 'opus',
        permissionMode: 'plan',
        settings: { effortLevel: 'high' },
        title: 'Meter',
      },
    });
  });

  it('carries a claim whose model was refused, on the defaults', async () => {
    const refused = Object.assign(new Error('option_not_applied: model'), {
      claim: { sessionId: 's2' },
    });
    made.next = new FakeProcess(Promise.reject(refused));
    spares.warm();
    const bound: string[] = [];
    const bind = (chatId: string) => (bound.push(chatId), events);
    await spares.claim(spares.take()!, { cwd: 'C:/work' }, 'Hi', 'u1', bind, undefined, []);
    expect(bound).toEqual(['s2']);
  });

  it('stops a spare that refuses the claim, so the chat starts on a process of its own', async () => {
    made.next = new FakeProcess(Promise.reject(new Error('not_claimed')));
    spares.warm();
    const spare = spares.take()!;
    await expect(
      spares.claim(spare, { cwd: 'C:/work' }, 'Hi', 'u1', () => events, undefined, []),
    ).rejects.toThrow('not_claimed');
    expect((made.processes[0] as FakeProcess).closed).toBe(1);
  });
});
