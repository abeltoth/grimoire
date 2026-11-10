import { describe, expect, it } from 'vitest';
import { turnEnd, wholeRun } from './entries';
import type { ClaudeMessage } from './messages';

const assistant = (id: string, block: object): ClaudeMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, role: 'assistant', content: [block] },
});
const toolUse = {
  type: 'tool_use',
  id: 'toolu_1',
  name: 'PowerShell',
  input: { command: 'echo hi' },
};
const toolResult: ClaudeMessage = {
  type: 'user',
  uuid: 'u2',
  parent_tool_use_id: null,
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi', is_error: false }],
  },
};

describe('turnEnd', () => {
  it('finds where the turn one of your messages began ends', () => {
    const you = (uuid: string, content: unknown): ClaudeMessage => ({
      type: 'user',
      uuid,
      parent_tool_use_id: null,
      message: { role: 'user', content },
    });
    const messages: ClaudeMessage[] = [
      you('u1', 'Run echo hi'),
      { ...assistant('msg_1', toolUse), uuid: 'a1' },
      { ...toolResult, uuid: 'r1' },
      { ...assistant('msg_2', { type: 'text', text: 'Done.' }), uuid: 'a2' },
      you('u2', [{ type: 'text', text: 'Again' }]),
      { ...assistant('msg_3', { type: 'text', text: 'Done again.' }), uuid: 'a3' },
    ];
    expect(turnEnd(messages, 'u1')).toBe('a2');
    expect(turnEnd(messages, 'u2')).toBeUndefined();
    expect(() => turnEnd(messages, 'gone')).toThrow('not in the chat');
  });
});

describe('wholeRun', () => {
  it('reads a resumed run whole: its task, what it did, and what it was sent, but not Claude Code’s notes', () => {
    const entries = wholeRun([
      {
        type: 'user',
        uuid: 'u1',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'Plan it.' },
      },
      {
        type: 'user',
        uuid: 'u2',
        parent_tool_use_id: null,
        is_meta: true,
        message: { role: 'user', content: '<system-reminder>Hand back.</system-reminder>' },
      },
      assistant('msg_1', { type: 'text', text: 'Here is a plan.' }),
      {
        type: 'user',
        uuid: 'u3',
        parent_tool_use_id: null,
        is_meta: true,
        origin: { kind: 'coordinator' },
        message: {
          role: 'user',
          content: 'The coordinator sent a message while you were working:\nMore detail.',
        },
      },
      assistant('msg_2', { type: 'text', text: 'Here is more.' }),
    ]);
    expect(entries.map((entry) => (entry.kind === 'user' ? entry.text : entry.id))).toEqual([
      'Plan it.',
      'msg_1',
      'More detail.',
      'msg_2',
    ]);
  });
});
