import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedBy, measureCompaction, saveCompaction, windowSet } from './compaction-settings';

/** What the measuring process answers, with compaction as its settings and then as flagged. */
const measuring = vi.hoisted(() => ({ flags: [] as unknown[], closed: false }));
vi.mock('./probe', async (original) => ({
  ...(await original<typeof import('./probe')>()),
  sdk: async () => ({
    query: () => {
      let enabled: boolean | undefined;
      return {
        getContextUsage: async () =>
          enabled === false
            ? { rawMaxTokens: 1_000_000, isAutoCompactEnabled: false }
            : {
                rawMaxTokens: 400_000,
                autoCompactThreshold: 367_000,
                isAutoCompactEnabled: enabled ?? false,
              },
        applyFlagSettings: async (flags: { autoCompactEnabled: boolean }) => {
          measuring.flags.push(flags);
          enabled = flags.autoCompactEnabled;
        },
        close: () => (measuring.closed = true),
      };
    },
  }),
}));

let home: string;
let folder: string;
const file = () => path.join(home, 'settings.json');
const project = () => path.join(folder, '.claude', 'settings.json');
const local = () => path.join(folder, '.claude', 'settings.local.json');
const json = (at: string) => JSON.parse(readFileSync(at, 'utf8')) as unknown;
const put = (at: string, settings: object) => writeFileSync(at, JSON.stringify(settings));

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'grimoire-compaction-'));
  folder = mkdtempSync(path.join(tmpdir(), 'grimoire-folder-'));
  mkdirSync(path.join(folder, '.claude'));
  measuring.flags = [];
  measuring.closed = false;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

describe('compaction settings', () => {
  it("reads the model's own window, else every model's, from the file Claude Code takes it from", () => {
    expect(windowSet('claude-opus-5-5', folder, home)).toBeUndefined();
    put(file(), { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } } });
    expect(windowSet('claude-opus-5-5-20261001', folder, home)).toBe('auto');
    put(project(), { autoCompactWindow: 300_000 });
    expect(windowSet('claude-opus-5-5[1m]', folder, home)).toBe(300_000);
    put(local(), { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 250_000 } } });
    expect(windowSet('claude-opus-5-5', folder, home)).toBe(250_000);
  });

  it("saves in your settings, under the model's canonical name, keeping the rest of the file", () => {
    put(file(), {
      model: 'opus',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh', autoCompactWindow: 400_000 } },
    });
    saveCompaction('claude-opus-5-5[1m]', { window: 250_000 }, folder, home);
    saveCompaction('claude-opus-5-5', { enabled: false }, folder, home);
    expect(json(file())).toEqual({
      model: 'opus',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh', autoCompactWindow: 250_000 } },
      autoCompactEnabled: false,
    });
  });

  it("saves where the folder's settings set it already", () => {
    put(file(), { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400_000 } } });
    put(project(), { autoCompactWindow: 300_000, autoCompactEnabled: true });
    saveCompaction('claude-opus-5-5', { window: 600_000, enabled: false }, folder, home);
    expect(json(project())).toEqual({
      autoCompactWindow: 300_000,
      autoCompactEnabled: false,
      modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 600_000 } },
    });
    expect(json(file())).toEqual({
      modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400_000 } },
    });
    expect(windowSet('claude-opus-5-5', folder, home)).toBe(600_000);
  });

  it("starts your settings when there are none, and leaves a file it can't read alone", () => {
    saveCompaction('claude-sonnet-5-5', { window: 'auto' }, folder, home);
    expect(json(file())).toEqual({
      modelSettings: { 'claude-sonnet-5-5': { autoCompactWindow: 'auto' } },
    });
    writeFileSync(file(), '{ "model": ');
    expect(() => saveCompaction('claude-sonnet-5-5', { window: 300_000 }, folder, home)).toThrow(
      "Can't read",
    );
    expect(readFileSync(file(), 'utf8')).toBe('{ "model": ');
  });

  it('says what fixes the window ahead of the files it can change', () => {
    expect(fixedBy('claude-opus-5-5', {}, 'linux')).toBeUndefined();
    expect(fixedBy('claude-opus-5-5', { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' }, 'linux')).toBe(
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    );
  });

  it("measures whether it compacts, how far before the end, and the model's own window", async () => {
    expect(await measureCompaction('claude-opus-5-5', home)).toEqual({
      enabled: false,
      max: 1_000_000,
      reserve: 33_000,
    });
    expect(measuring.flags).toEqual([{ autoCompactEnabled: true }, { autoCompactEnabled: false }]);
    expect(measuring.closed).toBe(true);
  });
});
