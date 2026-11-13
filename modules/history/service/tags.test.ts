import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { Tags, keptTags, renamed } from './tags';

function tags(): Tags {
  const db = openDatabase(':memory:');
  migrate(db, 'history', MIGRATIONS);
  return new Tags(db);
}

describe('Tags', () => {
  it('keeps a chat’s tags in the order given, in place of those before', () => {
    const kept = tags();
    kept.set('a', ['bug', 'ui']);
    kept.set('a', ['later', 'bug']);
    kept.set('b', ['ui']);
    expect(kept.of('a')).toEqual(['later', 'bug']);
    kept.set('b', []);
    expect(kept.of('b')).toEqual([]);
    expect(Object.fromEntries(kept.all())).toEqual({ a: ['later', 'bug'] });
  });

  it('changes nothing when a chat’s new tags can’t all be kept', () => {
    const kept = tags();
    kept.set('a', ['bug']);
    expect(() => kept.set('a', ['ui', 'ui'])).toThrow();
    expect(kept.of('a')).toEqual(['bug']);
  });
});

describe('keptTags', () => {
  it('trims tags, drops blanks, and keeps each once whatever its case', () => {
    expect(keptTags([' ui ', 'bug', '', '  ', 'UI', 'Bug fix'])).toEqual(['ui', 'bug', 'Bug fix']);
  });
});

describe('renamed', () => {
  it('names a tag anew whatever its case, keeping its place, and merges it with the new name', () => {
    expect(renamed(['ui', 'Bug', 'docs'], 'bug', 'fix')).toEqual(['ui', 'fix', 'docs']);
    expect(renamed(['fix', 'bug'], 'BUG', 'Fix')).toEqual(['fix']);
    expect(renamed(['ui'], 'bug', 'fix')).toEqual(['ui']);
  });
});
