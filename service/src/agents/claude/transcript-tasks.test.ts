import { describe, expect, it } from 'vitest';
import type { ClaudeMessage } from './messages';
import { ClaudeTranscript } from './transcript';

describe('ClaudeTranscript on subagents', () => {
  it("follows a subagent's task from when it begins until Claude Code says how it ended", () => {
    const states: [string, string][] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      subagentState: (toolId, state) => states.push([toolId, state]),
    });
    const system = (fields: object): ClaudeMessage => ({ type: 'system', ...fields });
    transcript.apply(
      system({
        subtype: 'task_started',
        task_id: 'a1',
        tool_use_id: 'toolu_1',
        description: 'Look',
      }),
    );
    // A background subagent's tool call has its result at once; it's still at work.
    transcript.apply({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'Async agent launched successfully.',
          },
        ],
      },
    });
    transcript.apply(
      system({
        subtype: 'task_notification',
        task_id: 'a1',
        tool_use_id: 'toolu_1',
        status: 'completed',
      }),
    );
    transcript.apply(
      system({
        subtype: 'task_notification',
        task_id: 'a2',
        tool_use_id: 'toolu_2',
        status: 'failed',
      }),
    );
    transcript.apply(
      system({
        subtype: 'task_notification',
        task_id: 'a3',
        tool_use_id: 'toolu_3',
        status: 'stopped',
      }),
    );
    transcript.apply(system({ subtype: 'task_notification', task_id: 'a4', status: 'completed' }));
    transcript.apply(system({ subtype: 'init' }));

    expect(states).toEqual([
      ['toolu_1', 'working'],
      ['toolu_1', 'done'],
      ['toolu_2', 'failed'],
      ['toolu_3', 'stopped'],
    ]);
    expect(transcript.entries).toEqual([]);
  });

  it("passes on how a subagent runs and what it took, as its task and its tool call's result say", () => {
    const said: [string, object][] = [];
    const transcript = new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      subagentStats: (toolId, stats) => said.push([toolId, stats]),
    });
    const system = (fields: object): ClaudeMessage => ({ type: 'system', ...fields });
    transcript.apply(
      system({
        subtype: 'task_started',
        tool_use_id: 'toolu_1',
        is_backgrounded: false,
        spawn_depth: 1,
      }),
    );
    transcript.apply(
      system({
        subtype: 'task_progress',
        tool_use_id: 'toolu_1',
        usage: { total_tokens: 500, tool_uses: 2, duration_ms: 3_000 },
      }),
    );
    transcript.apply({
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      tool_use_result: {
        status: 'completed',
        totalDurationMs: 9_000,
        totalTokens: 1_200,
        totalToolUseCount: 4,
        toolStats: { readCount: 2, bashCount: 1, editFileCount: 1, linesAdded: 7, linesRemoved: 3 },
      },
    });
    // Another tool's result says nothing of a subagent.
    transcript.apply({
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2' }] },
      tool_use_result: { stdout: 'ok' },
    });

    expect(said).toEqual([
      ['toolu_1', { background: false, depth: 1 }],
      ['toolu_1', { tokens: 500, toolUses: 2, durationMs: 3_000 }],
      [
        'toolu_1',
        {
          durationMs: 9_000,
          tokens: 1_200,
          toolUses: 4,
          tools: { read: 2, search: 0, shell: 1, edit: 1, other: 0 },
          lines: { added: 7, removed: 3 },
        },
      ],
    ]);
  });
});
