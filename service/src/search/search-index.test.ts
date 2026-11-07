import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SearchIndex, matchOf } from './search-index';

const text = (excerpt: { text: string; match?: true }[]) =>
  excerpt.map((part) => (part.match ? `[${part.text}]` : part.text)).join('');

describe('SearchIndex', () => {
  let index: SearchIndex;
  beforeEach(() => {
    index = new SearchIndex(':memory:');
  });
  afterEach(() => index.close());

  it('finds chats with every word looked for in one passage, or words starting with them', () => {
    index.put({ id: 'c1', agent: 'claude-code', updatedAt: 1 }, [
      { kind: 'title', text: 'Context meter' },
      { kind: 'you', text: 'Show how full the context window is' },
      { kind: 'agent', text: 'I drew the meter as ticks in the margin.' },
    ]);
    index.put({ id: 'c2', agent: 'claude-code', updatedAt: 2 }, [
      { kind: 'title', text: 'Fix flaky login test' },
      { kind: 'agent', text: 'The login test waited on a timer; it now waits for the form.' },
    ]);

    expect(index.search('login').map((hit) => hit.chatId)).toEqual(['c2']);
    expect(index.search('tick margin')[0]).toMatchObject({
      chatId: 'c1',
      agent: 'claude-code',
      kind: 'agent',
    });
    expect(text(index.search('tick margin')[0]!.excerpt)).toBe(
      'I drew the meter as [ticks] in the [margin].',
    );
    // Words in different passages don't make a match.
    expect(index.search('flaky timer')).toEqual([]);
    // Each chat once, with its best passage.
    expect(index.search('meter').map((hit) => [hit.chatId, hit.kind])).toEqual([['c1', 'title']]);
  });

  it('ignores case, accents and punctuation, and finds nothing for nothing', () => {
    index.put({ id: 'c1', agent: 'a', updatedAt: 1 }, [
      { kind: 'you', text: 'Café menu, “quoted”' },
    ]);
    expect(index.search('CAFE')).toHaveLength(1);
    expect(index.search('"quoted')).toHaveLength(1);
    expect(index.search('  "*() ')).toEqual([]);
    expect(matchOf(`it's 2 "ok"`)).toBe('"it"* "s"* "2"* "ok"*');
    expect(matchOf(' - ')).toBeNull();
  });

  it('cuts a long passage short around the words', () => {
    const long = `${'word '.repeat(60)}needle ${'word '.repeat(60)}`;
    index.put({ id: 'c1', agent: 'a', updatedAt: 1 }, [{ kind: 'agent', text: long }]);
    const excerpt = text(index.search('needle')[0]!.excerpt);
    expect(excerpt).toContain('[needle]');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThan(200);
  });

  it('replaces a chat’s passages, forgets a removed chat, and knows what it indexed', () => {
    index.put({ id: 'c1', agent: 'a', updatedAt: 1 }, [{ kind: 'you', text: 'first draft' }]);
    index.put({ id: 'c1', agent: 'a', updatedAt: 2 }, [{ kind: 'you', text: 'second draft' }]);
    index.put({ id: 'c2', agent: 'a', updatedAt: 3 }, [{ kind: 'you', text: 'another draft' }]);
    expect(index.search('first')).toEqual([]);
    expect(index.search('second').map((hit) => hit.chatId)).toEqual(['c1']);
    index.remove('c2');
    expect(index.search('draft').map((hit) => hit.chatId)).toEqual(['c1']);
    expect([...index.indexed().values()]).toEqual([{ id: 'c1', agent: 'a', updatedAt: 2 }]);
  });

  it('adds up the tokens of the turns begun since a time, by day, model, folder and chat', () => {
    const counts = (input: number, output: number) => ({
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output,
    });
    const day = (d: number, hour = 12) => new Date(2026, 10, d, hour).getTime();
    index.put(
      { id: 'c1', agent: 'a', updatedAt: 1, title: 'Ribbon', cwd: '/work/grimoire' },
      [],
      [
        { at: day(5), model: 'claude-opus-5-5', ...counts(100, 10) },
        { at: day(5), model: 'claude-sonnet-5-5', subagent: true, ...counts(50, 0) },
        { at: day(6, 9), model: 'claude-opus-5-5', ...counts(10, 2) },
        // Before the span.
        { at: day(1), model: 'claude-opus-5-5', ...counts(9_999, 0) },
      ],
    );
    index.put(
      { id: 'c2', agent: 'a', updatedAt: 2, title: 'Notes' },
      [],
      [{ at: day(6, 23), model: 'claude-haiku-4-5', ...counts(1_000, 100) }],
    );

    const totals = index.tokens(day(4));
    expect(totals.total).toEqual({ ...counts(1_160, 112), weight: 1_160 + 112 * 5 });
    expect(totals.days.map(({ day, weight }) => [day, weight])).toEqual([
      ['2026-11-05', 200],
      ['2026-11-06', 1_520],
    ]);
    expect(totals.models.map(({ model, subagent, weight }) => [model, subagent, weight])).toEqual([
      ['claude-haiku-4-5', false, 1_500],
      ['claude-opus-5-5', false, 170],
      ['claude-sonnet-5-5', true, 50],
    ]);
    // A chat with no folder counts in the totals, not the folders.
    expect(totals.folders.map(({ cwd, weight }) => [cwd, weight])).toEqual([
      ['/work/grimoire', 220],
    ]);
    expect(totals.chats.map(({ id, title, cwd, weight }) => [id, title, cwd, weight])).toEqual([
      ['c2', 'Notes', undefined, 1_500],
      ['c1', 'Ribbon', '/work/grimoire', 220],
    ]);

    // Indexed again, a chat's turns replace the ones it had; removed, they're gone.
    index.put({ id: 'c1', agent: 'a', updatedAt: 3 }, [], []);
    index.remove('c2');
    expect(index.tokens(day(4)).total.weight).toBe(0);
  });

  it('keeps its index in a file across runs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-search-'));
    const file = path.join(dir, 'search.db');
    try {
      const kept = new SearchIndex(file);
      kept.put({ id: 'c1', agent: 'a', updatedAt: 1 }, [{ kind: 'you', text: 'kept' }]);
      kept.close();
      const reopened = new SearchIndex(file);
      expect(reopened.search('kept')).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
