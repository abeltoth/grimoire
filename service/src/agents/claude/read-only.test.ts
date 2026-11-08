import path from 'node:path';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, ChatEvents, Verdict } from '../adapter';
import { approvalsTo } from './claude-adapter';
import { claudeHome } from './config-dir';
import { readOnlyHooks } from './read-only';

const WHY = '"Context meter" is editing this project, so this chat may only read';

/** A chat's events: it reads only while `reading` says why, and you answer each approval with `verdict`. */
function chat(state: { reading?: string; verdict?: Verdict; take?: () => void }) {
  const asked: ApprovalRequest[] = [];
  const events = {
    readOnly: () => state.reading,
    approval: async (request: ApprovalRequest) => {
      asked.push(request);
      state.take?.();
      return state.verdict ?? 'allow-once';
    },
  } as unknown as ChatEvents;
  return { events, asked };
}

const options = { signal: new AbortController().signal, toolUseID: 't1' } as Parameters<
  ReturnType<typeof approvalsTo>
>[2];

describe('a chat that only reads', () => {
  it('is refused edits and commands before Claude Code checks them, whatever its rules allow', async () => {
    const state: { reading?: string } = { reading: WHY };
    const hook = readOnlyHooks(async () => chat(state).events);
    const call = (tool_name: string, tool_input: object = {}) =>
      hook.hooks[0]!(
        { hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't1' } as HookInput,
        't1',
        { signal: new AbortController().signal },
      );
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
      expect(await call(tool)).toEqual({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: WHY },
      });
    expect(await call('Read')).toEqual({});
    expect(await call('Grep')).toEqual({});
    // Its plan, which plan mode writes to Claude Code's plans folder, isn't refused; the folder beside it is.
    expect(await call('Write', { file_path: path.join(claudeHome(), 'plans', 'add-a-meter.md') })).toEqual({});
    expect(await call('Write', { file_path: path.join(claudeHome(), 'plans-old', 'a.md') })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });

    // Once it's the editing chat, they go to Claude Code's own checks.
    delete state.reading;
    expect(await call('Edit')).toEqual({});
  });

  it("is refused, without asking you, any tool plan mode asks for", async () => {
    const { events, asked } = chat({ reading: WHY });
    const decide = approvalsTo(async () => events);
    for (const tool of ['Edit', 'Bash', 'WebFetch', 'mcp__github__create_issue'])
      expect(await decide(tool, {}, options)).toEqual({ behavior: 'deny', message: WHY });
    expect(asked).toEqual([]);
  });

  it('still asks you its questions', async () => {
    const { events, asked } = chat({ reading: WHY, verdict: { answers: [{ chosen: ['Here'] }] } });
    const input = { questions: [{ question: 'Where?', options: [{ label: 'Here' }] }] };
    expect(await approvalsTo(async () => events)('AskUserQuestion', input, options)).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers: { 'Where?': 'Here' } },
    });
    expect(asked).toHaveLength(1);
  });

  it("doesn't carry out its plan, approved or not, until it's made the editing chat", async () => {
    const plan = { plan: 'Add the meter' };
    const kept = chat({ reading: WHY });
    expect(await approvalsTo(async () => kept.events)('ExitPlanMode', plan, options)).toEqual({
      behavior: 'deny',
      message: WHY,
    });
    expect(kept.asked).toMatchObject([{ tool: 'ExitPlanMode', input: plan }]);

    // Made the editing chat as you approve it: the plan goes ahead.
    const state: { reading?: string; take?: () => void } = { reading: WHY };
    state.take = () => delete state.reading;
    const taken = chat(state);
    expect(await approvalsTo(async () => taken.events)('ExitPlanMode', plan, options)).toEqual({
      behavior: 'allow',
      updatedInput: plan,
    });
  });

  it('asks as any chat does once it edits', async () => {
    const { events, asked } = chat({ verdict: 'deny' });
    expect(await approvalsTo(async () => events)('Bash', { command: 'npm test' }, options)).toEqual({
      behavior: 'deny',
      message: 'The user declined this.',
    });
    expect(asked).toMatchObject([{ tool: 'Bash' }]);
  });
});
