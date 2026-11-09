import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../core/layout';
import { PresetStore } from '../core/presets';
import { ProfileStore } from '../core/profiles';
import { SettingsStore } from '../core/settings';
import { ScheduleStore } from '../schedules/store';
import { OpenChats } from './open-chats';
import { openDatabase } from './database';
import { Pins } from './pins';
import { EntryIds } from './entry-ids';
import { Parallels } from './parallels';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('storage', () => {
  it('makes what a database from before profiles kept Personal’s', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const old = openDatabase(file, 12);
    old.exec(`INSERT INTO settings (key, value) VALUES ('wording', '"plain"')`);
    old.exec(`INSERT INTO layout (key, value) VALUES ('current', '"a"')`);
    old.exec(
      `INSERT INTO presets (name, agent, settings, position, prompt)
       VALUES ('Bug fix', 'claude-code', '{}', 0, 'Fix it')`,
    );
    old.exec(
      `INSERT INTO chapters (chat_id, agent, settings, position) VALUES ('a', 'claude-code', '{}', 1)`,
    );
    old.exec(
      `INSERT INTO schedules (id, name, agent, settings, prompt, days, time, enabled, handled_until, position)
       VALUES ('s', 'Morning', 'claude-code', '{}', 'Hi', '[1]', '08:00', 1, 0, 0)`,
    );
    old.close();

    const db = openDatabase(file);
    expect(new ProfileStore(db, () => dir).list()).toEqual({
      active: 'personal',
      profiles: [{ id: 'personal', name: 'Personal', claudeFolder: null }],
    });
    expect(new SettingsStore(db).get().wording).toBe('plain');
    expect(new LayoutStore(db).get().current).toBe('a');
    expect(new PresetStore(db).list()).toEqual([
      { name: 'Bug fix', agent: 'claude-code', settings: {}, prompt: 'Fix it' },
    ]);
    expect(new OpenChats(db).list()).toEqual([{ chatId: 'a', agent: 'claude-code', settings: {} }]);
    expect(new ScheduleStore(db).list().map((schedule) => schedule.name)).toEqual(['Morning']);
    db.close();
  });

  it('moves what worked in a worktree Grimoire made for a chat to the folder it was made from', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');
    const tree = 'C:\\git\\app\\.claude\\worktrees\\meter';

    const old = openDatabase(file, 16);
    old.exec(
      `INSERT INTO worktrees (path, repo, branch, created_at) VALUES
         ('${tree}', 'C:\\git\\app', 'grimoire/meter', 1),
         ('/home/me/app/.claude/worktrees/x', '/home/me/app', 'grimoire/x', 1)`,
    );
    const chat = (id: string, settings: object) =>
      old
        .prepare('INSERT INTO chapters (chat_id, agent, settings, position) VALUES (?, ?, ?, ?)')
        .run(id, 'claude-code', JSON.stringify(settings), id.charCodeAt(0));
    chat('a', { cwd: tree, worktree: true, model: 'opus' });
    // A folder inside it, written in another case.
    chat('b', { cwd: 'c:\\git\\app\\.claude\\worktrees\\meter\\ui', worktree: true });
    chat('c', { cwd: '/home/me/app/.claude/worktrees/x/src', worktree: true });
    // A folder whose name only begins like one.
    chat('d', { cwd: `${tree}-2` });
    old.exec(
      `INSERT INTO card_chats (card_id, chat_id, agent, cwd, at) VALUES ('k', 'a', 'claude-code', '${tree}', 1);
       INSERT INTO cards (id, profile, kind, title, notes, cwd, column_id, position, created_at, made_in_chat, made_in_agent, made_in_cwd)
         VALUES ('k', 'personal', 'task', 'Meter', '', 'C:\\git\\app', 'todo', 1, 1, 'a', 'claude-code', '${tree}');
       INSERT INTO schedule_runs (schedule_id, due_at, outcome, chat_id, cwd) VALUES ('s', 1, 'ran', 'a', '${tree}');
       INSERT INTO presets (profile, name, agent, settings, position) VALUES ('personal', 'Own tree', 'claude-code', '{"worktree":true,"mode":"plan"}', 1);
       INSERT INTO layout (profile, key, value) VALUES ('personal', 'lastUsed', '{"agent":"claude-code","settings":{"cwd":"C:\\\\git\\\\app","worktree":true}}');`,
    );
    old.close();

    const db = openDatabase(file);
    expect(new OpenChats(db).list().map((c) => c.settings)).toEqual([
      { cwd: 'C:\\git\\app', model: 'opus' },
      { cwd: 'C:\\git\\app\\ui' },
      { cwd: '/home/me/app/src' },
      { cwd: `${tree}-2` },
    ]);
    const cwdOf = (sql: string) => (db.prepare(sql).get() as { cwd: string }).cwd;
    expect(cwdOf('SELECT cwd FROM card_chats')).toBe('C:\\git\\app');
    expect(cwdOf('SELECT made_in_cwd AS cwd FROM cards')).toBe('C:\\git\\app');
    expect(cwdOf('SELECT cwd FROM schedule_runs')).toBe('C:\\git\\app');
    expect(new PresetStore(db).list()[0]?.settings).toEqual({ mode: 'plan' });
    expect(new LayoutStore(db).get().lastUsed).toEqual({ agent: 'claude-code', settings: { cwd: 'C:\\git\\app' } });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'worktrees'").get()).toBeUndefined();
    db.close();
  });

  it('keeps what was stored under the old names: open chats, pins, popouts, the new-chat start and theme changes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const old = openDatabase(file, 18);
    old.exec(
      `INSERT INTO chapters (chat_id, agent, settings, position) VALUES ('a', 'claude-code', '{}', 1);
       INSERT INTO dog_ears (chat_id, dog_ear) VALUES ('a', 'star');
       INSERT INTO layout (profile, key, value) VALUES ('personal', 'loose', '[{"chatId":"b"}]');
       INSERT INTO settings (profile, key, value) VALUES
         ('personal', 'newChapter', '{"from":"preset","preset":"Bug fix"}'),
         ('personal', 'theme', '{"--gr-ribbon-ink":"#123456","--gr-ink":"#000000"}');`,
    );
    old.close();

    const db = openDatabase(file);
    expect(new OpenChats(db).list()).toEqual([{ chatId: 'a', agent: 'claude-code', settings: {} }]);
    expect(new Pins(db).of('a')).toEqual(['star']);
    expect(new LayoutStore(db).get().popouts).toEqual([{ chatId: 'b' }]);
    const settings = new SettingsStore(db).get();
    expect(settings.newChat).toEqual({ from: 'preset', preset: 'Bug fix' });
    expect(settings.theme).toEqual({ '--gr-chat-tab-ink': '#123456', '--gr-ink': '#000000' });
    db.close();
  });

  it("keeps a saved theme's changes to the search fields under their new names", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');

    const old = openDatabase(file, 19);
    old.exec(
      `INSERT INTO settings (profile, key, value) VALUES
         ('personal', 'theme', '{"--gr-size-history-look-up":"20px","--gr-ink":"#000000"}');`,
    );
    old.close();

    const db = openDatabase(file);
    expect(new SettingsStore(db).get().theme).toEqual({ '--gr-size-history-search': '20px', '--gr-ink': '#000000' });
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
