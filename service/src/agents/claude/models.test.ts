import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { toAgentModels } from './models';

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const model = (value: string, resolvedModel: string, levels?: ModelInfo['supportedEffortLevels']): ModelInfo => ({
  value,
  resolvedModel,
  displayName: value,
  description: `${value} model`,
  ...(levels ? { supportsEffort: true, supportedEffortLevels: levels } : {}),
});

describe('toAgentModels', () => {
  const all = [
    model('default', 'claude-opus-5-5'),
    model('opus', 'claude-opus-5-5', ['max', 'low', 'xhigh', 'high', 'medium']),
    model('sonnet-4-6', 'claude-sonnet-4-6', ['low', 'medium', 'high', 'max']),
    model('haiku-4-5', 'claude-haiku-4-5-20251001'),
    model('claude-opus-5-5', 'claude-opus-5-5', [...ALL]),
  ];

  it('lists the aliases with their effort levels in order, and the default model', () => {
    const { models, default: byDefault } = toAgentModels(all, {}, {});
    expect(byDefault).toBe('opus');
    expect(models.map((m) => m.id)).toEqual(['opus', 'sonnet-4-6', 'haiku-4-5']);
    expect(models[0]).toEqual({ id: 'opus', name: 'opus', description: 'opus model', efforts: [...ALL] });
    expect(models[2]).toEqual({ id: 'haiku-4-5', name: 'haiku-4-5', description: 'haiku-4-5 model' });
  });

  it('gives each model the effort your settings give it, as near as it takes', () => {
    const xhigh = { effortLevel: 'xhigh' };
    const settings = { modelSettings: { 'claude-opus-5-5': xhigh, 'claude-sonnet-4-6': xhigh, 'claude-haiku-4-5': xhigh } };
    const { models } = toAgentModels(all, settings, {});
    expect(models.map((m) => m.effort)).toEqual(['xhigh', 'high', undefined]);
  });
});
