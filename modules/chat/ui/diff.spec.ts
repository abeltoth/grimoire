import type { Approval } from '@grimoire/contract';
import { askOf } from './asks';
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
    expect(fileChange('Bash', { command: 'ls' })).toBeUndefined();
  });
});

describe('askOf', () => {
  const approval = (tool: string, input: unknown, title?: string): Approval => ({
    id: 'a1',
    chatId: 'c1',
    tool,
    input,
    ...(title ? { title } : {}),
  });

  it('shows a command with what it does', () => {
    expect(
      askOf(approval('Bash', { command: 'git push', description: 'Pushes the branch' }, 'Run?')),
    ).toEqual({
      kind: 'command',
      asks: 'asks to run this command',
      command: 'git push',
      about: 'Pushes the branch',
    });
  });

  it('shows a file change relative to the chat folder', () => {
    expect(
      askOf(
        approval('Edit', { file_path: 'C:\\repo\\src\\a.ts', old_string: 'a', new_string: 'b' }),
        'C:/repo',
      ),
    ).toMatchObject({ kind: 'file', asks: 'asks to correct this file', file: 'src/a.ts' });
  });

  it('shows any other tool with its input', () => {
    expect(askOf(approval('WebFetch', { url: 'https://x' }, 'Fetch x'))).toEqual({
      kind: 'tool',
      asks: 'asks to use WebFetch',
      detail: '{\n  "url": "https://x"\n}',
      about: 'Fetch x',
    });
  });
});
