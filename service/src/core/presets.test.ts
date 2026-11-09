import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../registry';
import { openDatabase } from '../storage/database';
import { PresetStore, registerPresets } from './presets';
import { SettingsStore } from './settings';

function setUp() {
  const db = openDatabase(':memory:');
  const presets = new PresetStore(db);
  const settings = new SettingsStore(db);
  const registry = new CommandRegistry();
  const emit = vi.fn();
  registerPresets(registry, presets, settings, emit);
  return { presets, settings, registry, emit };
}

describe('presets', () => {
  it('keeps a first entry, unless saved again with another or "" for none', () => {
    const { presets } = setUp();
    presets.save({
      name: 'Bug fix',
      agent: 'codex',
      settings: {},
      prompt: ' Fix the failing test ',
    });
    expect(presets.list()[0]!.prompt).toBe('Fix the failing test');
    // Saved again from a chat's settings card, which has no first entry.
    presets.save({ name: 'bug fix', agent: 'codex', settings: { mode: 'plan' } });
    expect(presets.list()).toEqual([
      {
        name: 'bug fix',
        agent: 'codex',
        settings: { mode: 'plan' },
        prompt: 'Fix the failing test',
      },
    ]);
    presets.save({ name: 'bug fix', agent: 'codex', settings: { mode: 'plan' }, prompt: '' });
    expect(presets.list()[0]).not.toHaveProperty('prompt');
  });

  it('renames a preset in its place, to a name no other has', () => {
    const { presets } = setUp();
    presets.save({ name: 'Bug fix', agent: 'codex', settings: {} });
    presets.save({ name: 'Plan a feature', agent: 'claude-code', settings: {} });
    expect(presets.rename('bug fix', ' Fix a bug ').map((p) => p.name)).toEqual([
      'Fix a bug',
      'Plan a feature',
    ]);
    expect(presets.rename('Fix a bug', 'FIX A BUG').map((p) => p.name)).toEqual([
      'FIX A BUG',
      'Plan a feature',
    ]);
    expect(() => presets.rename('FIX A BUG', 'plan a feature')).toThrow(
      'There\'s a preset called "plan a feature" already',
    );
    expect(() => presets.rename('Gone', 'Back')).toThrow('There\'s no preset called "Gone"');
    expect(() => presets.rename('FIX A BUG', ' ')).toThrow('A preset needs a name');
  });

  it('keeps each profile’s presets apart, names and all', () => {
    const db = openDatabase(':memory:');
    const personal = new PresetStore(db, () => 'personal');
    const work = new PresetStore(db, () => 'work');
    personal.save({ name: 'Bug fix', agent: 'codex', settings: {} });
    personal.save({ name: 'Review', agent: 'codex', settings: {} });
    work.save({ name: 'bug fix', agent: 'claude-code', settings: { mode: 'plan' } });
    expect(work.list()).toEqual([
      { name: 'bug fix', agent: 'claude-code', settings: { mode: 'plan' } },
    ]);
    work.rename('bug fix', 'Review');
    work.remove('Review');
    expect(work.list()).toEqual([]);
    expect(personal.list().map((preset) => preset.name)).toEqual(['Bug fix', 'Review']);
  });

  it('keeps new chats beginning with a preset as it’s renamed, and with your last settings once it’s gone', async () => {
    const { registry, settings, emit } = setUp();
    await registry.dispatch('presets.save', { name: 'Bug fix', agent: 'codex', settings: {} });
    await registry.dispatch('presets.save', { name: 'Review', agent: 'codex', settings: {} });
    settings.set({ newChat: { from: 'preset', preset: 'Bug fix' } });

    await registry.dispatch('presets.rename', { from: 'Review', to: 'Read through' });
    expect(emit).not.toHaveBeenCalled();
    await registry.dispatch('presets.rename', { from: 'bug fix', to: 'Fix a bug' });
    expect(settings.get().newChat).toEqual({ from: 'preset', preset: 'Fix a bug' });
    expect(emit).toHaveBeenLastCalledWith('settings.changed', { settings: settings.get() });

    expect(await registry.dispatch('presets.remove', { name: 'Fix a bug' })).toEqual([
      { name: 'Read through', agent: 'codex', settings: {} },
    ]);
    expect(settings.get().newChat).toEqual({ from: 'last-used' });
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
