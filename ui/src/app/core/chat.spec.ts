import type { AgentEntry, OpenChat } from '@grimoire/contract';
import { appendText, fromOpenChat, upsert } from './chat';

const open: OpenChat = {
  id: 'c1',
  agent: 'claude-code',
  title: 'Meter',
  settings: { cwd: 'C:/work' },
  status: 'idle',
  entries: [],
  approvals: [],
  queued: [],
  plan: [],
  withdrawn: [],
  copied: [],
};

describe('fromOpenChat', () => {
  it('keeps what the chat has, and leaves out what it has none of', () => {
    expect(fromOpenChat({ ...open, suggestion: '', followUps: [] })).toEqual({
      id: 'c1',
      agent: 'claude-code',
      title: 'Meter',
      settings: { cwd: 'C:/work' },
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    expect(fromOpenChat({ ...open, suggestion: 'Run the tests' }).suggestion).toBe('Run the tests');
  });
});

describe('upsert', () => {
  const user = (id: string, text: string) => ({ kind: 'user' as const, id, text });

  it('puts an entry in place of the one with its ID, or else at the end', () => {
    const entries = [user('u1', 'one'), user('u2', 'two')];
    expect(upsert(entries, user('u1', 'won'))).toEqual([user('u1', 'won'), user('u2', 'two')]);
    expect(upsert(entries, user('u3', 'three'))).toEqual([...entries, user('u3', 'three')]);
  });
});

describe('appendText', () => {
  const reply: AgentEntry = {
    kind: 'agent',
    id: 'a1',
    blocks: [
      { kind: 'text', text: 'Hel' },
      { kind: 'tool', id: 't1', tool: 'Read', input: {} },
    ],
  };

  it("adds streamed text to an agent entry's text block, and to nothing else", () => {
    const [entry] = appendText([reply], 'a1', 0, 'lo') as AgentEntry[];
    expect(entry!.blocks[0]).toEqual({ kind: 'text', text: 'Hello' });
    expect(appendText([reply], 'a1', 1, 'lo')).toEqual([reply]);
    expect(appendText([reply], 'a2', 0, 'lo')).toEqual([reply]);
  });
});
