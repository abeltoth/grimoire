import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitEffort } from '@grimoire/contract';
import { canonicalModel, defaultEffort, readUserSettings } from './effort';

describe('canonicalModel', () => {
  it('drops the context size and the date', () => {
    expect(canonicalModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
    expect(canonicalModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(canonicalModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });
});

describe('defaultEffort', () => {
  const settings = {
    effortLevel: 'high',
    modelSettings: {
      'claude-opus-5-5[1m]': { effortLevel: 'low' },
      'claude-opus-5-5': { effortLevel: 'xhigh' },
      'claude-haiku-5-5[1m]': { effortLevel: 'medium' },
      'claude-fable-5-1': { effortLevel: 'nonsense' },
    },
  };

  it("takes the model's own level, the canonical key first", () => {
    expect(defaultEffort('claude-opus-5-5[1m]', settings, {})).toBe('xhigh');
    expect(defaultEffort('claude-haiku-5-5', settings, {})).toBe('medium');
  });

  it("doesn't guess from the top-level level, which Claude Code skips for most models", () => {
    expect(defaultEffort('claude-sonnet-5-5', settings, {})).toBeUndefined();
    expect(defaultEffort('claude-fable-5-1', settings, {})).toBeUndefined();
  });

  it('lets CLAUDE_CODE_EFFORT_LEVEL win, and says nothing when nothing is set', () => {
    expect(defaultEffort('claude-opus-5-5', settings, { CLAUDE_CODE_EFFORT_LEVEL: 'low' })).toBe(
      'low',
    );
    expect(
      defaultEffort('claude-opus-5-5', {}, { CLAUDE_CODE_EFFORT_LEVEL: 'unset' }),
    ).toBeUndefined();
  });
});

describe('fitEffort', () => {
  it('keeps a level the model takes, and steps down to one it does', () => {
    expect(fitEffort('xhigh', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('xhigh');
    expect(fitEffort('xhigh', ['low', 'medium', 'high', 'max'])).toBe('high');
    expect(fitEffort(undefined, ['low'])).toBeUndefined();
  });
});

describe('readUserSettings', () => {
  it('reads settings.json from the Claude config folder, or gives none', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-claude-'));
    try {
      writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ effortLevel: 'medium' }));
      expect(readUserSettings({ CLAUDE_CONFIG_DIR: dir })).toEqual({ effortLevel: 'medium' });
      expect(readUserSettings({ CLAUDE_CONFIG_DIR: path.join(dir, 'missing') })).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
