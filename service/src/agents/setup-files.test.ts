import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentSetup } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetupFiles } from './setup-files';

let dir: string;
let files: SetupFiles;
let reads: number;
let setup: AgentSetup;
const at = (...parts: string[]) => path.join(dir, ...parts);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-setup-files-'));
  writeFileSync(at('CLAUDE.md'), '# The project');
  writeFileSync(at('managed.json'), '{}');
  writeFileSync(at('hooks.json'), '{}');
  setup = {
    cwd: dir,
    sections: {
      memory: [{ name: 'CLAUDE.md', source: 'project', path: at('CLAUDE.md') }],
      skills: [],
      agents: [],
      commands: [],
      hooks: [{ name: 'Stop', source: 'plugin', plugin: 'ship', path: at('hooks.json') }],
      mcpServers: [],
      plugins: [],
      permissions: [],
    },
    settingsFiles: [
      { source: 'local', path: at('.claude', 'settings.local.json'), exists: false },
      { source: 'managed', path: at('managed.json'), exists: true },
    ],
    at: 1,
  };
  reads = 0;
  files = new SetupFiles(async () => {
    reads++;
    return setup;
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SetupFiles', () => {
  it('opens a file the setup lists, asking for the setup once when it has none', async () => {
    const opened = await files.open('claude-code', dir, at('CLAUDE.md'));
    expect(opened).toMatchObject({
      path: at('CLAUDE.md'),
      text: '# The project',
      exists: true,
      editable: true,
    });
    expect(opened.changedAt).toBeGreaterThan(0);
    await files.open('claude-code', dir, at('CLAUDE.md'));
    expect(reads).toBe(1);
  });

  it('opens a settings file that doesn’t exist yet as empty', async () => {
    files.remember('claude-code', setup);
    expect(await files.open('claude-code', dir, at('.claude', 'settings.local.json'))).toEqual({
      path: at('.claude', 'settings.local.json'),
      text: '',
      exists: false,
      changedAt: 0,
      editable: true,
    });
  });

  it('opens the managed settings and a plugin’s files only to read', async () => {
    files.remember('claude-code', setup);
    expect((await files.open('claude-code', dir, at('managed.json'))).editable).toBe(false);
    expect((await files.open('claude-code', dir, at('hooks.json'))).editable).toBe(false);
    await expect(files.save('claude-code', dir, at('managed.json'), '{"x":1}', 0)).rejects.toThrow(
      'This file can only be read here.',
    );
  });

  it('opens nothing the setup doesn’t list', async () => {
    writeFileSync(at('secret.txt'), 'no');
    await expect(files.open('claude-code', dir, at('secret.txt'))).rejects.toThrow(
      'Only the files the agent loads can be opened here.',
    );
    // It asked once more, in case the file had just been added.
    expect(reads).toBe(1);
  });

  it('saves a file, making its folder when it has none', async () => {
    const file = at('.claude', 'settings.local.json');
    const saved = await files.save('claude-code', dir, file, '{ "permissions": {} }\n', 0);
    expect(readFileSync(file, 'utf8')).toBe('{ "permissions": {} }\n');
    expect(saved).toMatchObject({ exists: true, text: '{ "permissions": {} }\n', editable: true });
  });

  it('won’t save a settings file that isn’t valid JSON', async () => {
    await expect(
      files.save('claude-code', dir, at('.claude', 'settings.local.json'), '{ nope', 0),
    ).rejects.toThrow(/^This isn’t valid JSON, so Claude Code couldn’t read it: /);
  });

  it('won’t save over a change made on disk since the file was opened', async () => {
    const opened = await files.open('claude-code', dir, at('CLAUDE.md'));
    writeFileSync(at('CLAUDE.md'), '# Changed elsewhere');
    utimesSync(at('CLAUDE.md'), new Date(), new Date(opened.changedAt + 5000));
    await expect(
      files.save('claude-code', dir, at('CLAUDE.md'), '# Mine', opened.changedAt),
    ).rejects.toThrow('It changed on disk since you opened it. Open it again to see the change.');
    expect(readFileSync(at('CLAUDE.md'), 'utf8')).toBe('# Changed elsewhere');

    const again = await files.open('claude-code', dir, at('CLAUDE.md'));
    await files.save('claude-code', dir, at('CLAUDE.md'), '# Mine', again.changedAt);
    expect(readFileSync(at('CLAUDE.md'), 'utf8')).toBe('# Mine');
  });
});
