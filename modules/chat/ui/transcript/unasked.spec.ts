import type { Note, Row } from './row';
import { diffsOpenUnasked } from './unasked';

const edit = (key: string, length = 2, extra: Partial<Note> = {}): Note => ({
  key,
  verb: 'Edited',
  target: key,
  label: key,
  did: 'changed',
  running: false,
  failed: false,
  details: {
    kind: 'diff',
    file: key,
    path: key,
    lines: Array.from({ length }, () => ({ kind: 'inserted' as const, text: 'x' })),
  },
  ...extra,
});
const ran = (key: string): Note => ({
  key,
  verb: 'Ran',
  target: key,
  label: key,
  did: 'ran',
  running: false,
  failed: false,
  details: { kind: 'output', title: key, text: 'ok' },
});
const row = (key: string, notes: Note[]): Row => ({ kind: 'notes', key, notes });

describe('diffsOpenUnasked', () => {
  it('opens the first three diffs under a row, and nothing else', () => {
    const keys = diffsOpenUnasked([
      row('r1', [ran('ls'), edit('a'), edit('b'), edit('c'), edit('d')]),
      row('r2', [edit('e')]),
      { kind: 'thinking', key: 't', text: 'hm' },
    ]);
    expect([...keys]).toEqual(['a', 'b', 'c', 'e']);
  });

  it('leaves a long diff, and one waiting for your approval, closed', () => {
    const keys = diffsOpenUnasked([
      row('r1', [edit('long', 61), edit('short', 60), edit('asked', 1, { waiting: true })]),
    ]);
    expect([...keys]).toEqual(['short']);
  });
});
