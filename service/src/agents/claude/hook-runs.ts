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

/** A hook running or run, and when it began, in ms since the epoch, when known. */
interface HookTimed {
  run: HookRun;
  began?: number;
}

/** The hooks run on the live turn, and those still running from before it, by Claude Code's ID. */
export class HookRuns {
  private readonly runs = new Map<string, HookTimed>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * A hook began, printed something, or ended: the turn's hooks as they
   * stand; undefined for a message about anything else.
   */
  apply(message: HookMessage): HookRun[] | undefined {
    const id = message.hook_id;
    const kind = message.subtype;
    if (!id || (kind !== 'hook_started' && kind !== 'hook_progress' && kind !== 'hook_response'))
      return undefined;
    const now = this.now();
    let timed = this.runs.get(id);
    if (!timed) {
      timed = { run: hookRun(id, message), ...(kind === 'hook_started' ? { began: now } : {}) };
      this.runs.set(id, timed);
    }
    const output = message.output || [message.stdout, message.stderr].filter(Boolean).join('\n');
    if (output.trim()) timed.run.output = output;
    if (kind === 'hook_response') {
      timed.run.outcome = hookOutcome(message);
      if (timed.began !== undefined) timed.run.took = now - timed.began;
    }
    return [...this.runs.values()].map(({ run }) => ({ ...run }));
  }

  /** The live turn ended: the next starts afresh, but for the hooks still running. */
  endTurn(): void {
    for (const [id, { run }] of this.runs) if (run.outcome !== 'running') this.runs.delete(id);
  }
}
