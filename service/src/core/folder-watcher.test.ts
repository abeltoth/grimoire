import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderWatcher } from './folder-watcher';

const dirs: string[] = [];
const watchers: FolderWatcher<{ cwd: string }>[] = [];
afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-watch-'));
  dirs.push(dir);
  return dir;
};

describe('FolderWatcher', () => {
  it('tells once the files settle after one that matters changed, and not for one that doesn’t', async () => {
    const cwd = tempDir();
    const changed = vi.fn();
    const watcher = new FolderWatcher<{ cwd: string }>(
      (told) => [{ folder: told.cwd, names: new Set(['settings.json']) }],
      changed,
    );
    watchers.push(watcher);
    watcher.watch('claude-code', { cwd });

    writeFileSync(path.join(cwd, 'notes.txt'), 'x');
    writeFileSync(path.join(cwd, 'settings.json'), '{}');
    writeFileSync(path.join(cwd, 'settings.json'), '{"a": 1}');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('claude-code', cwd), {
      timeout: 5_000,
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('leaves a folder it can’t watch unwatched', () => {
    const watcher = new FolderWatcher<{ cwd: string }>(
      (told) => [{ folder: path.join(told.cwd, 'missing'), names: '*' }],
      vi.fn(),
    );
    watchers.push(watcher);
    expect(() => watcher.watch('claude-code', { cwd: tempDir() })).not.toThrow();
  });
});
