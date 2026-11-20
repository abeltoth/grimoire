import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chromeArgs, chromeOn, saveChromeOn } from './chrome';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-chrome-'));
  file = path.join(dir, '.claude.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('chromeOn', () => {
  it('reads Claude Code’s "Enabled by default"', () => {
    expect(chromeOn(file)).toBe(false);
    writeFileSync(file, JSON.stringify({ claudeInChromeDefaultEnabled: true }));
    expect(chromeOn(file)).toBe(true);
    writeFileSync(file, JSON.stringify({ claudeInChromeDefaultEnabled: false }));
    expect(chromeOn(file)).toBe(false);
  });

  it('keeps the last value read while the file is half written', () => {
    writeFileSync(file, JSON.stringify({ claudeInChromeDefaultEnabled: true }));
    expect(chromeOn(file)).toBe(true);
    writeFileSync(file, '{"claudeInChromeDefault');
    expect(chromeOn(file)).toBe(true);
  });
});

describe('chromeArgs', () => {
  it('connects a process to Claude in Chrome only when it is on', () => {
    expect(chromeArgs(true)).toEqual({ chrome: null });
    expect(chromeArgs(false)).toEqual({});
  });
});

describe('saveChromeOn', () => {
  it('writes the setting through the CLI', async () => {
    const runs: [string[], string][] = [];
    await saveChromeOn(true, async (args, input) => {
      runs.push([args, input]);
      return { code: 0, output: '{"ok":true}' };
    });
    expect(runs).toEqual([[['edit-chrome-settings', '--json'], '{"enabledByDefault":true}']]);
  });

  it('says why the CLI refused', async () => {
    await expect(
      saveChromeOn(false, async () => ({ code: 1, output: 'Not signed in\n' })),
    ).rejects.toThrow('Not signed in');
  });
});
