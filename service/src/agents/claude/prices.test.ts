import { describe, expect, it } from 'vitest';
import { costOf } from './prices';

const million = {
  input: 1e6,
  cacheWritten: 1e6,
  cacheWrittenLong: 1e6,
  cacheRead: 1e6,
  output: 1e6,
};

describe('costOf', () => {
  it("prices each kind of token at the model's list price", () => {
    expect(costOf('claude-opus-5-5', million)).toEqual({
      input: 4,
      cacheWritten: 5,
      cacheWrittenLong: 8,
      cacheRead: 0.2,
      output: 20,
    });
    expect(costOf('claude-sonnet-4-6', { ...million, output: 2e6 })!.output).toBe(30);
  });

  it('knows a model by its id with a date snapshot or a context tag', () => {
    expect(costOf('claude-opus-4-5-20251101', million)!.input).toBe(5);
    expect(costOf('claude-opus-4-6[1m]', million)!.input).toBe(5);
    // Not taken for a longer id it starts.
    expect(costOf('claude-opus-5', million)!.input).toBe(5);
  });

  it('prices Haiku 5.5 higher for a prompt over 100K tokens', () => {
    const short = {
      input: 50_000,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 50_000,
      output: 0,
    };
    expect(costOf('claude-haiku-5-5', short)!.input).toBeCloseTo(0.005);
    const long = { ...short, cacheRead: 50_001 };
    expect(costOf('claude-haiku-5-5', long)!.input).toBeCloseTo(0.025);
  });

  it("has no price for a model it doesn't know", () => {
    expect(costOf('some-other-model', million)).toBeUndefined();
  });
});
