import type { HookRun } from '@grimoire/contract';
import { hookOutcome, hookTook, hookWhen, hooksRan } from './hook-log';
import type { HookLog } from './row';

const book = (bookWords: string) => bookWords;
const plain = (_book: string, plainWords: string) => plainWords;
const run = (event: string, tool?: string, outcome: HookRun['outcome'] = 'passed'): HookRun => ({
  id: 'h1',
  name: tool ? `${event}:${tool}` : event,
  event,
  ...(tool ? { tool } : {}),
  outcome,
});

describe('hookWhen', () => {
  it('says when a hook ran by its event and the tool it ran for', () => {
    expect(hookWhen(run('PostToolUse', 'Edit'), book)).toBe('After an edit');
    expect(hookWhen(run('PreToolUse', 'PowerShell'), book)).toBe('Before a command');
    expect(hookWhen(run('PostToolUseFailure', 'Grep'), book)).toBe('After a search failed');
    expect(hookWhen(run('PermissionDenied', 'WebFetch'), book)).toBe('After a fetch was denied');
    expect(hookWhen(run('PreToolUse', 'mcp__github__issue'), book)).toBe('Before a tool');
    expect(hookWhen(run('Stop'), book)).toBe('As the turn ended');
  });

  it('says it in the book’s words or plainly', () => {
    expect(hookWhen(run('PreToolUse', 'Agent'), book)).toBe('Before a helper');
    expect(hookWhen(run('PreToolUse', 'Agent'), plain)).toBe('Before a subagent');
    expect(hookWhen(run('UserPromptSubmit'), plain)).toBe('On your message');
    expect(hookWhen(run('PermissionRequest', 'Write'), book)).toBe('Asking your seal for an edit');
  });

  it('names an event it doesn’t know by its name', () => {
    expect(hookWhen(run('SomethingNew'), book)).toBe('SomethingNew');
  });
});

describe('hookOutcome', () => {
  it('says how a hook went', () => {
    expect(hookOutcome(run('Stop', undefined, 'running'), book)).toBe('running…');
    expect(hookOutcome(run('Stop', undefined, 'blocked'), book)).toBe('barred the way');
    expect(hookOutcome(run('Stop', undefined, 'blocked'), plain)).toBe('blocked');
    expect(hookOutcome(run('Stop', undefined, 'failed'), book)).toBe('failed');
  });
});

describe('hookTook', () => {
  it('tells less than a second in ms, and longer as a duration', () => {
    expect(hookTook(-3)).toBe('0ms');
    expect(hookTook(412.6)).toBe('413ms');
    expect(hookTook(2_000)).not.toMatch(/ms$/);
  });
});

describe('hooksRan', () => {
  it('counts the turn’s hooks, as ran once none still runs', () => {
    const log = (count: number, running: number) =>
      ({ key: 'k', runs: Array(count).fill(run('Stop')), running }) as unknown as HookLog;
    expect(hooksRan(log(1, 0))).toBe('1 hook ran');
    expect(hooksRan(log(3, 0))).toBe('3 hooks ran');
    expect(hooksRan(log(3, 1))).toBe('3 hooks');
  });
});
