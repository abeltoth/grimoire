import type { TokenCounts } from '@grimoire/contract';

// Values Grimoire keeps by hand about Claude, which a server will hand out later; any like them go here.

/** The model Claude Code recommends for Grimoire's quick jobs, unless Settings names another. */
export const QUICK_MODEL = 'haiku';

/** A model's list prices, in US dollars per million tokens of each kind. */
export interface ModelPrices extends TokenCounts {
  /** Higher prices for a request whose prompt, cache reads and writes included, is longer than `over` tokens. */
  long?: { over: number } & TokenCounts;
}

const price = (
  input: number,
  cacheWritten: number,
  cacheWrittenLong: number,
  cacheRead: number,
  output: number,
): TokenCounts => ({ input, cacheWritten, cacheWrittenLong, cacheRead, output });

const FABLE_5_2 = price(8, 10, 16, 0.2, 40);
const FABLE_5_1 = price(10, 12.5, 20, 0.25, 50);
const FABLE_5 = price(10, 12.5, 20, 1, 50);
const OPUS_5 = price(5, 6.25, 10, 0.5, 25);
const OPUS_4_1 = price(15, 18.75, 30, 1.5, 75);
const SONNET_4 = price(3, 3.75, 6, 0.3, 15);

/** The API's list prices by model id, from Anthropic's pricing page. */
export const PRICES: Record<string, ModelPrices> = {
  'claude-fable-5-2': FABLE_5_2,
  'claude-mythos-5-2': FABLE_5_2,
  'claude-fable-5-1': FABLE_5_1,
  'claude-mythos-5-1': FABLE_5_1,
  'claude-fable-5': FABLE_5,
  'claude-mythos-5': FABLE_5,
  'claude-opus-5-5': price(4, 5, 8, 0.2, 20),
  'claude-opus-5': OPUS_5,
  'claude-opus-4-8': OPUS_5,
  'claude-opus-4-7': OPUS_5,
  'claude-opus-4-6': OPUS_5,
  'claude-opus-4-5': OPUS_5,
  'claude-opus-4-1': OPUS_4_1,
  'claude-opus-4': OPUS_4_1,
  'claude-sonnet-5-5': price(2, 2.5, 4, 0.1, 10),
  'claude-sonnet-5': price(2, 2.5, 4, 0.2, 10),
  'claude-sonnet-4-6': SONNET_4,
  'claude-sonnet-4-5': SONNET_4,
  'claude-sonnet-4': SONNET_4,
  'claude-haiku-5-5': {
    ...price(0.1, 0.125, 0.2, 0.01, 0.5),
    long: { over: 100_000, ...price(0.5, 0.625, 1, 0.05, 2.5) },
  },
  'claude-haiku-4-5': price(1, 1.25, 2, 0.1, 5),
};
