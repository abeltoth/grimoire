import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Whose a settings file is: yours, the project's, your own for the project, the machine's, or a plugin's. */
export type SettingsSource = 'user' | 'project' | 'local' | 'managed' | 'plugin';

/** A settings file as read: what it holds, or why it couldn't be read. */
export interface ReadSettings {
  source: SettingsSource;
  path: string;
  exists: boolean;
  /** Why it couldn't be read, such as JSON that doesn't parse. */
  problem?: string;
  settings?: unknown;
  /** The plugin whose hooks file it is. */
  plugin?: string;
}

/** Where Claude Code's own settings for every user of the machine are kept. */
export function managedSettingsPath(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

/**
 * The settings files Claude Code reads in a folder, yours first, from your
 * Claude folder. In your home folder the project's settings file is your
 * own, so it's listed once.
 */
export function settingsFilesIn(
  cwd: string,
  claudeFolder: string,
  platform: NodeJS.Platform,
): { source: SettingsSource; path: string }[] {
  const files: { source: SettingsSource; path: string }[] = [
    { source: 'user', path: path.join(claudeFolder, 'settings.json') },
    { source: 'project', path: path.join(cwd, '.claude', 'settings.json') },
    { source: 'local', path: path.join(cwd, '.claude', 'settings.local.json') },
    { source: 'managed', path: managedSettingsPath(platform) },
  ];
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = path.resolve(file.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Reads a settings file; a missing one holds nothing. */
export function readSettingsFile(
  file: { source: SettingsSource; path: string },
  plugin?: string,
): ReadSettings {
  const read: ReadSettings = {
    ...file,
    exists: existsSync(file.path),
    ...(plugin ? { plugin } : {}),
  };
  if (!read.exists) return read;
  try {
    return { ...read, settings: JSON.parse(readFileSync(file.path, 'utf8')) as unknown };
  } catch (error) {
    return {
      ...read,
      problem: `Couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
