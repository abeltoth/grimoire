import { describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import type { AgentAdapter } from './adapter';
import { ChatTable, hubStore, userEntry } from './chat-table';

const adapter = { id: 'claude-code' } as unknown as AgentAdapter;

describe('ChatTable', () => {
  it('finds an agent it has, and refuses one it hasn’t', () => {
    const table = new ChatTable();
    table.adapters.set('claude-code', adapter);
    expect(table.adapter('claude-code')).toBe(adapter);
    expect(() => table.adapter('codex')).toThrow('Unknown agent: codex');
  });

  it('keeps a chat as open and idle, with its entries, and refuses one that isn’t open', () => {
    const table = new ChatTable();
    const entries = [userEntry('u1', 'Hi', [])];
    const chat = table.track('a', adapter, { cwd: '/work' }, entries, 'Greeting');
    expect(chat).toMatchObject({
      id: 'a',
      agent: adapter,
      title: 'Greeting',
      settings: { cwd: '/work' },
      status: 'idle',
      entries,
      queued: [],
      plan: [],
      processes: 0,
      restart: false,
    });
    expect(table.chat('a')).toBe(chat);
    expect(() => table.chat('b')).toThrow('This chat is not open');
  });
});

describe('userEntry', () => {
  it('carries attachments only when there are some', () => {
    expect(userEntry('u1', 'Hi', [])).toEqual({ kind: 'user', id: 'u1', text: 'Hi' });
    const picture = { kind: 'picture' as const, mediaType: 'image/png', data: 'AA==' };
    expect(userEntry('u2', 'Look', [picture])).toEqual({
      kind: 'user',
      id: 'u2',
      text: 'Look',
      attachments: [picture],
    });
  });
});

describe('hubStore', () => {
  it('keeps undone and copied messages apart, in one database', () => {
    const store = hubStore(openDatabase(':memory:'));
    store.withdrawn.add('a', ['u1']);
    store.copied.add('a', ['u2']);
    expect([store.withdrawn.list('a'), store.copied.list('a')]).toEqual([['u1'], ['u2']]);
  });
});
