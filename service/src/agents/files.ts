import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SetupFile } from '@grimoire/contract';

/** A folder written from your home folder, such as "~/git/grimoire", in full. */
export function expand(cwd: string): string {
  return cwd === '~' || cwd.startsWith('~/') || cwd.startsWith('~\\')
    ? path.join(homedir(), cwd.slice(1))
    : cwd;
}

/** A path to compare by: absolute, and in one case on Windows. */
export function samePath(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** When a file last changed, in ms since the epoch; 0 while it doesn't exist. */
export function changedAt(file: string): number {
  return existsSync(file) ? statSync(file).mtimeMs : 0;
}

/** A file as it is on disk now, to read or change in place; empty while it doesn't exist. */
export function fileAt(file: string, editable: boolean): SetupFile {
  const exists = existsSync(file);
  return {
    path: file,
    text: exists ? readFileSync(file, 'utf8') : '',
    exists,
    changedAt: changedAt(file),
    editable,
  };
}

/** Refuses when the file changed on disk since it was opened, so no one's change is lost. */
export function unchangedSince(file: string, opened: number): void {
  if (changedAt(file) !== opened) {
    throw new Error('It changed on disk since you opened it. Open it again to see the change.');
  }
}

/** Writes the file, unless it changed on disk since it was opened; makes its folder when there's none. */
export function writeUnchanged(file: string, text: string, opened: number): SetupFile {
  unchangedSince(file, opened);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return fileAt(file, true);
}
