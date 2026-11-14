import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureCompaction, saveCompaction, windowSet } from './compaction-settings';

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
const file = () => path.join(home, 'settings.json');
const saved = () => JSON.parse(readFileSync(file(), 'utf8')) as unknown;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'grimoire-compaction-'));
  measuring.flags = [];
  measuring.closed = false;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('compaction settings', () => {
  it("reads the model's own window, else every model's, else none", () => {
    expect(windowSet('claude-opus-5-5', home)).toBeUndefined();
    writeFileSync(file(), JSON.stringify({ autoCompactWindow: 300_000 }));
    expect(windowSet('claude-opus-5-5[1m]', home)).toBe(300_000);
    writeFileSync(
      file(),
      JSON.stringify({
        autoCompactWindow: 300_000,
        modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } },
      }),
    );
    expect(windowSet('claude-opus-5-5-20261001', home)).toBe('auto');
  });

  it("saves the window under the model's canonical name and keeps the rest of the file", () => {
    writeFileSync(
      file(),
      JSON.stringify({
        model: 'opus',
        modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh', autoCompactWindow: 400_000 } },
      }),
    );
    saveCompaction('claude-opus-5-5[1m]', { window: 250_000 }, home);
    saveCompaction('claude-opus-5-5', { enabled: false }, home);
    expect(saved()).toEqual({
      model: 'opus',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh', autoCompactWindow: 250_000 } },
      autoCompactEnabled: false,
    });
  });

  it("starts the file when there's none, and leaves one it can't read alone", () => {
    saveCompaction('claude-sonnet-5-5', { window: 'auto' }, home);
    expect(saved()).toEqual({
      modelSettings: { 'claude-sonnet-5-5': { autoCompactWindow: 'auto' } },
    });
    writeFileSync(file(), '{ "model": ');
    expect(() => saveCompaction('claude-sonnet-5-5', { window: 300_000 }, home)).toThrow(
      "Can't read Claude Code's settings",
    );
    expect(readFileSync(file(), 'utf8')).toBe('{ "model": ');
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
