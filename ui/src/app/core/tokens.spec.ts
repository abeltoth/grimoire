import type { TokenCounts } from '@grimoire/contract';
import { countsInWords, modelLabel, tokenCount, usesInWords, weightOf } from './tokens';

const counts = (input: number, cacheRead: number, output: number): TokenCounts => ({
  input,
  cacheWritten: 0,
  cacheWrittenLong: 0,
  cacheRead,
  output,
});

describe('tokens', () => {
  it('names a model as you’d say it, and keeps a name it doesn’t know', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4');
    expect(modelLabel('claude-haiku-5-5[1m]')).toBe('Haiku 5.5');
    expect(modelLabel('gpt-5')).toBe('gpt-5');
  });

  it('counts tokens short', () => {
    expect(tokenCount(820)).toBe('820');
    expect(tokenCount(12_000)).toBe('12K');
    expect(tokenCount(1_240_000)).toBe('1.2M');
  });

  it('weighs tokens as the API prices them: a cache read a tenth, output five times', () => {
    expect(weightOf([counts(100, 1_000, 0), counts(0, 0, 10)])).toBe(250);
  });

  it('puts the counts in words, leaving out what is none', () => {
    expect(countsInWords(counts(12_000, 300_000, 5_000))).toBe(
      '12K fresh input, 300K read from the cache, 5K output',
    );
  });

  it('says what each model spent, a line each, its subagents’ apart', () => {
    expect(
      usesInWords([
        { model: 'claude-opus-5-5', ...counts(10, 0, 1) },
        { model: 'claude-haiku-5-5', subagent: true, ...counts(20, 0, 0) },
      ]),
    ).toBe('Opus 5.5: 10 fresh input, 1 output\nSubagents on Haiku 5.5: 20 fresh input');
  });
});
