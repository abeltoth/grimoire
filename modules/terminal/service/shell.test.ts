import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultShell, shellEnv, spawnPty, windowsBuild, type Shell } from './shell';

describe('defaultShell', () => {
  it('uses PowerShell on Windows', () => {
    expect(defaultShell('win32', { PATH: '' })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'powershell',
    });
  });

  it('uses your login shell elsewhere', () => {
    expect(defaultShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: ['-l'],
      name: 'fish',
    });
    expect(defaultShell('darwin', {}).file).toBe('/bin/zsh');
    expect(defaultShell('linux', {}).file).toBe('/bin/bash');
  });
});

describe('shellEnv', () => {
  it("drops Electron's Node switch and says what the terminal can draw", () => {
    const env = shellEnv({ ELECTRON_RUN_AS_NODE: '1', HOME: '/me' }, 'darwin');
    expect(env).toEqual({
      HOME: '/me',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Grimoire',
      LANG: 'en_US.UTF-8',
    });
    expect(shellEnv({ LANG: 'de_DE.UTF-8' }, 'darwin')['LANG']).toBe('de_DE.UTF-8');
    expect(shellEnv({}, 'win32')['LANG']).toBeUndefined();
  });
});

describe('windowsBuild', () => {
  it('is known only on Windows', () => {
    expect(windowsBuild('linux')).toBeUndefined();
    expect(windowsBuild('darwin')).toBeUndefined();
  });
});

describe('spawnPty', () => {
  let folder: string | undefined;
  afterEach(() => folder && rmSync(folder, { recursive: true, force: true }));

  it('runs a shell in a pseudo-terminal, in the folder given', async () => {
    folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-terminal-')));
    // Node stands in for the shell, the same on every system.
    const node: Shell = {
      file: process.execPath,
      args: ['-e', 'process.stdout.write("cwd=" + process.cwd() + " tty=" + process.stdout.isTTY)'],
      name: 'node',
    };
    const pty = spawnPty(node, { cwd: folder, cols: 200, rows: 10 });
    let written = '';
    pty.onData((data) => (written += data));
    const code = await new Promise<number>((resolve) => pty.onExit(resolve));

    const text = written.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|[\r\n]/g, '');
    expect(code).toBe(0);
    expect(text.toLowerCase()).toContain(`cwd=${folder} tty=true`.toLowerCase());
  }, 20_000);
});
