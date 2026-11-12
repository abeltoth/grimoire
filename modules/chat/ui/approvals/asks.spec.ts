import type { Approval } from '@grimoire/contract';
import { type Ask, alwaysText, askOf, scopeText } from './asks';

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
      asks: 'run a command',
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
    ).toMatchObject({ kind: 'file', asks: 'correct this file', file: 'src/a.ts' });
  });

  it('shows any other tool with its input', () => {
    expect(askOf(approval('WebFetch', { url: 'https://x' }, 'Fetch x'))).toEqual({
      kind: 'tool',
      asks: 'use WebFetch',
      detail: 'url: https://x',
      about: 'Fetch x',
    });
  });

  it('shows a plan to start on as its markdown', () => {
    expect(askOf(approval('ExitPlanMode', { plan: '# Plan\n\n- one' }, 'Exit plan mode?'))).toEqual(
      { kind: 'plan', asks: 'start on this plan', plan: '# Plan\n\n- one' },
    );
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

describe('alwaysText', () => {
  const plain = (_book: string, plainWords: string) => plainWords;
  const command = {
    kind: 'command',
    asks: 'run a command',
    command: 'git push origin main',
  } as const;

  it('names a rule other than the command, and calls the command itself "this command"', () => {
    expect(alwaysText({ rule: 'git push', scope: 'project' }, command, 'Bash', plain)).toEqual({
      rule: 'git push',
      scope: 'in this project',
    });
    expect(
      alwaysText({ rule: ' git push origin main ', scope: 'chat' }, command, 'Bash', plain),
    ).toEqual({ what: 'this command', scope: 'in this chat' });
  });

  it('names edits, or the tool, when the rule covers all of it', () => {
    const file: Ask = {
      kind: 'file',
      asks: 'write this file',
      file: 'a.ts',
      path: '/a.ts',
      lines: [],
    };
    expect(alwaysText({ scope: 'everywhere' }, file, 'Write', plain)).toEqual({
      what: 'edits',
      scope: 'in every project',
    });
    const tool = { kind: 'tool', asks: 'use WebFetch', detail: '{}' } as const;
    expect(alwaysText({ scope: 'project' }, tool, 'WebFetch', plain)).toEqual({
      what: 'WebFetch',
      scope: 'in this project',
    });
  });
});
