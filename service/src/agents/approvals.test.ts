import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter';
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

describe('Approvals', () => {
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
});
