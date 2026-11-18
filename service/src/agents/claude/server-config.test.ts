import { describe, expect, it } from 'vitest';
import { PRICES } from './server-config';

describe('PRICES', () => {
  // The Usage page's Tokens tab tells each kind's price against fresh input in these words.
  it('prices a cache read at a tenth of fresh input or less, a write at 1.25 times or twice for an hour, output at five times', () => {
    for (const [model, prices] of Object.entries(PRICES)) {
      for (const each of [prices, ...(prices.long ? [prices.long] : [])]) {
        expect(each.cacheRead, model).toBeLessThanOrEqual(each.input * 0.1 + 1e-9);
        expect(each.cacheWritten, model).toBeCloseTo(each.input * 1.25);
        expect(each.cacheWrittenLong, model).toBeCloseTo(each.input * 2);
        expect(each.output, model).toBeCloseTo(each.input * 5);
      }
    }
  });
});
