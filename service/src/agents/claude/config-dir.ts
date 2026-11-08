import { homedir } from 'node:os';
import path from 'node:path';

const VARIABLE = 'CLAUDE_CONFIG_DIR';

/** The Claude folder the service started with; undefined when Claude Code was left to its usual place. */
const startedWith = process.env[VARIABLE];

/**
 * The folder Claude Code keeps your settings, skills, sign-in and chats
 * in: CLAUDE_CONFIG_DIR when it's set, else ~/.claude. Read each time, as
 * switching profiles moves it.
 */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env[VARIABLE] || path.join(homedir(), '.claude');
}

/**
 * Points Claude Code at a Claude folder, or back at whatever the service
 * started with for null. It's set on the service's own environment: the
 * SDK reads saved chats in process, through it, and every Claude Code
 * process started afterwards inherits it. Left unset rather than set to
 * ~/.claude, as setting it moves Claude Code's .claude.json and the name
 * of its sign-in in the Mac keychain.
 */
export function useClaudeFolder(dir: string | null, env: NodeJS.ProcessEnv = process.env): void {
  const value = dir ?? startedWith;
  if (value === undefined) delete env[VARIABLE];
  else env[VARIABLE] = value;
}
