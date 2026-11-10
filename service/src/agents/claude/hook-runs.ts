import type { HookRun } from '@grimoire/contract';
import type { HookMessage } from './messages';

/** The events a hook runs on for a tool, which its name follows with the tool's. */
const TOOL_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
]);

/** The exit code by which a hook's command stops what it ran on. */
const BLOCKING_EXIT = 2;

/** A hook Claude Code began, before it says how it went. */
export function hookRun(id: string, message: HookMessage): HookRun {
  const event = message.hook_event ?? '';
  const name = message.hook_name ?? event;
  const tool =
    TOOL_EVENTS.has(event) && name.startsWith(`${event}:`) ? name.slice(event.length + 1) : '';
  return { id, name, event, ...(tool ? { tool } : {}), outcome: 'running' };
}

/**
 * How a hook ended: blocked when it stopped what it ran on, by exiting with
 * code 2 or by saying so in the JSON it printed.
 */
export function hookOutcome(message: HookMessage): HookRun['outcome'] {
  if (message.outcome === 'cancelled') return 'cancelled';
  if (message.exit_code === BLOCKING_EXIT || saysBlock(message.stdout)) return 'blocked';
  return message.outcome === 'error' ? 'failed' : 'passed';
}

/** Whether a hook printed JSON that blocks: a decision to block, or not to continue. */
function saysBlock(stdout: string | undefined): boolean {
  const text = stdout?.trim();
  if (!text?.startsWith('{')) return false;
  try {
    const said = JSON.parse(text) as { decision?: unknown; continue?: unknown } | null;
    return said?.decision === 'block' || said?.continue === false;
  } catch {
    return false;
  }
}
