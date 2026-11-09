import path from 'node:path';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { ChatEvents } from '../adapter';
import { claudeHome } from './config-dir';
import { EDITING_TOOLS, readOnlyHooks } from './read-only';

const WHY = '"Context meter" is editing this project, so this chat can\'t edit files in it';

describe('a chat that only reads', () => {
  const state: { reading?: string } = {};
  const hook = readOnlyHooks(
    async () => ({ readOnly: () => state.reading }) as unknown as ChatEvents,
  );
  const call = (tool_name: string, tool_input: object = {}) =>
    hook.hooks[0]!(
      { hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't1' } as HookInput,
      't1',
      { signal: new AbortController().signal },
    );

  it('is refused file edits before Claude Code checks them, whatever its permission or rules allow', async () => {
    state.reading = WHY;
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
      expect(await call(tool)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: WHY,
        },
      });
    // Its plan, which plan mode writes to Claude Code's plans folder, isn't refused; the folder beside it is.
    expect(
      await call('Write', { file_path: path.join(claudeHome(), 'plans', 'add-a-meter.md') }),
    ).toEqual({});
    expect(
      await call('Write', { file_path: path.join(claudeHome(), 'plans-old', 'a.md') }),
    ).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });

    // Once it's the editing chat, they go to Claude Code's own checks.
    delete state.reading;
    expect(await call('Edit')).toEqual({});
  });

  it('still runs commands, reads and searches, as any chat does', async () => {
    state.reading = WHY;
    expect(hook.matcher!.split('|')).toEqual(EDITING_TOOLS);
    for (const tool of ['Bash', 'PowerShell', 'Monitor', 'Read', 'Grep', 'WebFetch'])
      expect(await call(tool, { command: 'npm test' })).toEqual({});
  });
});
