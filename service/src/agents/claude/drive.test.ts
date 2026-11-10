import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvents } from '../adapter';
import { Deferred, approvalsTo, drive, userMessage } from './drive';
import { FollowUpsKept } from './follow-ups';
import { MessageQueue } from './message-queue';
import type { PickerSources } from './subagents';

const sessions = vi.hoisted(() => ({
  info: undefined as { customTitle?: string; summary?: string } | undefined,
}));
vi.mock('./probe', async (original) => ({
  ...(await original<typeof import('./probe')>()),
  sdk: async () => ({ getSessionInfo: async () => sessions.info }),
}));

/** A chat's events, each a spy. */
function chatEvents(): ChatEvents & Record<string, ReturnType<typeof vi.fn>> {
  const names = ['status', 'entry', 'text', 'title', 'context', 'cache', 'plan', 'tokens'];
  const more = ['hooks', 'turnEnded', 'suggestion', 'followUps', 'closed', 'subagentEntry'];
  const events = Object.fromEntries([...names, ...more].map((name) => [name, vi.fn()]));
  return {
    ...events,
    subagentState: vi.fn(),
    readOnly: () => undefined,
    approval: vi.fn(),
  } as never;
}

/** A live query that gives these messages, then ends. */
function liveQuery(messages: object[], rewind = { canRewind: true } as object) {
  const query = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message as SDKMessage;
    },
    getContextUsage: vi.fn(async () => ({ totalTokens: 10, rawMaxTokens: 100 })),
    setModel: vi.fn(async () => {}),
    applyFlagSettings: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    rewindFiles: vi.fn(async () => rewind),
    supportedAgents: vi.fn(async () => []),
    close: vi.fn(),
  };
  return query;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const result = { type: 'result', subtype: 'success', is_error: false, result: 'Done' };

let events: ReturnType<typeof chatEvents>;
let input: MessageQueue<SDKUserMessage>;
let picking: Deferred<PickerSources>;
let followUps: FollowUpsKept;
beforeEach(() => {
  sessions.info = undefined;
  events = chatEvents();
  input = new MessageQueue<SDKUserMessage>();
  picking = new Deferred<PickerSources>();
  followUps = new FollowUpsKept();
});
const run = (query: ReturnType<typeof liveQuery>) =>
  drive({
    chatId: 'c1',
    settings: { cwd: 'C:/work', model: 'opus' },
    started: Promise.resolve(query as unknown as Query),
    input,
    events,
    picking,
    followUps,
    models: async () => ({ models: [], default: 'opus' }),
  });

describe('drive', () => {
  it("ends each turn with what it offered, the context used and the chat's title", async () => {
    sessions.info = { summary: 'Fix the meter' };
    followUps.put([{ title: 'Docs', prompt: 'Write the docs' }]);
    run(liveQuery([result]));
    await settle();
    expect(events.turnEnded).toHaveBeenCalledWith(undefined);
    expect(events.followUps).toHaveBeenCalledWith([{ title: 'Docs', prompt: 'Write the docs' }]);
    expect(events.context).toHaveBeenCalledWith({ used: 10, limit: 100 });
    expect(events.title).toHaveBeenCalledWith('Fix the meter');
    expect(events.closed).toHaveBeenCalledWith();
  });

  it('leaves the cache a compaction left, measured once the turn ends, not the one before it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5_000);
    const reply = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'msg_1', content: [], usage: { input_tokens: 90_000 } },
    };
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 90_000 },
    };
    run(liveQuery([reply, boundary, result]));
    await settle();
    vi.useRealTimers();
    expect(events.cache).toHaveBeenCalledTimes(1);
    expect(events.cache).toHaveBeenCalledWith({ tokens: 10, until: 5_000 + 3_600_000 });
  });

  it("gives a turn's error, and the query's when it fails", async () => {
    run(liveQuery([{ type: 'result', subtype: 'error_during_execution', errors: ['Boom'] }]));
    await settle();
    expect(events.turnEnded).toHaveBeenCalledWith('Boom');
    const failing = liveQuery([]);
    failing[Symbol.asyncIterator] = async function* () {
      yield* [];
      throw new Error('The process died');
    };
    events = chatEvents();
    run(failing);
    await settle();
    expect(events.closed).toHaveBeenCalledWith('The process died');
  });

  it('lets the subagent picker see the model the chat runs at now', async () => {
    const query = liveQuery([]);
    const live = run(query);
    const sources = await picking.promise;
    expect(sources.settings()).toEqual({ model: 'opus', effort: undefined });
    await live.configure({ model: 'sonnet', effort: 'high', mode: 'plan' });
    expect(sources.settings()).toEqual({ model: 'sonnet', effort: 'high' });
    expect(query.setModel).toHaveBeenCalledWith('sonnet');
    expect(query.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'high' });
    expect(query.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('undoes only what Claude Code can rewind', async () => {
    await expect(run(liveQuery([], { canRewind: true })).undo!('u1')).resolves.toBeUndefined();
    await expect(run(liveQuery([], { canRewind: false })).undo!('u1')).rejects.toThrow(
      "Claude Code can't undo this message",
    );
  });

  it('sends your messages into the query, and ends it on close', async () => {
    const query = liveQuery([]);
    const live = run(query);
    live.send('Hello', '00000000-0000-4000-8000-000000000001');
    live.close();
    const sent: SDKUserMessage[] = [];
    for await (const message of input) sent.push(message);
    expect(sent.map((message) => message.message.content)).toEqual(['Hello']);
    await settle();
    expect(query.close).toHaveBeenCalled();
  });
});

describe('userMessage', () => {
  it('sends pictures before the text, under the entry ID', () => {
    const message = userMessage(
      'Look',
      'u1',
      [{ kind: 'picture', mediaType: 'image/png', data: 'AAAA' }],
      'C:/work',
    );
    expect(message.uuid).toBe('u1');
    expect(message.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'Look' },
    ]);
  });
});

describe('approvalsTo', () => {
  const ask = (verdict: unknown, suggestions?: unknown[]) => {
    const approval = vi.fn(async (_request: { id: string; tool: string }) => verdict);
    const canUse = approvalsTo(async () => ({ approval }) as unknown as ChatEvents);
    const options = { signal: new AbortController().signal, suggestions, toolUseID: 't1' };
    return { answer: canUse('Bash', { command: 'ls' }, options as never), approval };
  };

  it('answers Claude Code as you did: denied, allowed, or allowed from now on', async () => {
    expect(await ask('deny').answer).toEqual({
      behavior: 'deny',
      message: 'The user declined this.',
    });
    expect(await ask('allow').answer).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    });
    const always = [{ type: 'addRules', rules: [], behavior: 'allow', destination: 'session' }];
    expect(await ask('allow-always', always).answer).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
      updatedPermissions: always,
    });
  });

  it('asks under the tool call ID', async () => {
    const { answer, approval } = ask('allow');
    await answer;
    expect(approval.mock.calls[0]![0]).toMatchObject({ id: 't1', tool: 'Bash' });
  });
});
