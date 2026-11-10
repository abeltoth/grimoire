import { describe, expect, it } from 'vitest';
import { CacheTracker, cacheLife, contextTokens } from './cache';

describe('contextTokens', () => {
  it('adds up what the last request read, wrote and replied', () => {
    expect(
      contextTokens({
        input_tokens: 2,
        cache_read_input_tokens: 281_272,
        cache_creation_input_tokens: 1_472,
        output_tokens: 206,
      }),
    ).toBe(282_952);
  });

  it("counts a tool loop's last request, not their sum", () => {
    expect(
      contextTokens({
        input_tokens: 100,
        output_tokens: 100,
        iterations: [
          { input_tokens: 10, output_tokens: 5 },
          { input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 7 },
        ],
      }),
    ).toBe(57);
  });
});

describe('cacheLife', () => {
  it('reads an hour or five minutes from what was written to the cache', () => {
    expect(
      cacheLife({ cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 0 } }),
    ).toBe(3_600_000);
    expect(
      cacheLife({ cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9 } }),
    ).toBe(300_000);
    expect(cacheLife({ cache_read_input_tokens: 100 })).toBeUndefined();
  });
});

describe('CacheTracker', () => {
  it('gives the last reply’s tokens and when its cache runs out', () => {
    const tracker = new CacheTracker();
    expect(tracker.cache).toBeUndefined();
    tracker.reply({ input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10 } }, 1_000);
    // Nothing written this time: the cache lasts as long as the last write said.
    tracker.reply({ input_tokens: 1, cache_read_input_tokens: 40, output_tokens: 9 }, 2_000);
    expect(tracker.cache).toEqual({ tokens: 50, until: 2_000 + 300_000 });
  });

  it('takes an hour when no reply says', () => {
    const tracker = new CacheTracker();
    tracker.reply({ input_tokens: 5 }, 0);
    expect(tracker.cache).toEqual({ tokens: 5, until: 3_600_000 });
  });

  it('starts afresh at a compaction, with the summary’s length once it’s known', () => {
    const tracker = new CacheTracker();
    tracker.reply({ input_tokens: 90_000 }, 1_000);
    tracker.compacted(5_000);
    expect(tracker.cache).toBeUndefined();
    // The replies kept from before it come again after it, and change nothing.
    tracker.reply({ input_tokens: 90_000 }, 1_000);
    expect(tracker.measured(12_000)).toBe(true);
    expect(tracker.cache).toEqual({ tokens: 12_000, until: 5_000 + 3_600_000 });
    expect(tracker.measured(13_000)).toBe(false);
  });

  it('takes the summary’s length from the compaction, when it says', () => {
    const tracker = new CacheTracker();
    tracker.compacted(5_000, 8_000);
    expect(tracker.measured(12_000)).toBe(false);
    expect(tracker.cache).toEqual({ tokens: 8_000, until: 5_000 + 3_600_000 });
  });
});
