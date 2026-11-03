import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, release } from 'node:os';
import path from 'node:path';
import type * as NodePty from 'node-pty';

// node-pty is native, so it stays in node_modules, where its binaries are,
// and is loaded only once a shell first starts.
const require = createRequire(import.meta.url);

/** A running shell, as the terminals see it. */
export interface Pty {
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface Shell {
  file: string;
  args: string[];
  /** Its name for the tab, such as "pwsh" or "zsh". */
  name: string;
}

export type SpawnPty = (shell: Shell, options: { cwd: string; cols: number; rows: number }) => Pty;

/** Your shell: PowerShell on Windows, the newer one when it's installed; your login shell elsewhere. */
export function defaultShell(platform: NodeJS.Platform = process.platform, env = process.env): Shell {
  if (platform === 'win32') {
    const dirs = (env['Path'] ?? env['PATH'] ?? '').split(path.win32.delimiter).filter(Boolean);
    const pwsh = dirs.map((dir) => path.win32.join(dir, 'pwsh.exe')).find((file) => existsSync(file));
    return pwsh
      ? { file: pwsh, args: ['-NoLogo'], name: 'pwsh' }
      : { file: 'powershell.exe', args: ['-NoLogo'], name: 'powershell' };
  }
  const file = env['SHELL'] || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  // A login shell reads your profile, as Terminal on a Mac does, so PATH is
  // set even when Grimoire was started from the Dock.
  return { file, args: ['-l'], name: path.posix.basename(file) };
}

/** The environment a shell starts with: the service's own, without what only Electron's Node needs. */
export function shellEnv(env = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) result[key] = value;
  // The service runs as Node on Electron's binary; anything Electron-based the
  // shell starts, such as VS Code's `code`, would run as Node too.
  delete result['ELECTRON_RUN_AS_NODE'];
  result['TERM'] = 'xterm-256color';
  result['COLORTERM'] = 'truecolor';
  result['TERM_PROGRAM'] = 'Grimoire';
  if (platform !== 'win32' && !result['LANG']) result['LANG'] = 'en_US.UTF-8';
  return result;
}

/** The Windows build number, such as 26200; undefined elsewhere. */
export function windowsBuild(platform: NodeJS.Platform = process.platform): number | undefined {
  if (platform !== 'win32') return undefined;
  const build = Number(release().split('.')[2]);
  return Number.isFinite(build) ? build : undefined;
}

/** Starts a shell in a pseudo-terminal, with node-pty. */
export const spawnPty: SpawnPty = (shell, { cwd, cols, rows }) => {
  makeSpawnHelperRunnable();
  const { spawn } = require('node-pty') as typeof NodePty;
  const pty = spawn(shell.file, shell.args, {
    name: 'xterm-256color',
    cwd: existsSync(cwd) ? cwd : homedir(),
    cols,
    rows,
    env: shellEnv(),
  });
  return {
    onData: (listener) => void pty.onData(listener),
    onExit: (listener) => void pty.onExit(({ exitCode }) => listener(exitCode)),
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
  };
};

let helperChecked = false;

/**
 * node-pty starts shells on a Mac and Linux through its spawn-helper, which
 * its prebuilt package ships without the execute bit; without it every
 * shell fails to start with "posix_spawnp failed".
 */
function makeSpawnHelperRunnable(): void {
  if (helperChecked || process.platform === 'win32') return;
  helperChecked = true;
  try {
    const root = path.dirname(require.resolve('node-pty/package.json'));
    for (const dir of ['build/Release', `prebuilds/${process.platform}-${process.arch}`]) {
      const helper = path.join(root, dir, 'spawn-helper');
      if (!existsSync(helper)) continue;
      const { mode } = statSync(helper);
      if ((mode & 0o111) !== 0o111) chmodSync(helper, mode | 0o755);
    }
  } catch {
    // Leave it; spawning says what went wrong.
  }
}
