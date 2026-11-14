import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CompactionChange, CompactionWindow } from '@grimoire/contract';
import { claudeHome } from './config-dir';
import { canonicalModel } from './effort';
import { MessageQueue } from './message-queue';
import { claudeEnv, sdk } from './probe';

/** The smallest window Claude Code takes for a model. */
export const MIN_WINDOW = 100_000;

/** What Claude Code's measure tells of a model's compaction, whatever your settings say. */
export interface ModelCompaction {
  /** Whether it compacts a chat by itself. */
  enabled: boolean;
  /** The model's own window: the most its compaction window can be. */
  max: number;
  /** How far before the window's end it compacts. */
  reserve: number;
}

type Settings = Record<string, unknown> & {
  modelSettings?: Record<string, Record<string, unknown> | undefined>;
};

const settingsFile = (home: string) => path.join(home, 'settings.json');

function read(home: string): Settings {
  try {
    const settings: unknown = JSON.parse(readFileSync(settingsFile(home), 'utf8'));
    return typeof settings === 'object' && settings !== null ? (settings as Settings) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // A file that can't be read isn't overwritten: what's in it would be lost.
    throw new Error(`Can't read Claude Code's settings: ${(error as Error).message}`);
  }
}

/** The compaction window your user settings give the model: its own, else every model's. */
export function windowSet(model: string, home = claudeHome()): CompactionWindow | undefined {
  let settings: Settings;
  try {
    settings = read(home);
  } catch {
    return undefined;
  }
  const own = settings.modelSettings?.[canonicalModel(model)]?.['autoCompactWindow'];
  const value = own ?? settings['autoCompactWindow'];
  return value === 'auto' || typeof value === 'number' ? value : undefined;
}

/**
 * Saves a change to compaction in your user settings, as Claude Code's
 * /autocompact does: the window under the model's canonical name, whether
 * it compacts at all for every model. The rest of the file stays.
 */
export function saveCompaction(model: string, change: CompactionChange, home = claudeHome()): void {
  const settings = read(home);
  if (change.window !== undefined) {
    const key = canonicalModel(model);
    const models = (settings.modelSettings ??= {});
    models[key] = { ...models[key], autoCompactWindow: change.window };
  }
  if (change.enabled !== undefined) settings['autoCompactEnabled'] = change.enabled;
  const file = settingsFile(home);
  // Written whole, then moved over the old one, so Claude Code never reads half a file.
  writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(`${file}.tmp`, file);
}

/**
 * Measures a model's compaction on a Claude Code process of its own that
 * gets no message and starts no MCP server: whether it compacts, and,
 * with compaction turned on and then off for that process only, how far
 * before the window's end it does and the model's own window.
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
    const { isAutoCompactEnabled: enabled } = await claude.getContextUsage({ detail: 'summary' });
    await claude.applyFlagSettings({ autoCompactEnabled: true });
    const on = await claude.getContextUsage({ detail: 'summary' });
    await claude.applyFlagSettings({ autoCompactEnabled: false });
    const off = await claude.getContextUsage({ detail: 'summary' });
    return {
      enabled,
      max: off.rawMaxTokens,
      reserve: on.autoCompactThreshold ? on.rawMaxTokens - on.autoCompactThreshold : 0,
    };
  } finally {
    input.end();
    claude.close();
  }
}
