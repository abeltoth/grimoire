import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { EntryIds } from './entry-ids';

describe('EntryIds', () => {
  it('keeps undone entries per chat, in the order they were undone', () => {
    const db = openDatabase(':memory:');
    const withdrawn = new EntryIds(db, 'withdrawn');
    new EntryIds(db, 'copied').add('a', ['u7']);
    withdrawn.add('a', ['u2', 'u3']);
    withdrawn.add('b', ['u9']);
    withdrawn.add('a', ['u3', 'u1']);
    expect(withdrawn.list('a')).toEqual(['u2', 'u3', 'u1']);
    expect(withdrawn.list('c')).toEqual([]);
  });
});
