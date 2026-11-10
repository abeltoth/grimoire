import type { Note } from './row';
import { margin, summarize } from './summary';

const changed = (target: string, extra: Partial<Note> = {}): Note => ({
  key: target,
  verb: 'Edited',
  target,
  label: target,
  did: 'changed',
  running: false,
  failed: false,
  counts: '+1 −1',
  added: 1,
  removed: 1,
  ...extra,
});

describe('summarize', () => {
  it('sums up a run whose changes were all undone as withdrawn', () => {
    expect(
      summarize([changed('a.ts', { withdrawn: true }), changed('b.ts', { withdrawn: true })]),
    ).toEqual({
      key: 'a.ts/all',
      text: 'Changed 2 files',
      running: false,
      failed: 0,
      withdrawn: true,
    });
  });
});

describe('margin', () => {
  it('merges edits in a row to one file, and sums up more than one note', () => {
    expect(margin([changed('a.ts')])).toEqual({ notes: [changed('a.ts')] });
    const { notes, summary } = margin([changed('a.ts'), changed('a.ts'), changed('b.ts')]);
    expect(notes.map(({ target, times, counts }) => ({ target, times, counts }))).toEqual([
      { target: 'a.ts', times: 2, counts: '+2 −2' },
      { target: 'b.ts', times: undefined, counts: '+1 −1' },
    ]);
    expect(summary).toMatchObject({ text: 'Changed 2 files', counts: '+3 −3' });
  });
});
