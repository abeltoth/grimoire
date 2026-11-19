import { describe, expect, it } from 'vitest';
import type { AgentEntry, Entry, TokenCounts, ToolBlock } from '@grimoire/contract';
import type { ClaudeMessage } from './messages';
import { ToolContext } from './tool-context';
import { ClaudeTranscript } from './transcript';

const counts = (cacheRead: number, cacheWritten: number, output: number): TokenCounts => ({
  input: 2,
  cacheWritten,
  cacheWrittenLong: 0,
  cacheRead,
  output,
});

const tool = (id: string, text: string): ToolBlock => ({
  kind: 'tool',
  id,
  tool: 'Read',
  input: {},
  result: { text, isError: false },
});

const reply = (id: string, ...blocks: ToolBlock[]): AgentEntry => ({ kind: 'agent', id, blocks });

/** What each tool result of the entries was found to add to the context. */
const contexts = (entries: readonly Entry[]) =>
  entries.flatMap((entry) =>
    entry.kind === 'agent'
      ? entry.blocks.flatMap((block) => (block.kind === 'tool' ? [block.result?.context] : []))
      : [],
  );

describe('ToolContext', () => {
  it("puts on a tool what the next call was sent more, less the reply's own output", () => {
    const entries: Entry[] = [reply('msg_1', tool('t1', 'file'))];
    const context = new ToolContext();
    context.reply('msg_1', counts(1_000, 0, 50), entries);
    // Claude Code repeats a reply's tokens on each of its blocks.
    context.reply('msg_1', counts(1_000, 0, 50), entries);
    context.reply('msg_2', counts(1_000, 650, 20), entries);
    expect(contexts(entries)).toEqual([600]);
  });

  it('splits what parallel calls added by the size of their results', () => {
    const entries: Entry[] = [
      reply('msg_1', tool('t1', 'x'.repeat(300)), tool('t2', 'x'.repeat(100))),
    ];
    const context = new ToolContext();
    context.reply('msg_1', counts(0, 1_000, 0), entries);
    context.reply('msg_2', counts(1_000, 401, 0), entries);
    expect(contexts(entries)).toEqual([301, 100]);
  });

  it('leaves it unknown when your message or a compaction came in between', () => {
    for (const between of [
      { kind: 'user', id: 'u2', text: 'And this' },
      { kind: 'compaction', id: 'c1' },
    ] as Entry[]) {
      const entries: Entry[] = [reply('msg_1', tool('t1', 'file')), between];
      const context = new ToolContext();
      context.reply('msg_1', counts(1_000, 0, 0), entries);
      context.reply('msg_2', counts(1_000, 500, 0), entries);
      expect(contexts(entries)).toEqual([undefined]);
    }
  });

  it('leaves it unknown when the context shrank, as when tool results were cleared', () => {
    const entries: Entry[] = [reply('msg_1', tool('t1', 'file'))];
    const context = new ToolContext();
    context.reply('msg_1', counts(5_000, 0, 10), entries);
    context.reply('msg_2', counts(2_000, 0, 10), entries);
    expect(contexts(entries)).toEqual([undefined]);
  });

  it("reads it from a saved chat's replies, not its subagents'", () => {
    const usage = (read: number, written: number, output: number) => ({
      input_tokens: 1,
      cache_creation_input_tokens: written,
      cache_read_input_tokens: read,
      output_tokens: output,
    });
    const assistant = (id: string, content: object, used: object, parent: string | null = null) =>
      ({
        type: 'assistant',
        parent_tool_use_id: parent,
        message: {
          id,
          model: 'claude-opus-5-5',
          role: 'assistant',
          content: [content],
          usage: used,
        },
      }) as ClaudeMessage;
    const transcript = new ClaudeTranscript(false);
    const messages: ClaudeMessage[] = [
      {
        type: 'user',
        uuid: 'u1',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'Go' },
      },
      assistant(
        'msg_1',
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
        usage(0, 3_000, 40),
      ),
      // A subagent's own calls are sent its context, not the chat's.
      assistant('msg_s1', { type: 'text', text: 'ok' }, usage(0, 90_000, 5), 't0'),
      {
        type: 'user',
        uuid: 'u2',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'code' }],
        },
      },
      assistant('msg_2', { type: 'text', text: 'Done' }, usage(3_000, 1_240, 10)),
    ];
    messages.forEach((message, i) => transcript.apply(message, 1_000 + i));
    const [read] = (transcript.entries[1] as AgentEntry).blocks as ToolBlock[];
    expect(read).toMatchObject({ target: 'a.ts', result: { text: 'code', context: 1_200 } });
  });
});
