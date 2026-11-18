import { describe, expect, it } from 'vitest';
import { PRICES } from './server-config';

describe('PRICES', () => {
  it('prices every kind of token, a cache read below fresh input and a cache write above it', () => {
    for (const [model, prices] of Object.entries(PRICES)) {
      for (const each of [prices, ...(prices.long ? [prices.long] : [])]) {
        expect(each.cacheRead, model).toBeLessThan(each.input);
        expect(each.cacheWritten, model).toBeGreaterThan(each.input);
        expect(each.cacheWrittenLong, model).toBeGreaterThan(each.cacheWritten);
        expect(each.output, model).toBeGreaterThan(each.input);
      }
    }
  });
});
