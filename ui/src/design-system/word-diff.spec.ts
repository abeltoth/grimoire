import { wordDiff, type WordPart } from './word-diff';

/** The changed runs, as text. */
const changed = (parts: WordPart[]) => parts.filter((p) => p.changed).map((p) => p.text);
const joined = (parts: WordPart[]) => parts.map((p) => p.text).join('');

describe('wordDiff', () => {
  it('marks only the word that changed, on each side', () => {
    const diff = wordDiff('Start a general purpose agent.', 'Start a general-purpose agent.')!;
    expect(changed(diff.before)).toEqual([' ']);
    expect(changed(diff.after)).toEqual(['-']);
    expect(joined(diff.before)).toBe('Start a general purpose agent.');
    expect(joined(diff.after)).toBe('Start a general-purpose agent.');
  });

  it('marks words added at the end as one run', () => {
    const diff = wordDiff('Fix every problem.', 'Fix every problem. Do not review the fixes.')!;
    expect(changed(diff.before)).toEqual([]);
    expect(changed(diff.after)).toEqual([' Do not review the fixes.']);
  });

  it('keeps accented words and emoji whole', () => {
    const diff = wordDiff('Az általános ügynök 👩‍💻 kész', 'Az új ügynök 👩‍💻 kész')!;
    expect(changed(diff.before)).toEqual(['általános']);
    expect(changed(diff.after)).toEqual(['új']);
  });

  it('leaves lines that share too little whole', () => {
    expect(wordDiff('const a = compute(first);', 'return render(other, more);')).toBeUndefined();
  });

  it('leaves lines that differ only in spacing whole, since nothing would show', () => {
    expect(wordDiff('  indented line', '    indented line')).toBeUndefined();
    expect(wordDiff('trailing', 'trailing  ')).toBeUndefined();
  });
});
