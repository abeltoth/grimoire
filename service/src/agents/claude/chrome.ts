import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { claudeExecutable } from './sign-in';
import { CHROME_KEY, claudeJsonPath } from './tool-sources';

/** The value last read whole, by file, kept for when Claude Code is halfway through rewriting it. */
const lastRead = new Map<string, boolean>();

/**
 * Whether Claude in Chrome is on by default, as Claude Code's /chrome sets
 * it; a process the SDK starts ignores the setting, so Grimoire reads it.
 */
export function chromeOn(claudeJson: string = claudeJsonPath()): boolean {
  if (!existsSync(claudeJson)) return false;
  try {
    const config: unknown = JSON.parse(readFileSync(claudeJson, 'utf8'));
    const on =
      typeof config === 'object' &&
      config !== null &&
      (config as Record<string, unknown>)[CHROME_KEY] === true;
    lastRead.set(claudeJson, on);
    return on;
  } catch {
    return lastRead.get(claudeJson) ?? false;
  }
}

/** The CLI argument that connects a process to Claude in Chrome, when it's on. */
export function chromeArgs(on: boolean = chromeOn()): Record<string, null> {
  return on ? { chrome: null } : {};
}

/** What a run of the CLI needs: its input written, its output and exit read. */
export type RunCli = (args: string[], input: string) => Promise<{ code: number; output: string }>;

const runCli: RunCli = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(claudeExecutable(), args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
    child.stdin.end(input);
  });

/**
 * Turns Claude in Chrome on or off by default, through the CLI's own
 * `edit-chrome-settings`, which writes .claude.json safely beside Claude
 * Code's other writes; undocumented, it's what the VS Code extension uses.
 */
export async function saveChromeOn(on: boolean, run: RunCli = runCli): Promise<void> {
  const { code, output } = await run(
    ['edit-chrome-settings', '--json'],
    JSON.stringify({ enabledByDefault: on }),
  );
  if (code !== 0) throw new Error(output.trim() || 'Claude Code didn’t save the setting');
}
