import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { Summaries } from './summaries';

describe('Summaries', () => {
  it('keeps each chat’s summary trimmed, in place of the one before, and takes a blank one away', () => {
    const db = openDatabase(':memory:');
    migrate(db, 'history', MIGRATIONS);
    const summaries = new Summaries(db);
    expect(summaries.set('a', ' Fixes the meter ')).toBe('Fixes the meter');
    summaries.set('b', 'Old');
    summaries.set('b', 'New');
    expect(Object.fromEntries(summaries.all())).toEqual({ a: 'Fixes the meter', b: 'New' });
    expect(summaries.set('a', '  ')).toBe('');
    expect(Object.fromEntries(summaries.all())).toEqual({ b: 'New' });
    expect(summaries.set('c', 'x'.repeat(600))).toHaveLength(500);
  });
});
