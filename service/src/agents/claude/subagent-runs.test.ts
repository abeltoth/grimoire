import { describe, expect, it } from 'vitest';
import type { Entry } from '@grimoire/contract';
import { runBeganWith, savedSubagentState, subagentAgentId, subagentCallIn } from './subagent-runs';
import type { ClaudeMessage } from './messages';

const assistant = (id: string, block: object): ClaudeMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, role: 'assistant', content: [block] },
});

describe('a saved subagent', () => {
  const result = (toolId: string, text: string, isError = false): ClaudeMessage => ({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: [{ type: 'text', text }],
          is_error: isError,
        },
      ],
    },
  });
  const call = (toolId: string, prompt: string): ClaudeMessage =>
    assistant(`msg_${toolId}`, {
      type: 'tool_use',
      id: toolId,
      name: 'Agent',
      input: { description: 'Look', prompt },
    });

  it('is named by the result of the tool call that started it, in either of its forms', () => {
    const messages = [
      result('toolu_1', 'Read sdk.d.ts\nagentId: string;'),
      result(
        'toolu_2',
        'All done.\nagentId: ae05a781070d8c49e (internal ID - do not mention to user.)',
      ),
      result(
        'toolu_3',
        'Its report was delivered to you as a message from "a572d1044a9eb0bac"; reply to it with SendMessage.',
      ),
    ];
    const named = (toolId: string) => {
      const text = subagentCallIn(messages, toolId)?.result?.text;
      return text === undefined ? undefined : subagentAgentId(text);
    };
    expect(named('toolu_2')).toBe('ae05a781070d8c49e');
    expect(named('toolu_3')).toBe('a572d1044a9eb0bac');
    expect(subagentCallIn(messages, 'toolu_4')).toBeUndefined();
    expect(subagentAgentId('No helper here')).toBeUndefined();
  });

  it('is found by the task it began with when the result names none', () => {
    const messages = [call('toolu_1', 'Find the meter.'), result('toolu_1', 'It is in meter.ts.')];
    const found = subagentCallIn(messages, 'toolu_1');
    expect(found).toEqual({
      prompt: 'Find the meter.',
      result: { text: 'It is in meter.ts.', isError: false },
    });
    expect(subagentAgentId(found!.result!.text)).toBeUndefined();

    const run = (first: unknown): ClaudeMessage[] => [
      { type: 'user', parent_tool_use_id: null, message: first },
      assistant('msg_sub', { type: 'text', text: 'Looking' }),
    ];
    expect(runBeganWith(run({ role: 'user', content: 'Find the meter.\n' }), found!.prompt!)).toBe(
      true,
    );
    expect(
      runBeganWith(
        run({ role: 'user', content: [{ type: 'text', text: 'Find the meter.' }] }),
        'Find the meter.',
      ),
    ).toBe(true);
    expect(runBeganWith(run({ role: 'user', content: 'Find the clock.' }), 'Find the meter.')).toBe(
      false,
    );
    expect(runBeganWith([], 'Find the meter.')).toBe(false);
  });

  it('is named by a message that resumed it, as its result or its recipient', () => {
    const messages = [
      assistant('msg_s', {
        type: 'tool_use',
        id: 'toolu_s',
        name: 'SendMessage',
        input: { to: 'a8192414e515c7a00', message: 'More, please.' },
      }),
      result(
        'toolu_s',
        '{"success":true,"message":"Resuming agent a819241","resumedAgentId":"a8192414e515c7a00"}',
      ),
    ];
    const found = subagentCallIn(messages, 'toolu_s');
    expect(found?.sentTo).toBe('a8192414e515c7a00');
    expect(found?.prompt).toBeUndefined();
    expect(subagentAgentId(found!.result!.text)).toBe('a8192414e515c7a00');
    expect(subagentCallIn([call('toolu_1', 'Look.')], 'toolu_1')?.sentTo).toBeUndefined();
  });

  it('is done once it handed its report back, else as its tool call’s result says', () => {
    const handback: Entry = {
      kind: 'agent',
      id: 'msg_end',
      blocks: [
        { kind: 'tool', id: 'toolu_h', tool: 'SubagentHandback', input: { message: 'Report' } },
      ],
    };
    expect(savedSubagentState([handback], undefined)).toBe('done');
    expect(savedSubagentState([], { text: 'All done.', isError: false })).toBe('done');
    expect(savedSubagentState([], { text: 'It broke.', isError: true })).toBe('failed');
    expect(savedSubagentState([], undefined)).toBe('stopped');
  });
});
