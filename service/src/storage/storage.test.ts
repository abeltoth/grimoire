import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../core/layout';
import { PresetStore } from '../core/presets';
import { ProfileStore } from '../core/profiles';
import { SettingsStore } from '../core/settings';
import { OpenChats } from './open-chats';
import { migrate, openDatabase } from './database';
import { Pins } from './pins';
import { EntryIds } from './entry-ids';
import { Parallels } from './parallels';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('storage', () => {
  it("migrates each owner's tables on its own, from the version it's at", () => {
    const db = openDatabase(':memory:');
    const first = ['CREATE TABLE a (x TEXT)'];
    migrate(db, 'one', first);
    migrate(db, 'one', [...first, 'ALTER TABLE a ADD COLUMN y TEXT']);
    migrate(db, 'two', ['CREATE TABLE b (x TEXT)']);
    expect(db.prepare('SELECT owner, version FROM schema_versions ORDER BY owner').all()).toEqual([
      { owner: 'core', version: 1 },
      { owner: 'one', version: 2 },
      { owner: 'two', version: 1 },
    ]);
    db.exec("INSERT INTO a (x, y) VALUES ('1', '2')");
  });

  it('leaves an owner at its last good version when a migration fails', () => {
    const db = openDatabase(':memory:');
    expect(() => migrate(db, 'one', ['CREATE TABLE a (x TEXT)', 'CREATE TABLE a (x TEXT)'])).toThrow();
    expect(db.prepare("SELECT version FROM schema_versions WHERE owner = 'one'").get()).toEqual({ version: 1 });
  });

  it('starts a database versioned as one whole again, empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE chapters (chat_id TEXT); INSERT INTO chapters VALUES ('a'); PRAGMA user_version = 22");
    old.close();

    const db = openDatabase(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((table) => table.name)).not.toContain('chapters');
    expect(new ProfileStore(db, () => dir).list().active).toBe('personal');
    db.close();
  });

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

  it('keeps open chats in order across restarts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const first = openDatabase(file);
    const chats = new OpenChats(first);
    chats.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one' } });
    chats.add({ chatId: 'b', agent: 'claude-code', settings: { cwd: '/two' } });
    chats.add({ chatId: 'c', agent: 'claude-code', settings: { cwd: '/three' } });
    chats.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one', model: 'opus' } });
    chats.remove('b');
    first.close();

    const again = openDatabase(file);
    expect(new OpenChats(again).list()).toEqual([
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

  it('keeps each chat\'s pins', () => {
    const pins = new Pins(openDatabase(':memory:'));
    pins.set('a', 'star', true);
    pins.set('a', 'pin', true);
    pins.set('a', 'pin', true);
    pins.set('b', 'pin', true);
    pins.set('b', 'pin', false);
    expect(pins.of('a')).toEqual(['pin', 'star']);
    expect(pins.of('b')).toEqual([]);
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
    expect(layout.get()).toEqual({ current: null, beside: null, lastUsed: null, focus: false, popouts: [] });
    const lastUsed = { agent: 'claude-code', settings: { cwd: '/work', mode: 'plan' as const } };
    layout.set({ current: 'a', beside: 'b', lastUsed });
    layout.set({ unknown: 1 } as never);
    expect(layout.get()).toEqual({ current: 'a', beside: 'b', lastUsed, focus: false, popouts: [] });
    const popouts = [{ chatId: 'c', bounds: { x: 10, y: 20, width: 800, height: 900 } }];
    layout.set({ current: null, beside: null, focus: true, popouts });
    expect(layout.get()).toEqual({ current: null, beside: null, lastUsed, focus: true, popouts });
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
      newChat: { from: 'last-used' },
      themeName: 'grimoire',
      theme: {},
      accounts: [],
      mcpOff: [],
      suggestions: true,
      followUps: true,
      jiraQuery:
        'assignee = currentUser() AND (statusCategory != Done OR statusCategoryChangedDate >= -14d) ORDER BY updated DESC',
    });
    settings.set({ wording: 'plain', newChat: { from: 'preset', preset: 'Bug fix' } });
    settings.set({ themeName: 'night', theme: { '--gr-page': '#fffaf0', '--gr-size-text': '18px' } });
    settings.set({ themeName: 'auto' });
    expect(() => settings.set({ themeName: 'neon' } as never)).toThrow('"themeName"');
    settings.set({ accounts: ['me@example.com', 'mum@example.com'] });
    settings.set({ mcpOff: ['github', 'claude.ai Gmail'] });
    settings.set({ suggestions: false });
    expect(() => settings.set({ suggestions: 'no' } as never)).toThrow('"suggestions"');
    settings.set({ followUps: false });
    expect(() => settings.set({ followUps: 'rarely' } as never)).toThrow('"followUps"');
    settings.set({ jiraQuery: 'project = GRIM ORDER BY rank' });
    expect(() => settings.set({ jiraQuery: ' ' })).toThrow('"jiraQuery"');
    expect(() => settings.set({ wording: 'fancy' } as never)).toThrow(`"wording" can't be "fancy"`);
    expect(() => settings.set({ newChat: { from: 'preset', preset: '' } })).toThrow('"newChat"');
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
      newChat: { from: 'preset', preset: 'Bug fix' },
      themeName: 'auto',
      theme: { '--gr-page': '#fffaf0', '--gr-size-text': '18px' },
      accounts: ['me@example.com', 'mum@example.com'],
      mcpOff: ['github', 'claude.ai Gmail'],
      suggestions: false,
      followUps: false,
      jiraQuery: 'project = GRIM ORDER BY rank',
    });
    again.close();
  });
});
