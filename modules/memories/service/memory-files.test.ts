import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentMemories, Memory } from '@grimoire/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryFiles, withoutEntry } from './memory-files';

let dir: string;
let files: MemoryFiles;
let kept: AgentMemories | null;
const at = (...parts: string[]) => path.join(dir, ...parts);

const memory = (name: string): Memory => ({
  name,
  path: at(`${name}.md`),
  type: 'feedback',
  changedAt: 1,
  links: [],
  indexed: true,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grimoire-memory-files-'));
  writeFileSync(at('tone.md'), '---\nname: tone\n---\nShort answers.');
  writeFileSync(at('commits.md'), '---\nname: commits\n---\nStraight to master.');
  writeFileSync(at('elsewhere.md'), 'Not one of them.');
  writeFileSync(
    at('MEMORY.md'),
    '- [Tone](tone.md) — short answers\r\n- [Commits](commits.md) — to master\r\n',
  );
  kept = {
    cwd: dir,
    folder: dir,
    index: { path: at('MEMORY.md'), exists: true },
    enabled: true,
    memories: [memory('tone'), memory('commits')],
    problems: [],
    elsewhere: [],
    at: 1,
  };
  files = new MemoryFiles(async () => kept);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('MemoryFiles', () => {
  it('opens a memory the agent keeps, to change', async () => {
    const file = await files.open('claude-code', dir, at('tone.md'));
    expect(file).toMatchObject({
      text: '---\nname: tone\n---\nShort answers.',
      exists: true,
      editable: true,
    });
    expect(file.changedAt).toBeGreaterThan(0);
  });

  it('opens nothing else: not the index, nor another file, nor any file when it keeps none', async () => {
    await expect(files.open('claude-code', dir, at('MEMORY.md'))).rejects.toThrow(
      'Only the memories the agent keeps can be opened here.',
    );
    await expect(files.open('claude-code', dir, at('elsewhere.md'))).rejects.toThrow();
    kept = null;
    await expect(files.open('claude-code', dir, at('tone.md'))).rejects.toThrow();
  });

  it('saves a memory, unless it changed on disk since it was opened', async () => {
    const opened = await files.open('claude-code', dir, at('tone.md'));
    const saved = await files.save('claude-code', dir, at('tone.md'), 'Shorter.', opened.changedAt);
    expect(readFileSync(at('tone.md'), 'utf8')).toBe('Shorter.');
    expect(saved.text).toBe('Shorter.');

    utimesSync(at('tone.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    await expect(
      files.save('claude-code', dir, at('tone.md'), 'Again.', saved.changedAt),
    ).rejects.toThrow('It changed on disk since you opened it.');
    expect(readFileSync(at('tone.md'), 'utf8')).toBe('Shorter.');
  });

  it('deletes a memory and its line in the index', async () => {
    const opened = await files.open('claude-code', dir, at('tone.md'));
    await files.delete('claude-code', dir, at('tone.md'), opened.changedAt);
    expect(existsSync(at('tone.md'))).toBe(false);
    expect(readFileSync(at('MEMORY.md'), 'utf8')).toBe('- [Commits](commits.md) — to master\r\n');
  });

  it('deletes nothing that changed on disk since it was opened', async () => {
    const opened = await files.open('claude-code', dir, at('tone.md'));
    utimesSync(at('tone.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    await expect(files.delete('claude-code', dir, at('tone.md'), opened.changedAt)).rejects.toThrow(
      'It changed on disk since you opened it.',
    );
    expect(existsSync(at('tone.md'))).toBe(true);
    expect(readFileSync(at('MEMORY.md'), 'utf8')).toContain('tone.md');
  });
});

describe('withoutEntry', () => {
  it('leaves out the lines naming the file, and keeps the rest as written', () => {
    const index =
      '# Memory\n\n- [Tone](tone.md) — short\n* [Commits](./Commits.md)\nA note on tone.md\n';
    expect(withoutEntry(index, 'tone.md')).toBe(
      '# Memory\n\n* [Commits](./Commits.md)\nA note on tone.md\n',
    );
    expect(withoutEntry(index, 'commits.md')).toBe(
      '# Memory\n\n- [Tone](tone.md) — short\nA note on tone.md\n',
    );
    expect(withoutEntry(index, 'gone.md')).toBeNull();
  });
});
