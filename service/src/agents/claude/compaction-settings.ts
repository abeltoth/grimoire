import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CompactionChange, CompactionWindow } from '@grimoire/contract';
import { claudeHome } from './config-dir';
import { canonicalModel } from './effort';
import { managedSettingsPath, settingsFilesIn } from './settings-files';
import { MessageQueue } from './message-queue';
import { claudeEnv, sdk } from './probe';

/** The smallest window Claude Code takes for a model. */
export const MIN_WINDOW = 100_000;

/** What Claude Code's measure tells of a model's compaction, whatever your settings say. */
export interface ModelCompaction {
  /** The model's own window: the most its compaction window can be. */
  max: number;
  /** How far before the window's end it compacts. */
  reserve: number;
}

type Settings = Record<string, unknown> & {
  modelSettings?: Record<string, Record<string, unknown> | undefined>;
};

/** What sets the window when an environment variable does: ahead of every settings file. */
const WINDOW_VARIABLE = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

function read(file: string): Settings {
  try {
    const settings: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof settings === 'object' && settings !== null ? (settings as Settings) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // A file that can't be read isn't overwritten: what's in it would be lost.
    throw new Error(`Can't read ${file}: ${(error as Error).message}`);
  }
}

/** The window a settings file gives the model: its own, else every model's. */
function windowIn(settings: Settings, model: string): unknown {
  return (
    settings.modelSettings?.[canonicalModel(model)]?.['autoCompactWindow'] ??
    settings['autoCompactWindow']
  );
}

/** The settings files in the folder a change can be saved in, the one Claude Code reads first first. */
function changeable(cwd: string, home: string): string[] {
  return settingsFilesIn(cwd, home, process.platform)
    .filter((file) => file.source !== 'managed')
    .map((file) => file.path)
    .reverse();
}

/** The file Claude Code takes a setting from in the folder, or your user settings when none sets it. */
function fileSetting(cwd: string, home: string, sets: (settings: Settings) => boolean): string {
  const files = changeable(cwd, home);
  const setting = files.find((file) => {
    try {
      return sets(read(file));
    } catch {
      return false;
    }
  });
  return setting ?? files.at(-1)!;
}

/** The compaction window the folder's settings give the model, as Claude Code takes it. */
export function windowSet(
  model: string,
  cwd: string,
  home = claudeHome(),
): CompactionWindow | undefined {
  const value = windowIn(
    read(fileSetting(cwd, home, (s) => windowIn(s, model) !== undefined)),
    model,
  );
  return value === 'auto' || typeof value === 'number' ? value : undefined;
}

/**
 * What sets the model's window ahead of the settings files a change can be
 * saved in: an environment variable, or the machine's managed settings.
 * Undefined when nothing does.
 */
export function fixedBy(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (env[WINDOW_VARIABLE]) return WINDOW_VARIABLE;
  try {
    if (windowIn(read(managedSettingsPath(platform)), model) !== undefined)
      return 'your organization’s managed settings';
  } catch {
    // Managed settings that can't be read set nothing.
  }
  return undefined;
}

/**
 * Saves a change to compaction where Claude Code takes it from in the
 * folder: the file that sets it already, else your user settings. The
 * window goes under the model's canonical name, as /autocompact saves it;
 * whether it compacts at all is for every model. The rest stays.
 */
export function saveCompaction(
  model: string,
  change: CompactionChange,
  cwd: string,
  home = claudeHome(),
): void {
  update(
    fileSetting(cwd, home, (s) => windowIn(s, model) !== undefined),
    (settings) => {
      const key = canonicalModel(model);
      const models = (settings.modelSettings ??= {});
      models[key] = { ...models[key], autoCompactWindow: change.window };
    },
  );
}

function update(file: string, change: (settings: Settings) => void): void {
  const settings = read(file);
  change(settings);
  // Written whole, then moved over the old one, so Claude Code never reads half a file.
  writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(`${file}.tmp`, file);
}

/**
 * Measures a model's compaction on a Claude Code process of its own that
 * gets no message and starts no MCP server: with compaction turned on and
 * then off for that process only, how far before the window's end it
 * compacts and the model's own window.
 */
export async function measureCompaction(model: string, cwd: string): Promise<ModelCompaction> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const claude = query({
    prompt: input,
    options: {
      cwd,
      model,
      env: claudeEnv(),
      permissionMode: 'default',
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
    },
  });
  try {
    await claude.applyFlagSettings({ autoCompactEnabled: true });
    const on = await claude.getContextUsage({ detail: 'summary' });
    await claude.applyFlagSettings({ autoCompactEnabled: false });
    const off = await claude.getContextUsage({ detail: 'summary' });
    return {
      max: off.rawMaxTokens,
      reserve: on.autoCompactThreshold ? on.rawMaxTokens - on.autoCompactThreshold : 0,
    };
  } finally {
    input.end();
    claude.close();
  }
}
