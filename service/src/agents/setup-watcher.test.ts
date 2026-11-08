import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentSetup } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWatcher, watchTargets } from './setup-watcher';

let dir: string;
let home: string;
let cwd: string;
let watcher: SetupWatcher | undefined;

const setupIn = (folder: string): AgentSetup => ({
  cwd: folder,
  sections: {
    memory: [
      { name: 'CLAUDE.md', source: 'user', path: path.join(home, '.claude', 'CLAUDE.md') },
      { name: 'CLAUDE.md', source: 'project', path: path.join(folder, 'CLAUDE.md') },
    ],
    skills: [],
    agents: [],
    commands: [],
    hooks: [],
    mcpServers: [],
    plugins: [],
    permissions: [],
  },
  settingsFiles: [
    { source: 'user', path: path.join(home, '.claude', 'settings.json'), exists: true },
    { source: 'local', path: path.join(folder, '.claude', 'settings.local.json'), exists: false },
  ],
  at: 1,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-watch-'));
  home = path.join(dir, 'home');
  cwd = path.join(dir, 'project');
  mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Mine');
  writeFileSync(path.join(home, '.claude', 'settings.json'), '{}');
  writeFileSync(path.join(cwd, 'CLAUDE.md'), '# The project');
});

afterEach(() => {
  watcher?.dispose();
  watcher = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('watchTargets', () => {
  it('watches the folders the files are in for those files, and where new pieces appear', () => {
    const targets = watchTargets(setupIn(cwd), path.join(home, '.claude'));
    const named = Object.fromEntries(
      targets.map(({ folder, names }) => [
        path.relative(dir, folder).replaceAll('\\', '/'),
        names === '*' ? '*' : [...names].sort(),
      ]),
    );
    expect(named).toEqual({
      'home/.claude': ['CLAUDE.md', 'settings.json'],
      'home/.claude/skills': '*',
      // The project's .claude folder doesn't exist yet: the project folder is watched for it.
      project: ['.claude', '.mcp.json', 'CLAUDE.local.md', 'CLAUDE.md'],
    });
  });
});

describe('SetupWatcher', () => {
  it('tells once the files settle when one of them changes, but not for others beside them', async () => {
    const changed = vi.fn();
    watcher = new SetupWatcher(changed, () => path.join(home, '.claude'));
    watcher.watch('claude-code', setupIn(cwd));

    writeFileSync(path.join(home, '.claude', 'history.jsonl'), 'noise');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(changed).not.toHaveBeenCalled();

    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Changed');
    writeFileSync(path.join(home, '.claude', 'settings.json'), '{"x":1}');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('claude-code', cwd), {
      timeout: 3000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('tells when a new skill appears', async () => {
    const changed = vi.fn();
    watcher = new SetupWatcher(changed, () => path.join(home, '.claude'));
    watcher.watch('claude-code', setupIn(cwd));
    mkdirSync(path.join(home, '.claude', 'skills', 'deploy'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('watches the Claude folder in use at each read', async () => {
    const changed = vi.fn();
    const other = path.join(dir, 'work-claude');
    mkdirSync(path.join(other, 'skills'), { recursive: true });
    let claudeFolder = path.join(home, '.claude');
    watcher = new SetupWatcher(changed, () => claudeFolder);
    claudeFolder = other;
    watcher.watch('claude-code', setupIn(cwd));
    mkdirSync(path.join(home, '.claude', 'skills', 'deploy'));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(changed).not.toHaveBeenCalled();
    mkdirSync(path.join(other, 'skills', 'deploy'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('stops watching what it no longer reads', async () => {
    const changed = vi.fn();
    watcher = new SetupWatcher(changed, () => path.join(home, '.claude'));
    watcher.watch('claude-code', setupIn(cwd));
    watcher.dispose();
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Changed');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(changed).not.toHaveBeenCalled();
  });
});
