import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import { WorktreeRecords } from '../storage/worktrees';
import { Worktrees, scriptsOf, slugOf } from './worktrees';

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
      await expect(worktrees.make(outside, 'Hello')).rejects.toThrow(/isn’t in a git repository/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("runs the repository's setup in the new worktree", async () => {
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: note('set-up.txt') } }));
    const cwd = await worktrees.make(repo, 'Hello');
    expect(readFileSync(path.join(repo, 'set-up.txt'), 'utf8')).toBe(`${cwd}|${cwd}`);
  });

  it('goes on when the setup fails, and says so in the log', async () => {
    writeFileSync(path.join(repo, '.grimoire.json'), JSON.stringify({ worktree: { setup: 'exit 3' } }));
    const cwd = await worktrees.make(repo, 'Hello');
    expect(existsSync(cwd)).toBe(true);
    expect(log.some((line) => line.startsWith('The worktree setup failed'))).toBe(true);
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
    expect(await worktrees.restore(path.join(cwd, 'ui'))).toBe(true);
    expect(git(cwd, 'branch', '--show-current').trim()).toBe('grimoire/hello');
    expect(existsSync(path.join(cwd, 'b.txt'))).toBe(true);
    // Already there: nothing to do.
    expect(await worktrees.restore(cwd)).toBe(true);
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

describe('slugOf', () => {
  it('names a worktree from the first words', () => {
    expect(slugOf('Add a context meter to the composer')).toBe('add-a-context-meter-to');
    expect(slugOf('Café: über-fix!')).toBe('cafe-uber-fix');
    expect(slugOf('Rename supercalifragilisticexpialidocious-and-more things')).toBe('rename');
    expect(slugOf('¿?')).toBe('chapter');
  });
});
