import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitReferences, withReferences } from './references';

const cwd = path.resolve('/work/grimoire');

describe('file references', () => {
  it('writes attached files as @-references after the text, inside the folder relative to it', () => {
    const outside = path.resolve('/elsewhere/notes.txt');
    const written = withReferences(
      'Why is this blurry?',
      [
        { kind: 'file', path: path.join(cwd, 'src', 'app', 'ribbon.ts') },
        { kind: 'picture', mediaType: 'image/png', data: 'AAAA' },
        { kind: 'file', path: outside },
      ],
      cwd,
    );
    expect(written).toBe(`Why is this blurry?\n\n@"src/app/ribbon.ts"\n@"${outside}"`);
    expect(withReferences('Just text', [], cwd)).toBe('Just text');
    expect(withReferences('', [{ kind: 'file', path: path.join(cwd, 'a b.txt') }], cwd)).toBe(
      '@"a b.txt"',
    );
  });

  it('reads them back off the last lines, quoted or as typed in a terminal', () => {
    expect(splitReferences('Why?\n\n@"src/app/ribbon.ts"\n@notes.txt\n')).toEqual({
      text: 'Why?',
      files: [
        { kind: 'file', path: 'src/app/ribbon.ts' },
        { kind: 'file', path: 'notes.txt' },
      ],
    });
    expect(splitReferences('Look at @notes.txt for me')).toEqual({
      text: 'Look at @notes.txt for me',
      files: [],
    });
  });
});
