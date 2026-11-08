import type { HookRun } from '@grimoire/contract';
import { duration } from './duration';
import type { HookLog } from './rows';

/** Says a thing in the book's words, or plainly. */
type Say = (book: string, plain: string) => string;

/** What a tool a hook ran for did, as its event's words name it: "an edit", "a command". */
function deedOf(tool: string | undefined, say: Say): string {
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Write':
      return 'an edit';
    case 'Bash':
    case 'PowerShell':
      return 'a command';
    case 'Read':
      return 'a read';
    case 'Grep':
    case 'Glob':
      return 'a search';
    case 'WebFetch':
      return 'a fetch';
    case 'WebSearch':
      return 'a web search';
    case 'Agent':
    case 'Task':
      return say('a helper', 'a subagent');
    default:
      return 'a tool';
  }
}

/** When a hook ran, in words: "After an edit", "As the turn ended"; an event it doesn't know, by name. */
export function hookWhen(run: HookRun, say: Say): string {
  const deed = () => deedOf(run.tool, say);
  switch (run.event) {
    case 'PreToolUse':
      return `Before ${deed()}`;
    case 'PostToolUse':
      return `After ${deed()}`;
    case 'PostToolUseFailure':
      return `After ${deed()} failed`;
    case 'PermissionRequest':
      return say(`Asking your seal for ${deed()}`, `Asking approval for ${deed()}`);
    case 'PermissionDenied':
      return `After ${deed()} was denied`;
    case 'UserPromptSubmit':
      return say('On your entry', 'On your message');
    case 'Stop':
      return 'As the turn ended';
    case 'StopFailure':
      return 'As the turn failed';
    case 'SubagentStart':
      return say('As a helper began', 'As a subagent started');
    case 'SubagentStop':
      return say('As a helper finished', 'As a subagent finished');
    case 'SessionStart':
      return say('As the chapter opened', 'As the chat started');
    case 'SessionEnd':
      return say('As the chapter closed', 'As the chat ended');
    case 'PreCompact':
      return 'Before compacting';
    case 'PostCompact':
      return 'After compacting';
    case 'Notification':
      return 'On a notification';
    default:
      return run.event;
  }
}

/** How a hook went, in words. */
export function hookOutcome(run: HookRun, say: Say): string {
  switch (run.outcome) {
    case 'running':
      return 'running…';
    case 'blocked':
      return say('barred the way', 'blocked');
    default:
      return run.outcome;
  }
}

/** How long a hook took: most take less than a second, so those are told in ms. */
export function hookTook(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : duration(ms);
}

/** A turn's hooks counted up: "3 hooks ran", or while one runs, "3 hooks". */
export function hooksRan(log: HookLog): string {
  const count = `${log.runs.length} ${log.runs.length === 1 ? 'hook' : 'hooks'}`;
  return log.running ? count : `${count} ran`;
}
