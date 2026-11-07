import { type TokenCounts, type TokenUse, addTokens, weighTokens } from '@grimoire/contract';

/** A model's API ID as you'd say it, such as "Opus 5.5" for claude-opus-5-5; others stay as they are. */
export function modelLabel(model: string): string {
  const named = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?(\[.+\])?$/.exec(model);
  if (!named) return model;
  const [, family, major, minor] = named;
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}

const compact = new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 });

/** A count of tokens, short: "820", "12K", "1.2M". */
export function tokenCount(count: number): string {
  return compact.format(Math.round(count));
}

/** A turn's or a span's tokens, weighed as the API prices them. */
export function weightOf(uses: readonly TokenCounts[]): number {
  return weighTokens(addTokens(uses));
}

/** Token counts in words, such as "12K fresh input, 300K read from the cache, 5K output". */
export function countsInWords(counts: TokenCounts): string {
  const parts = [
    [counts.input, 'fresh input'],
    [counts.cacheWritten, 'written to the cache'],
    [counts.cacheWrittenLong, 'written to the cache for an hour'],
    [counts.cacheRead, 'read from the cache'],
    [counts.output, 'output'],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${tokenCount(count)} ${what}`)
    .join(', ');
}

/** What each model spent, a line each, its subagents' apart. */
export function usesInWords(uses: readonly TokenUse[]): string {
  return uses
    .map((use) => {
      const who = use.subagent ? `Subagents on ${modelLabel(use.model)}` : modelLabel(use.model);
      return `${who}: ${countsInWords(use)}`;
    })
    .join('\n');
}
