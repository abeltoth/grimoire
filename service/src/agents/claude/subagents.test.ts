import type { AgentModels, EffortLevel } from '@grimoire/contract';
import { describe, expect, it, vi } from 'vitest';
import {
  type PickerSources,
  cheaperPick,
  chatModelOf,
  modelIsSet,
  pickFor,
  readRating,
  taskForRater,
  tierOf,
} from './subagents';

const ALL: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const models: AgentModels = {
  models: [
    { id: 'opus', name: 'Opus 5.5', description: '', efforts: ALL, effort: 'xhigh' },
    {
      id: 'sonnet',
      name: 'Sonnet 5.5',
      description: '',
      efforts: ['low', 'medium', 'high'],
      effort: 'high',
    },
    { id: 'haiku', name: 'Haiku 4.5', description: '' },
  ],
  default: 'opus',
};

describe('the subagent picker', () => {
  it('reads the rater’s answer, and nothing else', () => {
    expect(readRating('{"model": "haiku", "effort": "low"}')).toEqual({
      model: 'haiku',
      effort: 'low',
    });
    expect(readRating('Here: {"model":"sonnet","effort":"high"} — done')).toEqual({
      model: 'sonnet',
      effort: 'high',
    });
    expect(readRating('{"model": "fable", "effort": "low"}')).toBeUndefined();
    expect(readRating('{"model": "haiku", "effort": "tiny"}')).toBeUndefined();
    expect(readRating('haiku, low')).toBeUndefined();
    expect(readRating('{not json}')).toBeUndefined();
  });

  it('gives the rater the task, its prompt cut short', () => {
    const task = taskForRater({ description: 'Find the tests', prompt: 'x'.repeat(5_000) });
    expect(task.startsWith('Subagent: general-purpose\nTask: Find the tests\n\nxxx')).toBe(true);
    expect(task.endsWith('x…')).toBe(true);
    expect(task.length).toBeLessThan(4_100);
  });

  it('tells the three models apart by alias or ID', () => {
    expect(tierOf('opus[1m]')).toBe('opus');
    expect(tierOf('claude-sonnet-5-5')).toBe('sonnet');
    expect(tierOf('haiku')).toBe('haiku');
    expect(tierOf('fable')).toBeUndefined();
    expect(tierOf(undefined)).toBeUndefined();
  });

  it('leaves a subagent alone whose model is someone else’s to say', () => {
    const definitions = [
      { name: 'Explore', model: 'haiku' },
      { name: 'general-purpose', model: 'inherit' },
      { name: 'reviewer' },
    ];
    expect(modelIsSet({ prompt: 'p' }, definitions, {})).toBe(false);
    expect(modelIsSet({ subagent_type: 'reviewer' }, definitions, {})).toBe(false);
    expect(modelIsSet({ model: 'opus' }, definitions, {})).toBe(true);
    expect(modelIsSet({ effort: 'max' }, definitions, {})).toBe(true);
    expect(modelIsSet({ subagent_type: 'fork' }, definitions, {})).toBe(true);
    expect(modelIsSet({ subagent_type: 'Explore' }, definitions, {})).toBe(true);
    expect(modelIsSet({}, definitions, { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' })).toBe(true);
  });

  it('reads the model and effort the chat runs at', () => {
    expect(chatModelOf({}, models)).toEqual({ tier: 'opus', effort: 'xhigh' });
    expect(chatModelOf({ model: 'sonnet', effort: 'low' }, models)).toEqual({
      tier: 'sonnet',
      effort: 'low',
    });
    expect(chatModelOf({ model: 'haiku' }, models)).toEqual({ tier: 'haiku' });
    expect(chatModelOf({ model: 'fable' }, models)).toBeUndefined();
  });

  it('only ever picks cheaper than the chat runs', () => {
    const opus = { tier: 'opus' as const, effort: 'xhigh' as const };
    // A cheaper model, at an effort it takes; Haiku takes none.
    expect(cheaperPick({ model: 'sonnet', effort: 'max' }, opus, models)).toEqual({
      model: 'sonnet',
      effort: 'high',
    });
    expect(cheaperPick({ model: 'haiku', effort: 'low' }, opus, models)).toEqual({
      model: 'haiku',
    });
    // The same model, only at a lower effort.
    expect(cheaperPick({ model: 'opus', effort: 'medium' }, opus, models)).toEqual({
      effort: 'medium',
    });
    expect(cheaperPick({ model: 'opus', effort: 'max' }, opus, models)).toBeUndefined();
    // Never a stronger model, nor a higher effort than the chat's.
    const sonnet = { tier: 'sonnet' as const, effort: 'low' as const };
    expect(cheaperPick({ model: 'opus', effort: 'high' }, sonnet, models)).toBeUndefined();
    expect(
      cheaperPick({ model: 'haiku', effort: 'high' }, { tier: 'opus', effort: 'low' }, models),
    ).toEqual({
      model: 'haiku',
    });
    expect(
      cheaperPick({ model: 'sonnet', effort: 'high' }, { tier: 'opus', effort: 'low' }, models),
    ).toEqual({
      model: 'sonnet',
      effort: 'low',
    });
  });

  describe('pickFor', () => {
    const sources = (
      answer: string,
      settings: PickerSources['settings'] = () => ({}),
    ): PickerSources => ({
      settings,
      models: async () => models,
      definitions: async () => [{ name: 'Explore', model: 'haiku' }],
      rate: vi.fn(async () => answer),
      env: {},
    });
    const signal = new AbortController().signal;
    const task = {
      description: 'List the routes',
      prompt: 'List every route in app.routes.ts',
      run_in_background: true,
    };

    it('gives an easy task a cheaper model, keeping the rest of the call', async () => {
      const from = sources('{"model": "haiku", "effort": "low"}');
      await expect(pickFor(task, from, signal)).resolves.toEqual({ ...task, model: 'haiku' });
      expect(from.rate).toHaveBeenCalledWith(
        expect.stringContaining('Task: List the routes'),
        signal,
      );
    });

    it('leaves a hard task as Claude Code would run it', async () => {
      await expect(
        pickFor(task, sources('{"model": "opus", "effort": "high"}'), signal),
      ).resolves.toEqual({
        ...task,
        effort: 'high',
      });
      await expect(
        pickFor(task, sources('{"model": "opus", "effort": "max"}'), signal),
      ).resolves.toBeUndefined();
      await expect(pickFor(task, sources('I am not sure'), signal)).resolves.toBeUndefined();
    });

    it('picks against the chat’s model as it is now', async () => {
      let settings: { model?: string; effort?: EffortLevel } = {};
      const from = sources('{"model": "sonnet", "effort": "medium"}', () => settings);
      await expect(pickFor(task, from, signal)).resolves.toMatchObject({ model: 'sonnet' });
      settings = { model: 'sonnet', effort: 'medium' };
      await expect(pickFor(task, from, signal)).resolves.toBeUndefined();
    });

    it("doesn't ask when the model is set, or nothing is cheaper", async () => {
      const set = sources('{"model": "haiku", "effort": "low"}');
      await expect(
        pickFor({ ...task, subagent_type: 'Explore' }, set, signal),
      ).resolves.toBeUndefined();
      await expect(pickFor({ ...task, model: 'opus' }, set, signal)).resolves.toBeUndefined();
      const haiku = sources('{"model": "haiku", "effort": "low"}', () => ({ model: 'haiku' }));
      await expect(pickFor(task, haiku, signal)).resolves.toBeUndefined();
      expect(set.rate).not.toHaveBeenCalled();
      expect(haiku.rate).not.toHaveBeenCalled();
    });
  });
});
