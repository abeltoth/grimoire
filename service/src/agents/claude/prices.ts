import type { TokenCounts } from '@grimoire/contract';
import { PRICES } from './server-config';

/** A model id as priced: without a date snapshot or a context tag, such as "claude-opus-4-5-20251101" or "claude-opus-4-6[1m]". */
function priced(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/**
 * What one request's tokens would cost at the API's list prices, in US
 * dollars, each kind apart; undefined for a model without known prices.
 */
export function costOf(model: string, counts: TokenCounts): TokenCounts | undefined {
  const known = PRICES[priced(model)];
  if (!known) return undefined;
  const prompt = counts.input + counts.cacheWritten + counts.cacheWrittenLong + counts.cacheRead;
  const prices: TokenCounts = known.long && prompt > known.long.over ? known.long : known;
  const of = (kind: keyof TokenCounts) => (counts[kind] * prices[kind]) / 1_000_000;
  return {
    input: of('input'),
    cacheWritten: of('cacheWritten'),
    cacheWrittenLong: of('cacheWrittenLong'),
    cacheRead: of('cacheRead'),
    output: of('output'),
  };
}
