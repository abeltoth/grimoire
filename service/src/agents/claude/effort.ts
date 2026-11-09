import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { EFFORT_LEVELS, type EffortLevel } from '@grimoire/contract';

/** The part of Claude Code's settings that sets a model's effort. */
export interface EffortSettings {
  modelSettings?: Record<string, { effortLevel?: unknown } | undefined>;
}

const isLevel = (value: unknown): value is EffortLevel =>
  EFFORT_LEVELS.includes(value as EffortLevel);

/** The name Claude Code keys a model's settings by: without "[1m]" or a date at its end. */
export function canonicalModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/**
 * The effort Claude Code runs a model at when a chat names none, as far as
 * your user settings say: CLAUDE_CODE_EFFORT_LEVEL, else the effortLevel
 * under modelSettings for the model (a key spelled as the model's canonical
 * name wins over one with "[1m]" or a date). Undefined otherwise: Claude
 * Code then uses the model's built-in default, or for some older models
 * the top-level effortLevel, neither of which it tells. A folder's own
 * settings can still change it; they aren't read here.
 */
export function defaultEffort(
  model: string,
  settings: EffortSettings,
  env: NodeJS.ProcessEnv = process.env,
): EffortLevel | undefined {
  const fromEnv = env['CLAUDE_CODE_EFFORT_LEVEL'];
  if (isLevel(fromEnv)) return fromEnv;
  const canonical = canonicalModel(model);
  let found: unknown;
  for (const [key, own] of Object.entries(settings.modelSettings ?? {})) {
    if (own?.effortLevel === undefined || canonicalModel(key) !== canonical) continue;
    if (key === canonical) return isLevel(own.effortLevel) ? own.effortLevel : undefined;
    found ??= own.effortLevel;
  }
  return isLevel(found) ? found : undefined;
}

/** Your Claude Code user settings; empty when there are none or they can't be read. */
export function readUserSettings(env: NodeJS.ProcessEnv = process.env): EffortSettings {
  const dir = env['CLAUDE_CONFIG_DIR'] || path.join(homedir(), '.claude');
  try {
    const settings: unknown = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    return typeof settings === 'object' && settings !== null ? (settings as EffortSettings) : {};
  } catch {
    return {};
  }
}
