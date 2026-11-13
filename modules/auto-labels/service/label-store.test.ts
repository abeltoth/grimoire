import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { LabelStore } from './label-store';
import { MIGRATIONS } from './migrations';

function store(): LabelStore {
  const db = openDatabase(':memory:');
  migrate(db, 'auto-labels', MIGRATIONS);
  return new LabelStore(db);
}

describe('LabelStore', () => {
  it('remembers when each chat was labelled, keeping the last title given', () => {
    const labels = store();
    expect(labels.labelled('a')).toBeUndefined();
    labels.label('a', 1, 'Context meter');
    labels.label('a', 5);
    labels.label('b', 2);
    expect(labels.labelled('a')).toEqual({ turns: 5, title: 'Context meter' });
    expect(labels.labelled('b')).toEqual({ turns: 2 });
    expect(labels.all()).toEqual(new Set(['a', 'b']));
  });

  it('refuses a tag it added once you take it off, whatever its case', () => {
    const labels = store();
    labels.added('a', ['bug', 'ui']);
    labels.tagsNow('a', ['UI', 'docs']);
    expect(labels.refused('a')).toEqual(new Set(['bug']));
    // A tag you took off that wasn't added here isn't refused.
    labels.tagsNow('a', []);
    expect(labels.refused('a')).toEqual(new Set(['bug', 'ui']));
    expect(labels.refused('b')).toEqual(new Set());
  });
});
