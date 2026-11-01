import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../core/layout';
import { Chapters } from './chapters';
import { openDatabase } from './database';
import { DogEars } from './dog-ears';
import { EntryIds } from './entry-ids';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('storage', () => {
  it('keeps open chapters in order across restarts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const first = openDatabase(file);
    const chapters = new Chapters(first);
    chapters.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one' } });
    chapters.add({ chatId: 'b', agent: 'claude-code', settings: { cwd: '/two' } });
    chapters.add({ chatId: 'c', agent: 'claude-code', settings: { cwd: '/three' } });
    chapters.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one', model: 'opus' } });
    chapters.remove('b');
    first.close();

    const again = openDatabase(file);
    expect(new Chapters(again).list()).toEqual([
      { chatId: 'a', agent: 'claude-code', settings: { cwd: '/one', model: 'opus' } },
      { chatId: 'c', agent: 'claude-code', settings: { cwd: '/three' } },
    ]);
    again.close();
  });

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

  it('keeps each chat\'s dog-ears', () => {
    const dogEars = new DogEars(openDatabase(':memory:'));
    dogEars.set('a', 'star', true);
    dogEars.set('a', 'pin', true);
    dogEars.set('a', 'pin', true);
    dogEars.set('b', 'pin', true);
    dogEars.set('b', 'pin', false);
    expect(dogEars.of('a')).toEqual(['pin', 'star']);
    expect(dogEars.of('b')).toEqual([]);
  });

  it('remembers the layout, and only what it knows', () => {
    const layout = new LayoutStore(openDatabase(':memory:'));
    expect(layout.get()).toEqual({ current: null, lastUsed: null });
    const lastUsed = { agent: 'claude-code', settings: { cwd: '/work', mode: 'plan' as const } };
    layout.set({ current: 'a', lastUsed });
    layout.set({ unknown: 1 } as never);
    expect(layout.get()).toEqual({ current: 'a', lastUsed });
    layout.set({ current: null });
    expect(layout.get()).toEqual({ current: null, lastUsed });
  });
});
