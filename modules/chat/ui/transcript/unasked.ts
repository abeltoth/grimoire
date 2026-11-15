import type { Row } from './row';

/** The longest diff that opens unasked; a longer one would push the reply out of view. */
const MAX_LINES = 60;
/** How many of a row's diffs may open unasked, so a turn that changes many files stays readable. */
const MAX_PER_ROW = 3;

/** The notes whose diffs open unasked: short ones among the first few under each row, none waiting for approval. */
export function diffsOpenUnasked(rows: readonly Row[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!('notes' in row)) continue;
    row.notes
      .filter((note) => note.details?.kind === 'diff' && !note.waiting)
      .slice(0, MAX_PER_ROW)
      .filter((note) => note.details?.kind === 'diff' && note.details.lines.length <= MAX_LINES)
      .forEach((note) => keys.add(note.key));
  }
  return keys;
}
