import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedAt, expand, fileAt, samePath, unchangedSince, writeUnchanged } from './files';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-files-'));
  dirs.push(dir);
  return dir;
};

describe('expand', () => {
  it('writes a folder from your home folder in full, and leaves any other as it is', () => {
    expect(expand('~')).toBe(path.join(homedir()));
    expect(expand('~/git/grimoire')).toBe(path.join(homedir(), 'git/grimoire'));
    expect(expand('~\\git')).toBe(path.join(homedir(), '\\git'));
    expect(expand('/work/~notes')).toBe('/work/~notes');
  });
});

describe('samePath', () => {
  it('compares paths absolute, and in one case on Windows', () => {
    expect(samePath('a/../b')).toBe(samePath(path.resolve('b')));
    const upper = samePath(path.resolve('Notes'));
    expect(upper === samePath(path.resolve('notes'))).toBe(process.platform === 'win32');
  });
});

describe('a file on disk', () => {
  it('reads as empty while it doesn’t exist, then as it is', () => {
    const file = path.join(tempDir(), 'CLAUDE.md');
    expect(fileAt(file, true)).toEqual({
      path: file,
      text: '',
      exists: false,
      changedAt: 0,
      editable: true,
    });
    writeFileSync(file, 'Rules');
    utimesSync(file, 1_000, 1_000);
    expect(fileAt(file, false)).toEqual({
      path: file,
      text: 'Rules',
      exists: true,
      changedAt: 1_000_000,
      editable: false,
    });
  });

  it('is written, with its folder, unless it changed since it was opened', () => {
    const file = path.join(tempDir(), 'new', 'CLAUDE.md');
    const written = writeUnchanged(file, 'First', 0);
    expect(written.text).toBe('First');
    expect(written.changedAt).toBe(changedAt(file));
    expect(() => unchangedSince(file, 0)).toThrow('It changed on disk since you opened it');
    expect(() => writeUnchanged(file, 'Second', 0)).toThrow('changed on disk');
    expect(fileAt(file, true).text).toBe('First');
  });
});
