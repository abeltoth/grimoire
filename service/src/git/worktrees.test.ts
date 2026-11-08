import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HookRun } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import { WorktreeRecords } from '../storage/worktrees';
import { Worktrees, scriptRun, scriptsOf, slugOf } from './worktrees';

let repo: string;
let worktrees: Worktrees;
let records: WorktreeRecords;
let log: string[];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const branches = () => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
/** A script that writes the folder it ran in and the repository to a file in the repository. */
const note = (file: string) =>
  `node -e "require('fs').writeFileSync(require('path').join(process.env.GRIMOIRE_REPO, '${file}'), process.cwd() + '|' + process.env.GRIMOIRE_WORKTREE)"`;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-trees-')));
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  mkdirSync(path.join(repo, 'ui'));
  writeFileSync(path.join(repo, 'ui', 'a.txt'), 'a\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'First');
  records = new WorktreeRecords(openDatabase(':memory:'));
  log = [];
  worktrees = new Worktrees(records, (message) => log.push(message));
});

afterEach(() => {
  git(repo, 'worktree', 'prune');
  rmSync(repo, { recursive: true, force: true });
});

const tree = (name: string) => path.join(repo, '.claude', 'worktrees', name);

describe('Worktrees', () => {
  it('makes a worktree on a branch of its own, ignored by git', async () => {
    const cwd = await worktrees.make(repo, 'Add a context meter, please');
    expect(cwd).toBe(tree('add-a-context-meter-please'));
    expect(existsSync(path.join(cwd, 'ui', 'a.txt'))).toBe(true);
    expect(git(cwd, 'branch', '--show-current').trim()).toBe('grimoire/add-a-context-meter-please');
    expect(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.claude/worktrees/\n');
    // The repository's own checkout doesn't see it.
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(records.all()).toEqual([
      { path: cwd, repo, branch: 'grimoire/add-a-context-meter-please' },
    ]);
  });

  it('gives a chat begun in a folder inside the repository the same folder in its worktree', async () => {
    expect(await worktrees.make(path.join(repo, 'ui'), 'Hello')).toBe(path.join(tree('hello'), 'ui'));
  });

  it('numbers a name already taken', async () => {
    await worktrees.make(repo, 'Hello');
    expect(await worktrees.make(repo, 'Hello')).toBe(tree('hello-2'));
    expect(branches()).toEqual(['grimoire/hello', 'grimoire/hello-2', 'main']);
    // Ignored once.
    expect(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').match(/worktrees/g)).toHaveLength(1);
  });

  it('makes a worktree of a worktree in the main repository', async () => {
    const first = await worktrees.make(repo, 'First');
    expect(await worktrees.make(first, 'Second')).toBe(tree('second'));
  });

  it("won't make one outside a repository", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'grimoire-nogit-'));
    try {
      expect(await worktrees.inRepository(path.join(repo, 'ui'))).toBe(true);
      expect(await worktrees.inRepository(outside)).toBe(false);
      await expect(worktrees.make(outside, 'Hello')).rejects.toThrow(/isn’t in a git repository/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("runs the repository's setup in the worktree when asked, telling what it prints as it prints it", async () => {
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: note('set-up.txt') } }));
    const cwd = await worktrees.make(repo, 'Hello');
    // Making it leaves the setup to the chat.
    expect(existsSync(path.join(repo, 'set-up.txt'))).toBe(false);
    const runs: HookRun[] = [];
    const run = await (await worktrees.setUp(path.join(cwd, 'ui'), (seen) => runs.push(seen)))!.ended;
    expect(readFileSync(path.join(repo, 'set-up.txt'), 'utf8')).toBe(`${cwd}|${cwd}`);
    expect(run).toMatchObject({ name: note('set-up.txt'), event: 'WorktreeSetup', outcome: 'passed' });
    expect(run.took).toBeGreaterThanOrEqual(0);
    expect(runs.at(0)).toMatchObject({ outcome: 'running' });
    expect(runs.at(-1)).toEqual(run);

    writeFileSync(
      path.join(repo, '.grimoire.json'),
      JSON.stringify({ worktree: { setup: `node -e "console.log('one'); setTimeout(() => console.log('two'), 1500)"` } }),
    );
    runs.length = 0;
    const printed = await (await worktrees.setUp(cwd, (seen) => runs.push(seen)))!.ended;
    expect(printed.output?.trim().split(/\r?\n/)).toEqual(['one', 'two']);
    // "one" was told before the setup ended.
    expect(runs.some((seen) => seen.outcome === 'running' && seen.output?.trim() === 'one')).toBe(true);
  });

  it('runs it in your shell, without what only Electron’s Node needs', async () => {
    const shown = process.env['ELECTRON_RUN_AS_NODE'];
    process.env['ELECTRON_RUN_AS_NODE'] = '1';
    try {
      writeFileSync(
        path.join(repo, '.grimoire.json'),
        JSON.stringify({ worktree: { setup: `node -e "console.log(String(process.env.ELECTRON_RUN_AS_NODE))"` } }),
      );
      const cwd = await worktrees.make(repo, 'Hello');
      expect((await (await worktrees.setUp(cwd))!.ended).output?.trim()).toBe('undefined');
    } finally {
      if (shown === undefined) delete process.env['ELECTRON_RUN_AS_NODE'];
      else process.env['ELECTRON_RUN_AS_NODE'] = shown;
    }
  });

  it('has no setup to run without a script, or outside a worktree it made', async () => {
    const cwd = await worktrees.make(repo, 'Hello');
    expect(await worktrees.setUp(cwd)).toBeUndefined();
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: 'exit 0' } }));
    expect(await worktrees.setUp(repo)).toBeUndefined();
  });

  it('tells a setup that failed, with what it printed, and says so in the log', async () => {
    writeFileSync(
      path.join(repo, '.grimoire.json'),
      JSON.stringify({ worktree: { setup: `node -e "console.error('no lockfile'); process.exit(3)"` } }),
    );
    const cwd = await worktrees.make(repo, 'Hello');
    const run = await (await worktrees.setUp(cwd))!.ended;
    expect(run.outcome).toBe('failed');
    expect(run.output?.split(/\r?\n/).map((line) => line.trim())).toEqual(['no lockfile', 'It exited with code 3']);
    expect(existsSync(cwd)).toBe(true);
    expect(log.some((line) => line.startsWith('The worktree setup failed'))).toBe(true);
  });

  it('copies the ignored files .worktreeinclude names into a new worktree, but not links or what git tracks', async () => {
    writeFileSync(path.join(repo, '.gitignore'), '.env*\nsecrets/\n');
    writeFileSync(path.join(repo, '.worktreeinclude'), '# What a fresh checkout lacks\n.env*\nsecrets/\nnotes.txt\nui/a.txt\n');
    git(repo, 'add', '.gitignore', '.worktreeinclude');
    git(repo, 'commit', '--quiet', '-m', 'Ignore');
    writeFileSync(path.join(repo, '.env'), 'TOKEN=1\n');
    mkdirSync(path.join(repo, 'secrets', 'deep'), { recursive: true });
    writeFileSync(path.join(repo, 'secrets', 'deep', 'key.txt'), 'key\n');
    // Untracked, but not ignored.
    writeFileSync(path.join(repo, 'notes.txt'), 'notes\n');
    symlinkSync(path.join(repo, '.env'), path.join(repo, '.env.link'), 'file');
    const cwd = await worktrees.make(repo, 'Hello');
    expect(readFileSync(path.join(cwd, '.env'), 'utf8')).toBe('TOKEN=1\n');
    expect(readFileSync(path.join(cwd, 'secrets', 'deep', 'key.txt'), 'utf8')).toBe('key\n');
    expect(existsSync(path.join(cwd, 'notes.txt'))).toBe(false);
    expect(existsSync(path.join(cwd, '.env.link'))).toBe(false);
    expect(git(cwd, 'status', '--porcelain')).toBe('');
  });

  it('copies nothing through a link the branch committed that leads out of the worktree', async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-outside-')));
    try {
      git(repo, 'config', 'core.symlinks', 'true');
      writeFileSync(path.join(repo, '.gitignore'), '.env\n');
      writeFileSync(path.join(repo, '.worktreeinclude'), '.env\n');
      symlinkSync(outside, path.join(repo, 'config'), 'dir');
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'Link');
      // The main checkout has a folder there now, with a file the branch's link would lead out.
      rmSync(path.join(repo, 'config'), { recursive: true, force: true });
      mkdirSync(path.join(repo, 'config'));
      writeFileSync(path.join(repo, 'config', '.env'), 'TOKEN=1\n');
      writeFileSync(path.join(repo, '.env'), 'TOKEN=2\n');
      const cwd = await worktrees.make(repo, 'Hello');
      expect(lstatSync(path.join(cwd, 'config')).isSymbolicLink()).toBe(true);
      expect(readFileSync(path.join(cwd, '.env'), 'utf8')).toBe('TOKEN=2\n');
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('removes a clean worktree after its cleanup, and keeps its branch', async () => {
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { cleanup: note('cleaned.txt') } }));
    const cwd = await worktrees.make(repo, 'Hello');
    expect(await worktrees.release(cwd)).toBe('removed');
    expect(existsSync(cwd)).toBe(false);
    expect(readFileSync(path.join(repo, 'cleaned.txt'), 'utf8')).toBe(`${cwd}|${cwd}`);
    expect(branches()).toContain('grimoire/hello');
  });

  it('keeps a worktree with uncommitted changes', async () => {
    const cwd = await worktrees.make(repo, 'Hello');
    writeFileSync(path.join(cwd, 'new.txt'), 'new\n');
    expect(await worktrees.release(cwd)).toBe('kept');
    expect(existsSync(path.join(cwd, 'new.txt'))).toBe(true);
  });

  it('leaves alone folders it made no worktree for', async () => {
    expect(await worktrees.release(repo)).toBe('none');
    expect(await worktrees.restore(repo)).toBe(false);
  });

  it('puts a removed worktree back on its branch, with its commits', async () => {
    const cwd = await worktrees.make(repo, 'Hello');
    writeFileSync(path.join(cwd, 'b.txt'), 'b\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '-m', 'Second');
    await worktrees.release(cwd);
    expect(await worktrees.restore(path.join(cwd, 'ui'))).toBe('put back');
    expect(git(cwd, 'branch', '--show-current').trim()).toBe('grimoire/hello');
    expect(existsSync(path.join(cwd, 'b.txt'))).toBe(true);
    // Already there: nothing to do.
    expect(await worktrees.restore(cwd)).toBe('there');
  });

  it('puts back a worktree whose removal left its folder empty, as when the agent still held it', async () => {
    const cwd = await worktrees.make(repo, 'Hello');
    git(repo, 'worktree', 'remove', cwd);
    mkdirSync(cwd);
    expect(await worktrees.release(cwd)).toBe('none');
    expect(await worktrees.restore(cwd)).toBe('put back');
    expect(git(cwd, 'branch', '--show-current').trim()).toBe('grimoire/hello');
  });

  it('puts a worktree back with the files .worktreeinclude names, leaving its setup to the chat', async () => {
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: note('set-up.txt') } }));
    writeFileSync(path.join(repo, '.gitignore'), '.env\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '--quiet', '-m', 'Ignore');
    writeFileSync(path.join(repo, '.worktreeinclude'), '.env\n');
    writeFileSync(path.join(repo, '.env'), 'TOKEN=1\n');
    const cwd = await worktrees.make(repo, 'Hello');
    // What was copied in is ignored, so the worktree goes.
    expect(await worktrees.release(cwd)).toBe('removed');
    expect(await worktrees.restore(cwd)).toBe('put back');
    expect(readFileSync(path.join(cwd, '.env'), 'utf8')).toBe('TOKEN=1\n');
    expect(existsSync(path.join(repo, 'set-up.txt'))).toBe(false);
  });

  it('removes a worktree only once its setup ended', async () => {
    writeFileSync(
      path.join(repo, '.grimoire.json'),
      JSON.stringify({
        worktree: { setup: `node -e "setTimeout(() => require('fs').writeFileSync('../../../set-up.txt', 'done'), 1000)"` },
      }),
    );
    const cwd = await worktrees.make(repo, 'Hello');
    await worktrees.setUp(cwd);
    expect(await worktrees.release(cwd)).toBe('removed');
    expect(readFileSync(path.join(repo, 'set-up.txt'), 'utf8')).toBe('done');
  });
});

describe('scriptsOf', () => {
  it('reads the setup and cleanup, and nothing from a file that is missing or wrong', async () => {
    expect(await scriptsOf(repo)).toEqual({});
    writeFileSync(path.join(repo, '.grimoire.json'), '{ not json');
    expect(await scriptsOf(repo)).toEqual({});
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: 'npm ci', cleanup: ' ' } }));
    expect(await scriptsOf(repo)).toEqual({ setup: 'npm ci' });
  });
});

describe('scriptRun', () => {
  it('runs a script in your login shell on a Mac, and from what PowerShell reads on Windows', () => {
    expect(scriptRun({ file: '/bin/zsh', args: ['-l'], name: 'zsh' }, 'npm ci', 'darwin')).toEqual({
      args: ['-l', '-i', '-c', 'npm ci'],
    });
    const windows = scriptRun({ file: 'powershell.exe', args: ['-NoLogo'], name: 'powershell' }, 'npm ci — é', 'win32');
    expect(windows.args).toEqual(['-NoLogo', '-NonInteractive', '-Command', '-']);
    const encoded = /FromBase64String\('([^']+)'\)/.exec(windows.input!)![1]!;
    expect(Buffer.from(encoded, 'base64').toString('utf8').split('\n')[0]).toBe('npm ci — é');
    // What PowerShell reads is plain ASCII, whatever its code page.
    expect(/^[\x20-\x7e\n]*$/.test(windows.input!)).toBe(true);
  });
});

describe('slugOf', () => {
  it('names a worktree from the first words', () => {
    expect(slugOf('Add a context meter to the composer')).toBe('add-a-context-meter-to');
    expect(slugOf('Café: über-fix!')).toBe('cafe-uber-fix');
    expect(slugOf('Rename supercalifragilisticexpialidocious-and-more things')).toBe('rename');
    expect(slugOf('¿?')).toBe('chapter');
  });
});
