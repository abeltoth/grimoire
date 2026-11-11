import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import { SettingsStore } from './settings';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
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
    settings.set({
      themeName: 'night',
      theme: { '--gr-page': '#fffaf0', '--gr-size-text': '18px' },
    });
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
