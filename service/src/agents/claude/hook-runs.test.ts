import { describe, expect, it } from 'vitest';
import { HookRuns, hookOutcome, hookRun } from './hook-runs';
import type { HookMessage } from './messages';

const response = (fields: HookMessage): HookMessage => ({
  subtype: 'hook_response',
  output: '',
  stdout: '',
  stderr: '',
  outcome: 'success',
  ...fields,
});

describe('hookRun', () => {
  it("reads the tool off a tool's events only", () => {
    expect(hookRun('h1', { hook_name: 'PreToolUse:PowerShell', hook_event: 'PreToolUse' })).toEqual(
      {
        id: 'h1',
        name: 'PreToolUse:PowerShell',
        event: 'PreToolUse',
        tool: 'PowerShell',
        outcome: 'running',
      },
    );
    expect(hookRun('h2', { hook_name: 'Stop', hook_event: 'Stop' })).toEqual({
      id: 'h2',
      name: 'Stop',
      event: 'Stop',
      outcome: 'running',
    });
    expect(hookRun('h3', { hook_name: 'Stop:Edit', hook_event: 'Stop' }).tool).toBeUndefined();
  });

  it('names a hook by its event when Claude Code gives no name', () => {
    expect(hookRun('h1', { hook_event: 'SessionStart' }).name).toBe('SessionStart');
  });
});

describe('hookOutcome', () => {
  it('tells a hook that blocked, by its exit code or its JSON, from one that failed or was cancelled', () => {
    expect(hookOutcome(response({ stderr: 'No rm -rf', exit_code: 2, outcome: 'error' }))).toBe(
      'blocked',
    );
    expect(hookOutcome(response({ stdout: '{"decision": "block", "reason": "Tests fail"}' }))).toBe(
      'blocked',
    );
    expect(hookOutcome(response({ stdout: ' {"continue": false}\n' }))).toBe('blocked');
    expect(hookOutcome(response({ stderr: 'boom', exit_code: 1, outcome: 'error' }))).toBe(
      'failed',
    );
    expect(hookOutcome(response({ output: 'Hook cancelled', outcome: 'cancelled' }))).toBe(
      'cancelled',
    );
    expect(hookOutcome(response({ stdout: '{"decision": "approve"}' }))).toBe('passed');
  });

  it('takes printed text that only looks like JSON as passing', () => {
    expect(hookOutcome(response({ stdout: '{not json' }))).toBe('passed');
  });
});

describe('HookRuns', () => {
  const hook = (subtype: string, id: string, name: string, fields: object = {}): HookMessage => ({
    subtype,
    hook_id: id,
    hook_name: name,
    hook_event: name.split(':')[0]!,
    ...fields,
  });
  const done = (id: string, name: string, fields: HookMessage = {}) =>
    hook('hook_response', id, name, response(fields));

  it('follows each hook from when it begins to how it went, timed, with what it printed so far', () => {
    let now = 1_000;
    const runs = new HookRuns(() => now);
    const reported = [runs.apply(hook('hook_started', 'h1', 'PostToolUse:Edit'))];
    now += 150;
    reported.push(runs.apply(hook('hook_progress', 'h1', 'PostToolUse:Edit', { output: 'Lint' })));
    now += 250;
    const ok = { output: 'Lint ok', stdout: 'Lint ok', exit_code: 0 };
    reported.push(runs.apply(done('h1', 'PostToolUse:Edit', ok)));
    reported.push(runs.apply(hook('hook_started', 'h2', 'Stop')));
    reported.push(runs.apply(done('h2', 'Stop', { exit_code: 0 })));

    const edit = { id: 'h1', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit' };
    expect(reported).toEqual([
      [{ ...edit, outcome: 'running' }],
      [{ ...edit, outcome: 'running', output: 'Lint' }],
      [{ ...edit, outcome: 'passed', output: 'Lint ok', took: 400 }],
      [
        { ...edit, outcome: 'passed', output: 'Lint ok', took: 400 },
        { id: 'h2', name: 'Stop', event: 'Stop', outcome: 'running' },
      ],
      [
        { ...edit, outcome: 'passed', output: 'Lint ok', took: 400 },
        // It passed and printed nothing, and is still listed.
        { id: 'h2', name: 'Stop', event: 'Stop', outcome: 'passed', took: 0 },
      ],
    ]);
  });

  it('times only a hook it saw begin', () => {
    const runs = new HookRuns(() => 5_000);
    expect(runs.apply(done('h1', 'Stop'))).toEqual([
      { id: 'h1', name: 'Stop', event: 'Stop', outcome: 'passed' },
    ]);
  });

  it('starts afresh after the turn, but for a hook still running', () => {
    const runs = new HookRuns(() => 0);
    runs.apply(hook('hook_started', 'h1', 'Stop'));
    runs.apply(done('h1', 'Stop'));
    runs.apply(hook('hook_started', 'h2', 'PostToolUse:Bash'));
    runs.endTurn();
    expect(
      runs.apply(hook('hook_started', 'h3', 'UserPromptSubmit'))!.map((run) => run.id),
    ).toEqual(['h2', 'h3']);
  });

  it("hears only Claude Code's word on its hooks: Grimoire's own callback says none", () => {
    const runs = new HookRuns(() => 0);
    // What a turn that asks a subagent says, with Grimoire's PreToolUse callback on Agent picking its model.
    expect(runs.apply({ subtype: 'task_started' })).toBeUndefined();
    expect(runs.apply({ subtype: 'hook_callback' })).toBeUndefined();
    expect(runs.apply({ subtype: 'hook_started' })).toBeUndefined();
  });
});
