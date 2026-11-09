import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter } from '../agents/claude/claude-adapter';
import { useClaudeFolder } from '../agents/claude/config-dir';
import { CardStore } from '../kanban/store';
import { CommandRegistry } from '../registry';
import { ScheduleStore } from '../schedules/store';
import { OpenChats } from '../storage/open-chats';
import { openDatabase } from '../storage/database';
import { LayoutStore } from './layout';
import { PresetStore } from './presets';
import { ProfileStore, type Switching, registerProfiles, switchProfile } from './profiles';
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
    const chats = new OpenChats(db);
    settings.set({ wording: 'plain' });
    layout.set({ current: 'a' });
    chats.add({ chatId: 'a', agent: 'claude-code', settings: { cwd: '/one' } });
    profiles.create('Work');

    profiles.setActive('work');
    expect(profiles.list().active).toBe('work');
    expect(profiles.active().name).toBe('Work');
    expect(settings.get().wording).toBe('book');
    expect(layout.get().current).toBeNull();
    expect(chats.list()).toEqual([]);
    settings.set({ accounts: ['me@work.com'] });
    chats.add({ chatId: 'b', agent: 'claude-code', settings: { cwd: '/two' } });

    profiles.setActive('personal');
    expect(settings.get()).toMatchObject({ wording: 'plain', accounts: [] });
    expect(layout.get().current).toBe('a');
    expect(chats.list().map((chat) => chat.chatId)).toEqual(['a']);
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
    const cards = new CardStore(db);
    const [card] = cards.save({ title: 'Tests', notes: '', cwd: '/git' });
    cards.link(card!.id, { chatId: 'chat-1', agent: 'codex', cwd: '/git' });

    profiles.setActive('personal');
    expect(() => profiles.remove('personal')).toThrow('"Personal"');
    expect(profiles.remove('work').profiles.map((profile) => profile.id)).toEqual(['personal']);
    expect(existsSync(folderOf('work'))).toBe(true);
    for (const table of ['settings', 'presets', 'schedules', 'schedule_runs', 'cards', 'card_chats']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });
});

describe('switchProfile', () => {
  function switching(busy?: string) {
    const steps: string[] = [];
    const emit = vi.fn((event: string) => void steps.push(`emit ${event}`));
    const switches: Switching = {
      busy: () => busy,
      putAway: () => void steps.push('putAway'),
      reset: () => void steps.push('reset'),
      useClaudeFolder: (folder) => void steps.push(`useClaudeFolder ${folder}`),
      restart: () => void steps.push('restart'),
      announce: () => void steps.push('announce'),
    };
    return { steps, emit, switches };
  }

  it('puts the chats away, moves Claude Code to the profile’s folder, then starts again and tells', () => {
    const { profiles } = setUp();
    profiles.create('Work');
    const { steps, emit, switches } = switching();

    const all = switchProfile('work', profiles, switches, emit);
    expect(all.active).toBe('work');
    expect(profiles.active().id).toBe('work');
    expect(steps).toEqual([
      'putAway',
      'reset',
      `useClaudeFolder ${folderOf('work')}`,
      'restart',
      'emit profiles.changed',
      'announce',
    ]);
    expect(emit).toHaveBeenCalledWith('profiles.changed', { profiles: all });

    steps.length = 0;
    switchProfile('personal', profiles, switches, emit);
    expect(steps[2]).toBe('useClaudeFolder null');
  });

  it('is refused while the chats are busy, and does nothing for the profile in use', () => {
    const { profiles } = setUp();
    profiles.create('Work');
    const busy = switching('Wait for "Fix the ribbon" to finish, or stop it, first');
    expect(() => switchProfile('work', profiles, busy.switches, busy.emit)).toThrow(
      'Can\'t switch to "Work" yet. Wait for "Fix the ribbon" to finish, or stop it, first',
    );
    expect(() => switchProfile('gone', profiles, busy.switches, busy.emit)).toThrow(
      'There\'s no profile "gone"',
    );
    const same = switching();
    expect(switchProfile('personal', profiles, same.switches, same.emit).active).toBe('personal');
    expect([...busy.steps, ...same.steps]).toEqual([]);
    expect(profiles.active().id).toBe('personal');
  });

  it('tells every window of a profile made, renamed or deleted', async () => {
    const { profiles } = setUp();
    const { emit, switches } = switching();
    const registry = new CommandRegistry();
    registerProfiles(registry, profiles, switches, emit);
    await registry.dispatch('profiles.create', { name: 'Work' });
    await registry.dispatch('profiles.rename', { id: 'work', name: 'Office' });
    expect(await registry.dispatch('profiles.list', {})).toEqual(profiles.list());
    await registry.dispatch('profiles.remove', { id: 'work' });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      'profiles.changed',
      'profiles.changed',
      'profiles.changed',
    ]);
    expect(emit).toHaveBeenLastCalledWith('profiles.changed', { profiles: profiles.list() });
  });

  it('has Claude Code read the saved chats in the new profile’s folder', async () => {
    const { profiles } = setUp();
    profiles.create('Work');
    const cwd = path.join(dir, 'project');
    mkdirSync(cwd);
    const saved = path.join(folderOf('work'), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(saved, { recursive: true });
    const id = randomUUID();
    const message = { role: 'user', content: 'Plan the release' };
    const line = { type: 'user', message, uuid: randomUUID(), sessionId: id, cwd };
    writeFileSync(path.join(saved, `${id}.jsonl`), `${JSON.stringify(line)}\n`);
    const claude = new ClaudeAdapter();
    const { emit, switches } = switching();

    try {
      switchProfile('work', profiles, { ...switches, useClaudeFolder }, emit);
      expect(await claude.listChats(cwd)).toMatchObject([{ id, title: 'Plan the release', cwd }]);
      switchProfile('personal', profiles, { ...switches, useClaudeFolder }, emit);
      expect(await claude.listChats(cwd)).toEqual([]);
    } finally {
      useClaudeFolder(null);
    }
  });
});
