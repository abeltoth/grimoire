import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../core/layout';
import { PresetStore } from '../core/presets';
import { SettingsStore } from '../core/settings';
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

  it('keeps presets in the order first saved, one per name', () => {
    const presets = new PresetStore(openDatabase(':memory:'));
    expect(presets.list()).toEqual([]);
    presets.save({ name: ' Bug fix ', agent: 'codex', settings: { mode: 'accept-edits' } });
    presets.save({ name: 'Plan a feature', agent: 'claude-code', settings: { mode: 'plan' } });
    expect(presets.save({ name: 'bug FIX', agent: 'claude-code', settings: { cwd: '/w' } })).toEqual([
      { name: 'bug FIX', agent: 'claude-code', settings: { cwd: '/w' } },
      { name: 'Plan a feature', agent: 'claude-code', settings: { mode: 'plan' } },
    ]);
    expect(() => presets.save({ name: '  ', agent: 'codex', settings: {} })).toThrow(
      'A preset needs a name',
    );
  });

  it('remembers the layout, and only what it knows', () => {
    const layout = new LayoutStore(openDatabase(':memory:'));
    expect(layout.get()).toEqual({ current: null, beside: null, lastUsed: null, focus: false, loose: [] });
    const lastUsed = { agent: 'claude-code', settings: { cwd: '/work', mode: 'plan' as const } };
    layout.set({ current: 'a', beside: 'b', lastUsed });
    layout.set({ unknown: 1 } as never);
    expect(layout.get()).toEqual({ current: 'a', beside: 'b', lastUsed, focus: false, loose: [] });
    const loose = [{ chatId: 'c', bounds: { x: 10, y: 20, width: 800, height: 900 } }];
    layout.set({ current: null, beside: null, focus: true, loose });
    expect(layout.get()).toEqual({ current: null, beside: null, lastUsed, focus: true, loose });
  });

  it('keeps the settings, each with its default until set, and refuses what they don’t take', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');
    const db = openDatabase(file);
    const settings = new SettingsStore(db);
    expect(settings.get()).toEqual({
      wording: 'book',
      drawings: true,
      defaultAgent: null,
      newChapter: { from: 'last-used' },
      theme: {},
      accounts: [],
      mcpOff: [],
    });
    settings.set({ wording: 'plain', newChapter: { from: 'preset', preset: 'Bug fix' } });
    settings.set({ theme: { '--gr-page': '#fffaf0', '--gr-size-text': '18px' } });
    settings.set({ accounts: ['me@example.com', 'mum@example.com'] });
    settings.set({ mcpOff: ['github', 'claude.ai Gmail'] });
    expect(() => settings.set({ wording: 'fancy' } as never)).toThrow(`"wording" can't be "fancy"`);
    expect(() => settings.set({ newChapter: { from: 'preset', preset: '' } })).toThrow('"newChapter"');
    expect(() => settings.set({ shelf: 'x' } as never)).toThrow(`There's no setting "shelf"`);
    // A theme changes the book's tokens, and only with a value each.
    expect(() => settings.set({ theme: { color: 'red' } })).toThrow('"theme"');
    expect(() => settings.set({ theme: { '--gr-page': 'red; }' } })).toThrow('"theme"');
    expect(() => settings.set({ theme: { '--gr-page': ' ' } })).toThrow('"theme"');
    // Accounts are emails, each once whatever its case.
    expect(() => settings.set({ accounts: ['not an email'] })).toThrow('"accounts"');
    expect(() => settings.set({ accounts: ['a@x.com', 'A@x.com'] })).toThrow('"accounts"');
    // MCP servers are named, each once.
    expect(() => settings.set({ mcpOff: ['github', 'github'] })).toThrow('"mcpOff"');
    expect(() => settings.set({ mcpOff: [' '] })).toThrow('"mcpOff"');
    // A refused change changes nothing, even the settings given beside it.
    expect(() => settings.set({ drawings: false, defaultAgent: 3 } as never)).toThrow();
    db.close();

    const again = openDatabase(file);
    expect(new SettingsStore(again).get()).toEqual({
      wording: 'plain',
      drawings: true,
      defaultAgent: null,
      newChapter: { from: 'preset', preset: 'Bug fix' },
      theme: { '--gr-page': '#fffaf0', '--gr-size-text': '18px' },
      accounts: ['me@example.com', 'mum@example.com'],
      mcpOff: ['github', 'claude.ai Gmail'],
    });
    again.close();
  });
});
