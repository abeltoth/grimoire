import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { EFFORT_LEVELS, fitEffort, type AgentModels, type EffortLevel } from '@grimoire/contract';
import { defaultEffort, type EffortSettings } from './effort';

/**
 * Claude Code's model aliases, such as Opus 5.5, with the effort levels each
 * takes and the one it runs at by default; the dated model IDs are left out.
 */
export function toAgentModels(
  all: readonly ModelInfo[],
  settings: EffortSettings,
  env: NodeJS.ProcessEnv = process.env,
): AgentModels {
  const aliases = all.filter(({ value }) => value !== 'default' && !value.startsWith('claude-'));
  const fallback = all.find(({ value }) => value === 'default')?.resolvedModel;
  const byDefault = aliases.find(({ resolvedModel }) => resolvedModel === fallback);
  return {
    models: aliases.map(({ value, displayName, description, resolvedModel, supportsEffort, supportedEffortLevels }) => {
      const efforts: EffortLevel[] = supportsEffort
        ? EFFORT_LEVELS.filter((level) => supportedEffortLevels?.includes(level))
        : [];
      const effort = fitEffort(defaultEffort(resolvedModel ?? value, settings, env), efforts);
      return {
        id: value,
        name: displayName,
        description,
        ...(efforts.length ? { efforts } : {}),
        ...(effort ? { effort } : {}),
      };
    }),
    ...(byDefault ? { default: byDefault.value } : {}),
  };
}
