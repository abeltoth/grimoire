import { describe, expect, it, vi } from 'vitest';
import { claudeEnv, probe } from './probe';

const made: { options: Record<string, unknown>; closed: boolean }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    const process = { options, closed: false, close: () => (process.closed = true) };
    made.push(process);
    return process;
  },
}));

describe('claudeEnv', () => {
  it('has Claude Code keep its plan with its task tools, beside your environment', () => {
    expect(claudeEnv()).toMatchObject({ CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });
    expect((claudeEnv() as NodeJS.ProcessEnv)['PATH']).toBe(process.env['PATH']);
  });
});

describe('probe', () => {
  it('asks a process, then stops it, running in a folder as a chat’s process does', async () => {
    made.length = 0;
    expect(await probe(async () => 'answer')).toBe('answer');
    expect(await probe(async () => 'there', '/work')).toBe('there');
    expect(made[0]).toEqual({
      options: { permissionMode: 'default' },
      closed: true,
      close: expect.any(Function),
    });
    expect(made[1]!.options).toMatchObject({
      cwd: '/work',
      permissionMode: 'default',
      env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
    });
    expect(made[1]!.closed).toBe(true);
  });

  it('stops the process when the asking fails too', async () => {
    made.length = 0;
    await expect(
      probe(async () => {
        throw new Error('No answer');
      }),
    ).rejects.toThrow('No answer');
    expect(made[0]!.closed).toBe(true);
  });
});
