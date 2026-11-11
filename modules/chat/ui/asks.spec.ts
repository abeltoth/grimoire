import type { Approval } from '@grimoire/contract';
import { askOf, scopeText } from './asks';

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

  it('takes the approval’s title when the tool says nothing of what it does', () => {
    expect(askOf(approval('PowerShell', { command: 'ls' }, 'List files'))).toMatchObject({
      kind: 'command',
      about: 'List files',
    });
    expect(askOf(approval('Bash', { command: 'ls' }))).not.toHaveProperty('about');
  });
});

describe('scopeText', () => {
  it('names where an always-allow holds, in the book’s words or plainly', () => {
    const book = (bookWords: string) => bookWords;
    const plain = (_book: string, plainWords: string) => plainWords;
    expect(scopeText('chat', book)).toBe('in this chapter');
    expect(scopeText('chat', plain)).toBe('in this chat');
    expect(scopeText('project', book)).toBe('in this project');
    expect(scopeText('everywhere', plain)).toBe('in every project');
  });
});
