import { describe, expect, it } from 'vitest';
import { type TurnRow, totalsOf } from './token-totals';

const row = (id: string, dollars: number | null): TurnRow => ({
  id,
  at: new Date(2026, 10, 5, 12).getTime(),
  model: 'claude-opus-5-5',
  subagent: 0,
  input: 10,
  cacheWritten: 0,
  cacheWrittenLong: 0,
  cacheRead: 0,
  output: 0,
  costInput: dollars,
  costCacheWritten: dollars === null ? null : 0,
  costCacheWrittenLong: dollars === null ? null : 0,
  costCacheRead: dollars === null ? null : 0,
  costOutput: dollars === null ? null : 0,
  sourceKind: null,
  sourceName: null,
  agent: 'a',
  title: id,
  cwd: null,
});

describe('totalsOf', () => {
  it('lists the costliest hundred chats, and counts them all', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`c${i}`, i));
    const totals = totalsOf(0, rows);
    expect(totals.chatCount).toBe(120);
    expect(totals.chats).toHaveLength(100);
    expect(totals.chats[0]!.id).toBe('c119');
    expect(totals.chats.at(-1)!.id).toBe('c20');
  });

  it('adds up each skill and subagent, a name with spaces kept whole, costliest first', () => {
    const totals = totalsOf(0, [
      { ...row('c1', 1), sourceKind: 'skill', sourceName: 'commit' },
      { ...row('c2', 3), sourceKind: 'subagent', sourceName: 'code reviewer' },
      { ...row('c3', 2), sourceKind: 'skill', sourceName: 'commit' },
      row('c4', 5),
    ]);
    expect(totals.sources.map(({ kind, name, dollars }) => [kind, name, dollars])).toEqual([
      ['skill', 'commit', 3],
      ['subagent', 'code reviewer', 3],
    ]);
  });

  it('counts the tokens of a model without known prices apart, at no cost', () => {
    const totals = totalsOf(0, [row('priced', 2), row('unpriced', null)]);
    expect(totals.total.dollars).toBe(2);
    expect(totals.total.input).toBe(20);
    expect(totals.unpriced).toBe(10);
  });
});
