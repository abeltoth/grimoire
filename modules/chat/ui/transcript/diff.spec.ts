import { diffLines, fileChange } from './diff';

const kinds = (lines: { kind: string; text: string }[]) =>
  lines.map((line) => `${{ same: ' ', removed: '-', inserted: '+' }[line.kind]}${line.text}`);

describe('diffLines', () => {
  it('keeps the common lines and marks what goes and comes', () => {
    expect(
      kinds(
        diffLines(
          'a\ntemplate: x\nb\nclass A {}',
          'a\ntemplateUrl: y\nstyleUrl: z\nb\nclass A {\n}',
        ),
      ),
    ).toEqual([
      ' a',
      '-template: x',
      '+templateUrl: y',
      '+styleUrl: z',
      ' b',
      '-class A {}',
      '+class A {',
      '+}',
    ]);
  });

  it('treats a new file as all inserted, and handles Windows line ends', () => {
    expect(kinds(diffLines('', 'one\r\ntwo\r\n'))).toEqual(['+one', '+two']);
    expect(diffLines('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });
});

describe('fileChange', () => {
  it('reads the file tools', () => {
    expect(fileChange('Write', { file_path: '/r/a.ts', content: 'x' })).toEqual({
      file: '/r/a.ts',
      lines: [{ kind: 'inserted', text: 'x' }],
    });
    expect(
      fileChange('MultiEdit', {
        file_path: '/r/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'c\nd' },
        ],
      })!.lines.map((l) => l.kind),
    ).toEqual(['removed', 'inserted', 'same', 'inserted']);
    expect(
      fileChange('MultiEdit', {
        file_path: '/r/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'c\nd' },
        ],
      })!.breaks,
    ).toEqual([2]);
    expect(fileChange('Bash', { command: 'ls' })).toBeUndefined();
  });

  it('reads what the agent reported it changed, numbered, each hunk set apart', () => {
    const change = fileChange(
      'Edit',
      { file_path: '/r/a.ts', old_string: 'b', new_string: 'c' },
      {
        text: 'Updated.',
        isError: false,
        hunks: [
          { oldStart: 9, newStart: 9, lines: [' a', '-b', '+c', '+d', ' e'] },
          { oldStart: 40, newStart: 41, lines: ['-f', '+g', '\\ No newline at end of file'] },
        ],
      },
    )!;
    expect(change.file).toBe('/r/a.ts');
    expect(change.lines).toEqual([
      { kind: 'same', text: 'a', at: 9 },
      { kind: 'removed', text: 'b', at: 10 },
      { kind: 'inserted', text: 'c', at: 10 },
      { kind: 'inserted', text: 'd', at: 11 },
      { kind: 'same', text: 'e', at: 12 },
      { kind: 'removed', text: 'f', at: 40 },
      { kind: 'inserted', text: 'g', at: 41 },
    ]);
    expect(change.breaks).toEqual([5]);
    // Without a report, the change is read from what the tool was asked.
    expect(
      fileChange(
        'Edit',
        { file_path: '/r/a.ts', old_string: 'b', new_string: 'c' },
        {
          text: 'Failed.',
          isError: true,
        },
      )!.lines,
    ).toEqual([
      { kind: 'removed', text: 'b' },
      { kind: 'inserted', text: 'c' },
    ]);
  });
});
