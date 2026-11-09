import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EventName, EventPayload } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleContext } from '@grimoire/service/module';
import { CommandRegistry } from '@grimoire/service/registry';
import { git as gitModule } from '../../git/service';
import { Files } from './files';
import { reposThrough } from '.';

let repo: string;
let files: Files;
let told: EventPayload<EventName>[];
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
const write = (file: string, text: string | Buffer) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};
const until = async (done: () => boolean, ms = 3000) => {
  for (const start = Date.now(); !done() && Date.now() - start < ms;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-files-')));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  write('.gitignore', 'node_modules/\ndist\n');
  write('README.md', '# Hello\n');
  write('src/meter.ts', 'export const used = 1;\n');
  write('src/context-meter.css', '.meter {}\n');
  write('src/ui/ribbon.ts', 'export {};\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'First');
  write('node_modules/x/index.js', '');
  write('dist/out.js', '');
  told = [];
  const registry = new CommandRegistry();
  gitModule.start({ registry } as ModuleContext);
  files = new Files(reposThrough(registry), (_event, payload) => told.push(payload));
});

afterEach(() => {
  files.dispose();
  rmSync(repo, { recursive: true, force: true });
});

describe('Files', () => {
  it('lists a folder of the repository, folders first, with what git ignores marked', async () => {
    const top = await files.list(path.join(repo, 'src'), '');
    expect(top.root.toLowerCase()).toBe(repo.toLowerCase());
    expect(top.entries).toEqual([
      { name: 'dist', path: 'dist', kind: 'folder', ignored: true },
      { name: 'node_modules', path: 'node_modules', kind: 'folder', ignored: true },
      { name: 'src', path: 'src', kind: 'folder' },
      { name: '.gitignore', path: '.gitignore', kind: 'file' },
      { name: 'README.md', path: 'README.md', kind: 'file' },
    ]);
    expect((await files.list(repo, 'src')).entries.map((entry) => entry.path)).toEqual([
      'src/ui',
      'src/context-meter.css',
      'src/meter.ts',
    ]);
    await expect(files.list(repo, '..')).rejects.toThrow('outside the folder');
  });

  it('takes a repository as a plain folder without the git module', async () => {
    const plain = new Files(reposThrough(new CommandRegistry()), () => {});
    const top = await plain.list(repo, '');
    expect(top.root).toBe(path.resolve(repo));
    expect(top.entries.find((entry) => entry.name === 'dist')).toEqual({
      name: 'dist',
      path: 'dist',
      kind: 'folder',
    });
    plain.dispose();
  });

  it('finds files by the words in their paths, those named for them first, leaving out what git ignores', async () => {
    write('src/new-meter.ts', '');
    expect(await files.find(repo, 'meter')).toEqual([
      'src/meter.ts',
      'src/new-meter.ts',
      'src/context-meter.css',
    ]);
    expect(await files.find(repo, 'src ribbon')).toEqual(['src/ui/ribbon.ts']);
    expect(await files.find(repo, 'index')).toEqual([]);
    expect(await files.find(repo, '  ')).toEqual([]);
  });

  it('finds files in a folder that isn’t a repository, leaving out node_modules', async () => {
    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-plain-')));
    try {
      mkdirSync(path.join(plain, 'node_modules'));
      writeFileSync(path.join(plain, 'node_modules', 'meter.js'), '');
      writeFileSync(path.join(plain, 'meter.txt'), 'm');
      expect(await files.find(plain, 'meter')).toEqual(['meter.txt']);
      expect((await files.list(plain, '')).entries).toEqual([
        { name: 'node_modules', path: 'node_modules', kind: 'folder' },
        { name: 'meter.txt', path: 'meter.txt', kind: 'file' },
      ]);
      expect(await files.open(plain, 'meter.txt')).toMatchObject({ text: 'm' });
      expect((await files.open(plain, 'meter.txt')).committed).toBeUndefined();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('opens a file with its text as last committed, when it has changed', async () => {
    expect(await files.open(repo, 'README.md')).toEqual({
      path: 'README.md',
      text: '# Hello\n',
      changedAt: statSync(path.join(repo, 'README.md')).mtimeMs,
    });
    write('src/meter.ts', 'export const used = 2;\n');
    expect(await files.open(repo, 'src/meter.ts')).toMatchObject({
      text: 'export const used = 2;\n',
      committed: 'export const used = 1;\n',
    });
    write('src/new.ts', 'new\n');
    expect((await files.open(repo, 'src/new.ts')).committed).toBeNull();
  });

  it('doesn’t show a binary file, or one too large to edit', async () => {
    write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
    write('big.log', 'x'.repeat(2 * 1024 * 1024 + 1));
    expect(await files.open(repo, 'logo.png')).toMatchObject({ text: '', unshown: 'binary' });
    expect(await files.open(repo, 'big.log')).toMatchObject({ text: '', unshown: 'large' });
    await expect(files.open(repo, 'src')).rejects.toThrow('isn’t a file');
    await expect(files.open(repo, '../elsewhere.txt')).rejects.toThrow('outside the folder');
  });

  it('opens, saves and watches a file outside the folder when it’s written in full', async () => {
    const elsewhere = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-elsewhere-')));
    try {
      const notes = path.join(elsewhere, 'notes.md');
      writeFileSync(notes, '# Notes\n');
      const shown = notes.replaceAll('\\', '/');
      const opened = await files.open(repo, notes);
      expect(opened).toEqual({
        path: shown,
        text: '# Notes\n',
        changedAt: statSync(notes).mtimeMs,
      });
      // Inside the folder, written in full, it's named from the folder.
      expect((await files.open(repo, path.join(repo, 'README.md'))).path).toBe('README.md');

      await files.save(repo, shown, '# Mine\n', opened.changedAt);
      await new Promise((resolve) => setTimeout(resolve, 30));
      writeFileSync(notes, '# The agent’s\n');
      await until(() => told.length > 0);
      expect(told[0]).toMatchObject({ path: shown });
      await files.close(repo, shown);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('saves a file, unless it changed on disk since it was opened', async () => {
    const opened = await files.open(repo, 'src/meter.ts');
    const saved = await files.save(
      repo,
      'src/meter.ts',
      'export const used = 3;\n',
      opened.changedAt,
    );
    expect(saved).toMatchObject({
      text: 'export const used = 3;\n',
      committed: 'export const used = 1;\n',
    });
    await expect(files.save(repo, 'src/meter.ts', 'stale', opened.changedAt)).rejects.toThrow(
      'changed on disk',
    );
  });

  it('tells when an open file changes on disk, but not when it’s saved here, until it’s closed', async () => {
    const opened = await files.open(repo, 'src/meter.ts');
    await files.save(repo, 'src/meter.ts', 'mine\n', opened.changedAt);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(told).toEqual([]);

    // Changed with a later time, as an agent's edit is.
    await new Promise((resolve) => setTimeout(resolve, 30));
    write('src/meter.ts', 'the agent’s\n');
    await until(() => told.length > 0);
    expect(told[0]).toEqual({ root: expect.any(String), path: 'src/meter.ts' });
    expect((told[0] as { root: string }).root.toLowerCase()).toBe(repo.toLowerCase());

    await files.close(repo, 'src/meter.ts');
    told = [];
    write('src/meter.ts', 'again\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(told).toEqual([]);
  });
});
