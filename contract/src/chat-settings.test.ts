import { describe, expect, it } from 'vitest';
import { fitEffort } from './chat-settings';

describe('fitEffort', () => {
  it('keeps a level the model takes, and steps down to one it does', () => {
    expect(fitEffort('xhigh', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('xhigh');
    expect(fitEffort('xhigh', ['low', 'medium', 'high', 'max'])).toBe('high');
    expect(fitEffort(undefined, ['low'])).toBeUndefined();
  });
});
