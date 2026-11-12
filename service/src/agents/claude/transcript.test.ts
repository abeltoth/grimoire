import { describe, expect, it } from 'vitest';
import type { Entry, HookRun } from '@grimoire/contract';
import type { ClaudeMessage } from './messages';
import { ClaudeTranscript } from './transcript';

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

  it('names the skill a Skill call runs', () => {
    const transcript = new ClaudeTranscript(false);
    const call = {
      type: 'tool_use',
      id: 'toolu_9',
      name: 'Skill',
      input: { skill: 'dataviz', args: 'a chart' },
    };
    transcript.apply(assistant('msg_9', call));
    expect(transcript.entries).toEqual([
      {
        kind: 'agent',
        id: 'msg_9',
        blocks: [
          { kind: 'tool', id: 'toolu_9', tool: 'Skill', input: call.input, skill: 'dataviz' },
        ],
      },
    ]);
  });

  it('times each saved turn, from your message to its last', () => {
    const transcript = new ClaudeTranscript(false);
    const second: ClaudeMessage = {
      type: 'user',
      uuid: 'u3',
      parent_tool_use_id: null,
      message: { role: 'user', content: 'Thanks' },
    };
    const at = [0, 2_000, 3_000, 61_000, 75_500, 100_000];
    [...saved, second].forEach((message, i) => transcript.apply(message, at[i]));
    // The last turn has no reply yet: no time.
    expect(transcript.entries.filter((entry) => entry.kind === 'user')).toEqual([
      { kind: 'user', id: 'u1', text: 'Run echo hi', took: 75_500 },
      { kind: 'user', id: 'u3', text: 'Thanks' },
    ]);
  });

  it("keeps the plan from Claude Code's task tools, once they succeed", () => {
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
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }],
        },
      });
    };
    call(
      'TaskCreate',
      { subject: 'Read the composer', activeForm: 'Reading the composer' },
      'Task #1 created successfully: Read the composer',
    );
    call('TaskCreate', { subject: 'Run the tests' }, 'Task #2 created successfully: Run the tests');
    call('TaskCreate', { subject: 'Refused' }, 'Error', true);
    call('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'Updated task #1 status');
    call('TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status');
    call('TaskUpdate', { taskId: '2', subject: 'Run the composer tests' }, 'Updated task #2');
    call('PowerShell', { command: 'echo hi' }, 'hi');

    expect(plans.at(-1)).toEqual(['Read the composer: done', 'Run the composer tests: pending']);
    expect(plans).toHaveLength(5);
    expect(transcript.plan[0]).toEqual({
      text: 'Read the composer',
      status: 'done',
      activeText: 'Reading the composer',
    });

    call('TaskUpdate', { taskId: '1', status: 'deleted' }, 'Updated task #1 deleted');
    call(
      'TodoWrite',
      { todos: [{ content: 'Only step', status: 'in_progress', activeForm: 'Doing it' }] },
      'ok',
    );
    expect(transcript.plan).toEqual([
      { text: 'Only step', status: 'active', activeText: 'Doing it' },
    ]);
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
        attachments: [
          { kind: 'picture', mediaType: 'image/png', data: 'AAAA' },
          { kind: 'file', path: 'src/app/ribbon.ts' },
        ],
      },
    ]);
  });

  it("passes on what a subagent does inside a tool call as its subagent's run, apart from the chat", () => {
    const helped: [string, unknown][] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      subagentEntry: (toolId, entry) => helped.push([toolId, structuredClone(entry)]),
    });
    const inside = (message: ClaudeMessage, toolId = 'toolu_1'): ClaudeMessage => ({
      ...message,
      parent_tool_use_id: toolId,
    });
    transcript.apply(inside(assistant('msg_sub', { ...toolUse, id: 'toolu_s1' })));
    transcript.apply(
      inside({
        ...toolResult,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_s1', content: 'hi' }],
        },
      }),
    );
    transcript.apply(inside(assistant('msg_sub2', { type: 'text', text: 'Done' })));
    // A subagent's subagent has a run of its own.
    transcript.apply(inside(assistant('msg_deep', { type: 'text', text: 'Deeper' }), 'toolu_s2'));

    expect(transcript.entries).toEqual([]);
    expect(helped.map(([toolId, entry]) => [toolId, (entry as { id: string }).id])).toEqual([
      ['toolu_1', 'msg_sub'],
      ['toolu_1', 'msg_sub'],
      ['toolu_1', 'msg_sub'],
      ['toolu_1', 'msg_sub2'],
      ['toolu_1', 'msg_sub2'],
      ['toolu_s2', 'msg_deep'],
      ['toolu_s2', 'msg_deep'],
    ]);
    expect(helped[2]![1]).toMatchObject({
      blocks: [{ kind: 'tool', id: 'toolu_s1', result: { text: 'hi', isError: false } }],
    });
  });

  it('reads a saved subagent’s run on its own', () => {
    const run = new ClaudeTranscript(false);
    run.applyRun({
      ...assistant('msg_sub', { type: 'text', text: 'Done' }),
      parent_tool_use_id: 'toolu_1',
    });
    expect(run.entries).toMatchObject([
      { kind: 'agent', id: 'msg_sub', blocks: [{ text: 'Done' }] },
    ]);
  });

  it('notes the model that wrote each reply, but not on Claude Code’s own notes', () => {
    const transcript = new ClaudeTranscript(false);
    const by = (id: string, model: string): ClaudeMessage => ({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    });
    transcript.apply(by('msg_1', 'claude-sonnet-4-5'));
    transcript.apply(by('msg_2', '<synthetic>'));
    expect(transcript.entries).toMatchObject([
      { id: 'msg_1', model: 'claude-sonnet-4-5' },
      { id: 'msg_2' },
    ]);
    expect(transcript.entries[1]).not.toHaveProperty('model');
  });

  it("notes the model of a subagent's replies as it works", () => {
    const helped: Entry[] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      subagentEntry: (_toolId, entry) => helped.push(structuredClone(entry)),
    });
    transcript.apply({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: {
        id: 'msg_sub',
        model: 'claude-haiku-4-5',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
      },
    });
    expect(helped.at(-1)).toMatchObject({ id: 'msg_sub', model: 'claude-haiku-4-5' });
  });

  describe('tokens', () => {
    const usage = (input: number, written: number, long: number, read: number, output: number) => ({
      input_tokens: input,
      cache_creation_input_tokens: written,
      cache_creation: {
        ephemeral_1h_input_tokens: long,
        ephemeral_5m_input_tokens: written - long,
      },
      cache_read_input_tokens: read,
      output_tokens: output,
    });
    const reply = (
      id: string,
      model: string,
      used: object,
      parent: string | null = null,
    ): ClaudeMessage => ({
      type: 'assistant',
      parent_tool_use_id: parent,
      message: {
        id,
        model,
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        usage: used,
      },
    });
    const you = (uuid: string, text: string): ClaudeMessage => ({
      type: 'user',
      uuid,
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
    });

    it('counts each saved turn by model, once per reply, its subagents apart', () => {
      const transcript = new ClaudeTranscript(false);
      const messages: [ClaudeMessage, number][] = [
        [you('u1', 'Fix it'), 1_000],
        // Claude Code repeats a reply's usage on each of its blocks.
        [reply('msg_1', 'claude-opus-5-5', usage(2, 100, 100, 0, 10)), 2_000],
        [reply('msg_1', 'claude-opus-5-5', usage(2, 100, 100, 0, 10)), 2_000],
        [reply('msg_2', 'claude-opus-5-5', usage(3, 20, 20, 100, 30)), 3_000],
        // Its own notes cost nothing.
        [reply('msg_3', '<synthetic>', usage(0, 0, 0, 0, 0)), 3_500],
        [you('u2', 'Thanks'), 10_000],
        [reply('msg_4', 'claude-opus-5-5', usage(1, 0, 0, 120, 5)), 11_000],
      ];
      for (const [message, at] of messages) transcript.apply(message, at);
      // A subagent's run, saved apart, counts toward the turn it ran in.
      transcript.applySubagent(reply('msg_s1', 'claude-sonnet-5-5', usage(4, 50, 0, 0, 40)), 2_500);
      transcript.applySubagent(reply('msg_s2', 'claude-sonnet-5-5', usage(1, 0, 0, 50, 2)), 2_600);

      const yours = transcript.entries.filter((entry) => entry.kind === 'user');
      expect(yours.map((entry) => entry.tokens)).toEqual([
        {
          at: 1_000,
          uses: [
            {
              model: 'claude-opus-5-5',
              input: 5,
              cacheWritten: 0,
              cacheWrittenLong: 120,
              cacheRead: 100,
              output: 40,
            },
            {
              model: 'claude-sonnet-5-5',
              subagent: true,
              input: 5,
              cacheWritten: 50,
              cacheWrittenLong: 0,
              cacheRead: 50,
              output: 42,
            },
          ],
        },
        {
          at: 10_000,
          uses: [
            {
              model: 'claude-opus-5-5',
              input: 1,
              cacheWritten: 0,
              cacheWrittenLong: 0,
              cacheRead: 120,
              output: 5,
            },
          ],
        },
      ]);
    });

    it("reports the live turn's tokens as they grow, its subagents' included, and starts afresh after it", () => {
      const reported: object[][] = [];
      const transcript = new ClaudeTranscript(true, {
        entry: () => {},
        text: () => {},
        status: () => {},
        plan: () => {},
        tokens: (uses) => reported.push(uses),
      });
      transcript.apply(reply('msg_1', 'claude-opus-5-5', usage(2, 10, 10, 0, 5)));
      transcript.apply(reply('msg_1', 'claude-opus-5-5', usage(2, 10, 10, 0, 5)));
      transcript.apply(reply('msg_s1', 'claude-haiku-4-5', usage(3, 0, 0, 0, 1), 'toolu_1'));
      transcript.apply({ type: 'result' });
      transcript.apply(reply('msg_2', 'claude-opus-5-5', usage(1, 0, 0, 10, 2)));

      // The repeated block isn't reported again.
      expect(reported).toEqual([
        [
          {
            model: 'claude-opus-5-5',
            input: 2,
            cacheWritten: 0,
            cacheWrittenLong: 10,
            cacheRead: 0,
            output: 5,
          },
        ],
        [
          {
            model: 'claude-opus-5-5',
            input: 2,
            cacheWritten: 0,
            cacheWrittenLong: 10,
            cacheRead: 0,
            output: 5,
          },
          {
            model: 'claude-haiku-4-5',
            subagent: true,
            input: 3,
            cacheWritten: 0,
            cacheWrittenLong: 0,
            cacheRead: 0,
            output: 1,
          },
        ],
        [
          {
            model: 'claude-opus-5-5',
            input: 1,
            cacheWritten: 0,
            cacheWrittenLong: 0,
            cacheRead: 10,
            output: 2,
          },
        ],
      ]);
      // Still left out of the chat's own entries.
      expect(transcript.entries.map((entry) => entry.id)).toEqual(['msg_1', 'msg_2']);
    });
  });

  it("passes on the turn's hooks as they run, and starts afresh after the turn", () => {
    const reported: HookRun[][] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      hooks: (runs) => reported.push(runs),
    });
    const hook = (subtype: string, id: string, fields: object = {}) =>
      transcript.apply({
        type: 'system',
        subtype,
        hook_id: id,
        hook_name: 'Stop',
        hook_event: 'Stop',
        ...fields,
      } as ClaudeMessage);
    hook('hook_started', 'h1');
    hook('hook_response', 'h1', { outcome: 'success' });
    hook('hook_started', 'h2');
    transcript.apply({ type: 'result' });
    hook('hook_started', 'h3');

    expect(reported.map((runs) => runs.map((run) => [run.id, run.outcome]))).toEqual([
      [['h1', 'running']],
      [['h1', 'passed']],
      [
        ['h1', 'passed'],
        ['h2', 'running'],
      ],
      [
        ['h2', 'running'],
        ['h3', 'running'],
      ],
    ]);
    expect(transcript.entries).toEqual([]);
  });
});
