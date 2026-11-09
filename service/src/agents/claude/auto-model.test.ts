import type { AgentModels } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import { autoPick, messageForRater } from './auto-model';

const models: AgentModels = {
  models: [
    { id: 'opus', name: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'sonnet', name: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'] },
    { id: 'haiku', name: 'Haiku 4.5' },
  ],
  default: 'opus',
};

describe('Auto', () => {
  it('gives the chat the model rated, at the effort nearest the rating it takes', () => {
    expect(autoPick({ model: 'opus', effort: 'xhigh' }, models)).toEqual({
      model: 'opus',
      effort: 'xhigh',
    });
    expect(autoPick({ model: 'sonnet', effort: 'max' }, models)).toEqual({
      model: 'sonnet',
      effort: 'high',
    });
    // A model without effort levels runs without one.
    expect(autoPick({ model: 'haiku', effort: 'low' }, models)).toEqual({ model: 'haiku' });
  });

  it('picks nothing the agent doesn’t offer', () => {
    expect(
      autoPick({ model: 'haiku', effort: 'low' }, { models: [{ id: 'opus', name: 'Opus' }] }),
    ).toBeUndefined();
  });

  it('gives the rater the first message, cut short', () => {
    expect(messageForRater('Fix the ribbon')).toBe('Fix the ribbon');
    const long = messageForRater('x'.repeat(5_000));
    expect(long).toHaveLength(4_001);
    expect(long.endsWith('x…')).toBe(true);
  });
});
