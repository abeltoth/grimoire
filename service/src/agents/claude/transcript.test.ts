import { describe, expect, it } from 'vitest';
import { type ClaudeMessage, ClaudeTranscript, turnEnd } from './transcript';

// Shaped after real Claude Code output: a tool call, its result, then a reply
// with a thinking block and a text block.
const stream = (event: object): ClaudeMessage => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  event,
});
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

const live: ClaudeMessage[] = [
  stream({ type: 'message_start', message: { id: 'msg_1' } }),
  stream({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'PowerShell', input: {} },
  }),
  stream({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"command": "echo hi"}' },
  }),
  assistant('msg_1', toolUse),
  stream({ type: 'content_block_stop', index: 0 }),
  stream({ type: 'message_stop' }),
  toolResult,
  stream({ type: 'message_start', message: { id: 'msg_2' } }),
  stream({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  }),
  assistant('msg_2', { type: 'thinking', thinking: '', signature: 'sig' }),
  stream({ type: 'content_block_stop', index: 0 }),
  stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  stream({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text: 'It printed ' },
  }),
  stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '"hi".' } }),
  assistant('msg_2', { type: 'text', text: 'It printed "hi".' }),
  stream({ type: 'content_block_stop', index: 1 }),
  stream({ type: 'message_stop' }),
];

const saved: ClaudeMessage[] = [
  {
    type: 'user',
    uuid: 'u1',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: 'Run echo hi' }] },
  },
  assistant('msg_1', toolUse),
  toolResult,
  assistant('msg_2', { type: 'thinking', thinking: '', signature: 'sig' }),
  assistant('msg_2', { type: 'text', text: 'It printed "hi".' }),
];

const expected = [
  {
    kind: 'agent',
    id: 'msg_1',
    blocks: [
      {
        kind: 'tool',
        id: 'toolu_1',
        tool: 'PowerShell',
        input: { command: 'echo hi' },
        result: { text: 'hi', isError: false },
      },
    ],
  },
  {
    kind: 'agent',
    id: 'msg_2',
    blocks: [
      { kind: 'thinking', text: '' },
      { kind: 'text', text: 'It printed "hi".' },
    ],
  },
];

describe('ClaudeTranscript', () => {
  it('builds entries from a live stream, reporting text and status as it goes', () => {
    const texts: string[] = [];
    const statuses: string[] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: (entryId, block, text) => texts.push(`${entryId}/${block}: ${text}`),
      status: (status) => statuses.push(status),
      plan: () => {},
    });
    for (const message of live) transcript.apply(message);

    expect(transcript.entries).toEqual(expected);
    expect(texts).toEqual(['msg_2/1: It printed ', 'msg_2/1: "hi".']);
    expect(statuses).toEqual([
      'thinking',
      'writing',
      'thinking',
      'thinking',
      'thinking',
      'writing',
      'thinking',
    ]);
  });

  it('builds the same entries from a saved session, with your messages', () => {
    const transcript = new ClaudeTranscript(false);
    for (const message of saved) transcript.apply(message);
    expect(transcript.entries).toEqual([
      { kind: 'user', id: 'u1', text: 'Run echo hi' },
      ...expected,
    ]);
  });

  it('keeps the plan from Claude Code\'s task tools, once they succeed', () => {
    const plans: string[][] = [];
    const transcript = new ClaudeTranscript(false, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: (plan) => plans.push(plan.map((step) => `${step.text}: ${step.status}`)),
    });
    let n = 0;
    const call = (name: string, input: object, result: string, isError = false) => {
      const id = `toolu_t${++n}`;
      transcript.apply(assistant(`msg_t${n}`, { type: 'tool_use', id, name, input }));
      transcript.apply({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }] },
      });
    };
    call('TaskCreate', { subject: 'Read the composer', activeForm: 'Reading the composer' }, 'Task #1 created successfully: Read the composer');
    call('TaskCreate', { subject: 'Run the tests' }, 'Task #2 created successfully: Run the tests');
    call('TaskCreate', { subject: 'Refused' }, 'Error', true);
    call('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'Updated task #1 status');
    call('TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status');
    call('TaskUpdate', { taskId: '2', subject: 'Run the composer tests' }, 'Updated task #2');
    call('PowerShell', { command: 'echo hi' }, 'hi');

    expect(plans.at(-1)).toEqual(['Read the composer: done', 'Run the composer tests: pending']);
    expect(plans).toHaveLength(5);
    expect(transcript.plan[0]).toEqual({ text: 'Read the composer', status: 'done', activeText: 'Reading the composer' });

    call('TaskUpdate', { taskId: '1', status: 'deleted' }, 'Updated task #1 deleted');
    call('TodoWrite', { todos: [{ content: 'Only step', status: 'in_progress', activeForm: 'Doing it' }] }, 'ok');
    expect(transcript.plan).toEqual([{ text: 'Only step', status: 'active', activeText: 'Doing it' }]);
  });

  it('reads your pictures and attached files back off a saved message', () => {
    const transcript = new ClaudeTranscript(false);
    transcript.apply({
      type: 'user',
      uuid: 'u1',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'Why is this blurry?\n\n@"src/app/ribbon.ts"' },
        ],
      },
    });
    expect(transcript.entries).toEqual([
      {
        kind: 'user',
        id: 'u1',
        text: 'Why is this blurry?',
        enclosures: [
          { kind: 'picture', mediaType: 'image/png', data: 'AAAA' },
          { kind: 'file', path: 'src/app/ribbon.ts' },
        ],
      },
    ]);
  });

  it('finds where the turn one of your entries began ends', () => {
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

  it('leaves out what a subagent does inside a tool call', () => {
    const transcript = new ClaudeTranscript(false);
    transcript.apply({
      ...assistant('msg_sub', { type: 'text', text: 'inside' }),
      parent_tool_use_id: 'toolu_1',
    });
    expect(transcript.entries).toEqual([]);
  });
});
