import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentMemories } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryWatcher, memoryTargets } from './memory-watcher';

let dir: string;
let folder: string;
let watcher: MemoryWatcher | undefined;

const keptIn = (memoryFolder: string): AgentMemories => ({
  cwd: 'C:/work',
  folder: memoryFolder,
  index: { path: path.join(memoryFolder, 'MEMORY.md'), exists: false },
  enabled: true,
  memories: [],
  problems: [],
  elsewhere: [],
  at: 1,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-memory-watcher-'));
  folder = path.join(dir, 'C--work', 'memory');
});

afterEach(() => {
  watcher?.dispose();
  watcher = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('memoryTargets', () => {
  it('watches the memory folder, or the folder it would be made in, or nothing', () => {
    expect(memoryTargets(keptIn(folder))).toEqual([]);
    mkdirSync(path.dirname(folder));
    expect(memoryTargets(keptIn(folder))).toEqual([
      { folder: path.dirname(folder), names: new Set(['memory']) },
    ]);
    mkdirSync(folder);
    expect(memoryTargets(keptIn(folder))).toEqual([{ folder, names: '*' }]);
  });
});

describe('MemoryWatcher', () => {
  it('tells once the folder settles when a memory appears or changes', async () => {
    mkdirSync(folder, { recursive: true });
    const changed = vi.fn();
    watcher = new MemoryWatcher(changed);
    watcher.watch('claude-code', keptIn(folder));

    writeFileSync(path.join(folder, 'tone.md'), 'Short answers.');
    writeFileSync(path.join(folder, 'MEMORY.md'), '- [Tone](tone.md)');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('claude-code', 'C:/work'), {
      timeout: 3000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('tells when the memory folder is made', async () => {
    mkdirSync(path.dirname(folder), { recursive: true });
    const changed = vi.fn();
    watcher = new MemoryWatcher(changed);
    watcher.watch('claude-code', keptIn(folder));
    mkdirSync(folder);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3000 });
  });
});
