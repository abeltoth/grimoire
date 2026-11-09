import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { managedSettingsPath, readSettingsFile, settingsFilesIn } from './settings-files';

const home = path.join(path.sep, 'home', 'me');
const cwd = path.join(home, 'git', 'grimoire');
const at = (...parts: string[]) => path.join(cwd, ...parts);
const mine = (...parts: string[]) => path.join(home, ...parts);

describe('settingsFilesIn', () => {
  it('lists your settings, the project’s, your own for the project, then the managed ones', () => {
    expect(settingsFilesIn(cwd, mine('.claude'), 'linux')).toEqual([
      { source: 'user', path: mine('.claude', 'settings.json') },
      { source: 'project', path: at('.claude', 'settings.json') },
      { source: 'local', path: at('.claude', 'settings.local.json') },
      { source: 'managed', path: '/etc/claude-code/managed-settings.json' },
    ]);
  });

  it('lists your settings once in your home folder', () => {
    expect(settingsFilesIn(home, mine('.claude'), 'darwin').map((file) => file.source)).toEqual([
      'user',
      'local',
      'managed',
    ]);
  });

  it('reads your settings from the Claude folder in use', () => {
    const work = path.join(path.sep, 'profiles', 'work', 'claude');
    expect(settingsFilesIn(home, work, 'linux')).toEqual([
      { source: 'user', path: path.join(work, 'settings.json') },
      { source: 'project', path: mine('.claude', 'settings.json') },
      { source: 'local', path: mine('.claude', 'settings.local.json') },
      { source: 'managed', path: '/etc/claude-code/managed-settings.json' },
    ]);
  });

  it('knows where each system keeps the managed settings', () => {
    expect(managedSettingsPath('win32')).toBe(
      'C:\\Program Files\\ClaudeCode\\managed-settings.json',
    );
    expect(managedSettingsPath('darwin')).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    );
  });
});

describe('readSettingsFile', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads a settings file, and says why one could not be read', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'grimoire-setup-'));
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    writeFileSync(good, '{"permissions":{"allow":["Read"]}}');
    writeFileSync(bad, '{ nope');
    expect(readSettingsFile({ source: 'user', path: good })).toEqual({
      source: 'user',
      path: good,
      exists: true,
      settings: { permissions: { allow: ['Read'] } },
    });
    expect(readSettingsFile({ source: 'user', path: bad }).problem).toMatch(/^Couldn't be read: /);
    expect(readSettingsFile({ source: 'local', path: path.join(dir, 'none.json') })).toEqual({
      source: 'local',
      path: path.join(dir, 'none.json'),
      exists: false,
    });
  });
});
