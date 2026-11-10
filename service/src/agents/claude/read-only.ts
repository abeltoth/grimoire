import path from 'node:path';
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvents } from '../adapter';
import { samePath } from '../../core/files';
import { claudeHome } from './config-dir';

/**
 * The tools that edit files. A chat that only reads, as another chat edits
 * its project (ADR-011), never uses them, whatever its permission or
 * rules allow.
 */
export const EDITING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/**
 * Refuses the tools that edit files in a chat that only reads, before
 * Claude Code's own permission checks, so no mode or rule lets them
 * through; the agent is told why. Its plan, which plan mode writes to a
 * file in Claude Code's plans folder, isn't refused. `events` are the
 * chat's, once it's known.
 */
export function readOnlyHooks(events: () => Promise<ChatEvents>): HookCallbackMatcher {
  return {
    matcher: EDITING_TOOLS.join('|'),
    hooks: [
      async (hook) => {
        if (hook.hook_event_name !== 'PreToolUse' || !EDITING_TOOLS.includes(hook.tool_name))
          return {};
        if (isPlanFile(hook.tool_input)) return {};
        const why = (await events()).readOnly();
        return why
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: why,
              },
            }
          : {};
      },
    ],
  };
}

/** Whether a tool's input names a file in Claude Code's plans folder, where plan mode writes its plan. */
function isPlanFile(input: unknown): boolean {
  const file = (input as { file_path?: unknown } | null)?.file_path;
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const plans = samePath(path.join(claudeHome(), 'plans'));
  return samePath(file).startsWith(plans + path.sep);
}
