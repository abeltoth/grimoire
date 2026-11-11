import { describe, expect, it } from 'vitest';
import { addTokens, weighTokens } from './tokens';

const none = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };

describe('weighTokens', () => {
  it('weighs each kind of token as the API prices it against fresh input', () => {
    expect(weighTokens({ ...none, input: 100 })).toBe(100);
    expect(weighTokens({ ...none, cacheWritten: 100 })).toBe(125);
    expect(weighTokens({ ...none, cacheWrittenLong: 100 })).toBe(200);
    expect(weighTokens({ ...none, cacheRead: 100 })).toBe(10);
    expect(weighTokens({ ...none, output: 100 })).toBe(500);
  });
});

describe('addTokens', () => {
  it('adds each kind up on its own, and gives none for no counts', () => {
    expect(addTokens([])).toEqual(none);
    expect(
      addTokens([
        { input: 1, cacheWritten: 2, cacheWrittenLong: 3, cacheRead: 4, output: 5 },
        { input: 10, cacheWritten: 20, cacheWrittenLong: 30, cacheRead: 40, output: 50 },
      ]),
    ).toEqual({ input: 11, cacheWritten: 22, cacheWrittenLong: 33, cacheRead: 44, output: 55 });
  });
});
