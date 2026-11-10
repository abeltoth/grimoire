import { describe, expect, it } from 'vitest';
import { FOLLOW_UPS_TOOL, toBlock, toolResult } from './messages';

describe('toBlock', () => {
  it('reads text, thinking and tool calls, naming the skill a skill call runs', () => {
    expect(toBlock({ type: 'text', text: 'Hi' })).toEqual({ kind: 'text', text: 'Hi' });
    expect(toBlock({ type: 'thinking', thinking: 'Hmm' })).toEqual({
      kind: 'thinking',
      text: 'Hmm',
    });
    expect(
      toBlock({ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'commit' } }),
    ).toEqual({
      kind: 'tool',
      id: 't1',
      tool: 'Skill',
      input: { skill: 'commit' },
      skill: 'commit',
    });
  });

  it('leaves out the follow-ups tool, which shows as cards, and anything else', () => {
    expect(
      toBlock({ type: 'tool_use', id: 't1', name: FOLLOW_UPS_TOOL, input: {} }),
    ).toBeUndefined();
    expect(toBlock({ type: 'redacted_thinking' })).toBeUndefined();
  });
});

describe('toolResult', () => {
  it("joins a result's text parts, and says whether it failed", () => {
    expect(toolResult({ type: 'tool_result', content: 'ok' })).toEqual({
      text: 'ok',
      isError: false,
    });
    expect(
      toolResult({
        type: 'tool_result',
        content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }],
        is_error: true,
      }),
    ).toEqual({ text: 'one\ntwo', isError: true });
  });
});
