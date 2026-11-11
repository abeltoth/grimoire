import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { Parallels } from './parallels';

describe('Parallels', () => {
  it('keeps the chats sent in parallel together, and the one that edits each group', () => {
    const parallels = new Parallels(openDatabase(':memory:'));
    expect(parallels.groupOf('a')).toBe('a');
    parallels.join('b', 'a');
    // A copy of a copy joins the first chat's group.
    parallels.join('c', 'b');
    expect([parallels.groupOf('b'), parallels.groupOf('c')]).toEqual(['a', 'a']);
    expect(parallels.editorOf('a')).toBeUndefined();
    parallels.setEditor('a', 'b');
    parallels.setEditor('a', 'c');
    expect(parallels.editorOf('a')).toBe('c');
  });
});
