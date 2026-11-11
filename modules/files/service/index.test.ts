import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceEvents } from '@grimoire/service/core/events';
import { type ModuleContext, Modules } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { openDatabase } from '@grimoire/service/testing/database';
import { files, reposThrough } from '.';

describe('reposThrough', () => {
  it('asks the git module, and takes every folder as outside a repository without it', async () => {
    expect(await reposThrough(new CommandRegistry()).root('/work')).toBeNull();

    const registry = new CommandRegistry();
    registry.register('git.root', async ({ cwd }) => `${cwd}/..`);
    registry.register('git.files', async () => ['a.ts']);
    registry.register('git.ignored', async ({ paths }) => paths.slice(1));
    registry.register('git.committed', async ({ path: file }) => `committed ${file}`);
    const repos = reposThrough(registry);
    expect(await repos.root('/work')).toBe('/work/..');
    expect(await repos.files('/work')).toEqual(['a.ts']);
    expect(await repos.ignored('/work', ['a.ts', 'dist'])).toEqual(new Set(['dist']));
    expect(await repos.committed('/work', 'a.ts')).toBe('committed a.ts');
  });

  it('passes on any other failure of the git module', async () => {
    const registry = new CommandRegistry();
    registry.register('git.root', async () => {
      throw new Error('git is broken');
    });
    await expect(reposThrough(registry).root('/work')).rejects.toThrow('git is broken');
  });
});

describe('the files module', () => {
  it('answers its commands, and stops watching when the service stops', async () => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'grimoire-files-module-')));
    try {
      writeFileSync(path.join(dir, 'notes.md'), 'Hello');
      const registry = new CommandRegistry();
      const modules = new Modules([files]);
      modules.start({
        registry,
        db: openDatabase(':memory:'),
        events: new ServiceEvents(),
      } as unknown as ModuleContext);
      const listed = await registry.call('files.list', { cwd: dir, path: '' });
      expect(listed.entries.map((entry) => entry.name)).toEqual(['notes.md']);
      const opened = await registry.call('files.open', { cwd: dir, path: 'notes.md' });
      expect(opened).toMatchObject({ text: 'Hello' });
      await registry.call('files.close', { cwd: dir, path: 'notes.md' });
      modules.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
