import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScheduleStore } from '../schedules/store';
import { Chapters } from '../storage/chapters';
import { openDatabase } from '../storage/database';
import { LayoutStore } from './layout';
import { PresetStore } from './presets';
import { ProfileStore } from './profiles';
import { SettingsStore } from './settings';

let dir: string;
const folderOf = (id: string) => path.join(dir, 'profiles', id, 'claude');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-profiles-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setUp() {
  const db = openDatabase(':memory:');
  return { db, profiles: new ProfileStore(db, folderOf) };
}

describe('ProfileStore', () => {
  it('begins with Personal in use, in Claude Code’s usual place', () => {
    const { profiles } = setUp();
    expect(profiles.list()).toEqual({
      active: 'personal',
      profiles: [{ id: 'personal', name: 'Personal', claudeFolder: null }],
    });
    expect(profiles.active().name).toBe('Personal');
  });

  it('makes a profile with a Claude folder of its own, after the others', () => {
    const { profiles } = setUp();
    expect(profiles.create(' Work ').profiles).toEqual([
      { id: 'personal', name: 'Personal', claudeFolder: null },
      { id: 'work', name: 'Work', claudeFolder: folderOf('work') },
    ]);
    expect(existsSync(folderOf('work'))).toBe(true);
    // A folder left from a deleted profile isn't taken over.
    mkdirSync(folderOf('side-project'), { recursive: true });
    expect(profiles.create('Side project!').profiles.at(-1)!.id).toBe('side-project-2');
    expect(profiles.create('Ünïcode ✓').profiles.at(-1)!.id).toBe('unicode');
    expect(profiles.create('✓✓').profiles.at(-1)!.id).toBe('profile');
  });

  it('turns away a name that’s empty, too long or another profile’s', () => {
    const { profiles } = setUp();
    profiles.create('Work');
    expect(() => profiles.create('  ')).toThrow('A profile needs a name');
    expect(() => profiles.create('x'.repeat(41))).toThrow('at most 40 characters');
    expect(() => profiles.create('WORK')).toThrow('There\'s a profile called "WORK" already');
    expect(() => profiles.rename('work', 'personal')).toThrow(
      'There\'s a profile called "personal" already',
    );
    expect(() => profiles.rename('gone', 'Back')).toThrow('There\'s no profile "gone"');
    expect(profiles.rename('work', ' WORK ').profiles.at(-1)!.name).toBe('WORK');
    expect(profiles.rename('personal', 'Home').profiles[0]!.name).toBe('Home');
  });

  it('switches the profile in use, and the stores keep each profile’s own', () => {
    const { db, profiles } = setUp();
    const settings = new SettingsStore(db);
    const layout = new LayoutStore(db);
    const chapters = new Chapters(db);
    settings.set({ wording: 'plain' });
    layout.set({ current: 'a' });
    chapters.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one' } });
    profiles.create('Work');

    profiles.setActive('work');
    expect(profiles.list().active).toBe('work');
    expect(profiles.active().name).toBe('Work');
    expect(settings.get().wording).toBe('book');
    expect(layout.get().current).toBeNull();
    expect(chapters.list()).toEqual([]);
    settings.set({ accounts: ['me@work.com'] });
    chapters.add({ chatId: 'b', agent: 'claude-code', settings: { cwd: '/two' } });

    profiles.setActive('personal');
    expect(settings.get()).toMatchObject({ wording: 'plain', accounts: [] });
    expect(layout.get().current).toBe('a');
    expect(chapters.list().map((chapter) => chapter.chatId)).toEqual(['a']);
    expect(() => profiles.setActive('gone')).toThrow('There\'s no profile "gone"');
  });

  it('deletes a profile and what it kept, but not Personal, the one in use, or its folder', () => {
    const { db, profiles } = setUp();
    profiles.create('Work');
    profiles.setActive('work');
    expect(() => profiles.remove('work')).toThrow('"Work" is in use');
    new SettingsStore(db).set({ wording: 'plain' });
    new PresetStore(db).save({ name: 'Bug fix', agent: 'codex', settings: {} });
    const schedules = new ScheduleStore(db);
    const morning = { name: 'Morning', agent: 'codex', settings: {}, prompt: 'Hi', days: [1] };
    const { id } = schedules.save({ ...morning, time: '08:00', enabled: true }, 0);
    schedules.addRun({ scheduleId: id, dueAt: 1, outcome: 'missed' });

    profiles.setActive('personal');
    expect(() => profiles.remove('personal')).toThrow('"Personal"');
    expect(profiles.remove('work').profiles.map((profile) => profile.id)).toEqual(['personal']);
    expect(existsSync(folderOf('work'))).toBe(true);
    for (const table of ['settings', 'presets', 'schedules', 'schedule_runs']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });
});
