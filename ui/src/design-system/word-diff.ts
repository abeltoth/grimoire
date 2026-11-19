/** A stretch of a line, and whether it is what changed. */
export interface WordPart {
  text: string;
  changed: boolean;
}

/** What two versions of a line share, word by word. */
export interface WordDiff {
  before: WordPart[];
  after: WordPart[];
  /** The share of the longer line's visible text that stays, from 0 to 1. */
  likeness: number;
}

// Below this likeness the lines are different lines, and marking words would only scatter colour.
const LEAST_LIKENESS = 0.4;
// Beyond this many token pairs the line is shown whole rather than slow the view down.
const MAX_CELLS = 250_000;

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * The words that stay and change between two versions of a line, or nothing
 * when they share too little, or differ only in spacing that nothing would show.
 */
export function wordDiff(before: string, after: string): WordDiff | undefined {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > MAX_CELLS) return undefined;

  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] =
        a[i] === b[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }

  const keptA = new Array<boolean>(a.length).fill(false);
  const keptB = new Array<boolean>(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      keptA[i++] = true;
      keptB[j++] = true;
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) i++;
    else j++;
  }

  const kept = a.reduce((n, token, i) => n + (keptA[i] ? visible(token) : 0), 0);
  const longer = Math.max(visible(before), visible(after));
  const changedVisibly =
    a.some((token, i) => !keptA[i] && visible(token)) ||
    b.some((token, j) => !keptB[j] && visible(token));
  if (!changedVisibly || longer === 0 || kept / longer < LEAST_LIKENESS) return undefined;

  return { before: parts(a, keptA), after: parts(b, keptB), likeness: kept / longer };
}

function tokens(line: string): string[] {
  return [...words.segment(line)].map((s) => s.segment);
}

/** How many characters of a text show, spacing aside. */
function visible(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** A line's tokens joined into runs; spacing between two changes counts as changed, so a marked phrase reads as one. */
function parts(tokens: string[], kept: boolean[]): WordPart[] {
  const changed = tokens.map((token, i) => {
    if (!kept[i]) return true;
    if (visible(token)) return false;
    const previous = i > 0 && !kept[i - 1];
    const next = i < tokens.length - 1 && !kept[i + 1];
    return previous && next;
  });
  const result: WordPart[] = [];
  tokens.forEach((text, i) => {
    const last = result[result.length - 1];
    if (last && last.changed === changed[i]) last.text += text;
    else result.push({ text, changed: changed[i]! });
  });
  return result;
}
