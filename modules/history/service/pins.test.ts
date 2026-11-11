import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { Pins } from './pins';

function pins(): Pins {
  const db = openDatabase(':memory:');
  migrate(db, 'history', MIGRATIONS);
  return new Pins(db);
}

describe('Pins', () => {
  it('marks a chat once for each mark, and takes a mark off', () => {
    const marks = pins();
    marks.set('a', 'star', true);
    marks.set('a', 'pin', true);
    marks.set('a', 'pin', true);
    expect(marks.of('a')).toEqual(['pin', 'star']);
    marks.set('a', 'star', false);
    marks.set('b', 'pin', false);
    expect(marks.of('a')).toEqual(['pin']);
    expect(marks.of('b')).toEqual([]);
  });

  it('lists every marked chat’s marks, and no unmarked chat', () => {
    const marks = pins();
    marks.set('a', 'star', true);
    marks.set('b', 'pin', true);
    marks.set('b', 'star', true);
    marks.set('c', 'pin', true);
    marks.set('c', 'pin', false);
    expect(Object.fromEntries(marks.all())).toEqual({ a: ['star'], b: ['pin', 'star'] });
  });
});
