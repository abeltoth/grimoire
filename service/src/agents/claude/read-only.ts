import path from 'node:path';
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvents } from '../adapter';
import { samePath } from '../files';
import { claudeHome } from './config-dir';
import { ASK_TOOL } from './permissions';

/** Claude Code's tool that ends plan mode, to carry out the plan once you approve it. */
export const PLAN_TOOL = 'ExitPlanMode';

/**
 * The tools that edit files or run commands. A chat that only reads, as
 * another chat edits its project (ADR-011), never uses them: plan mode
 * only asks before they run, and an allow rule, or auto mode's classifier
 * in plan mode, can let them run without asking.
 */
export const CHANGING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor'];

/**
 * Refuses the tools that edit files or run commands in a chat that only
 * reads, before Claude Code's own permission checks, so no mode or rule
 * lets them through; the agent is told why. Its plan, which plan mode
 * writes to a file in Claude Code's plans folder, isn't refused. `events`
 * are the chat's, once it's known.
 */
export function readOnlyHooks(events: () => Promise<ChatEvents>): HookCallbackMatcher {
  return {
    matcher: CHANGING_TOOLS.join('|'),
    hooks: [
      async (hook) => {
        if (hook.hook_event_name !== 'PreToolUse' || !CHANGING_TOOLS.includes(hook.tool_name)) return {};
        if (isPlanFile(hook.tool_input)) return {};
        const why = (await events()).readOnly();
        return why
          ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
          : {};
      },
    ],
  };
}

/**
 * Whether a chat that only reads still asks you about a tool Claude Code
 * asks for: its questions, and the plan it would carry out. Anything else
 * it asks for is refused, as plan mode would let it change things.
 */
export function asksWhileReading(tool: string): boolean {
  return tool === ASK_TOOL || tool === PLAN_TOOL;
}

/** Whether a tool's input names a file in Claude Code's plans folder, where plan mode writes its plan. */
function isPlanFile(input: unknown): boolean {
  const file = (input as { file_path?: unknown } | null)?.file_path;
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const plans = samePath(path.join(claudeHome(), 'plans'));
  return samePath(file).startsWith(plans + path.sep);
}
