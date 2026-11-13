import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { TagList } from './tag-list';

function tagList(): TagList {
  const db = openDatabase(':memory:');
  migrate(db, 'history', MIGRATIONS);
  return new TagList(db);
}

describe('TagList', () => {
  it('keeps the tags in the order given, in place of those before, each once', () => {
    const list = tagList();
    expect(list.set(['ui', ' bug ', 'UI'])).toEqual(['ui', 'bug']);
    expect(list.set(['docs', 'ui'])).toEqual(['docs', 'ui']);
    expect(list.all()).toEqual(['docs', 'ui']);
    list.set([]);
    expect(list.all()).toEqual([]);
  });

  it('adds tags it hasn’t at the end, whatever their case', () => {
    const list = tagList();
    list.set(['ui']);
    expect(list.add(['UI', ' bug ', 'docs', 'Bug'])).toEqual(['ui', 'bug', 'docs']);
    expect(list.add(['docs', 'UI'])).toBeNull();
    expect(list.all()).toEqual(['ui', 'bug', 'docs']);
  });
});
