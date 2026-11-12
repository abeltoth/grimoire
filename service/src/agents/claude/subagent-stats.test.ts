import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  savedSubagentStats,
  statsFromMeta,
  statsFromResult,
  statsFromUsage,
} from './subagent-stats';

describe('subagent stats', () => {
  it("reads a task's usage, leaving out what it doesn't say", () => {
    expect(statsFromUsage({ total_tokens: 10, duration_ms: 2_000 })).toEqual({
      tokens: 10,
      durationMs: 2_000,
    });
    expect(statsFromUsage(undefined)).toEqual({});
  });

  it("reads a subagent's tool call's result, and nothing from another tool's", () => {
    expect(
      statsFromResult({
        totalDurationMs: 60_000,
        totalTokens: 5_000,
        totalToolUseCount: 3,
        toolStats: { readCount: 1, searchCount: 1, otherToolCount: 1 },
      }),
    ).toEqual({
      durationMs: 60_000,
      tokens: 5_000,
      toolUses: 3,
      tools: { read: 1, search: 1, shell: 0, edit: 0, other: 1 },
      lines: { added: 0, removed: 0 },
    });
    expect(statsFromResult({ stdout: 'ok' })).toEqual({});
    expect(statsFromResult('text')).toEqual({});
  });

  it('reads the effort, background and depth beside a saved run, ignoring an unknown effort', () => {
    expect(statsFromMeta({ effort: 'medium', requestShape: 'background', spawnDepth: 2 })).toEqual({
      effort: 'medium',
      background: true,
      depth: 2,
    });
    expect(statsFromMeta({ effort: 'huge', requestShape: 'foreground' })).toEqual({
      background: false,
    });
  });

  describe('saved', () => {
    let home: string;
    let folder: string;

    beforeEach(() => {
      home = mkdtempSync(path.join(tmpdir(), 'grimoire-stats-'));
      folder = path.join(home, 'projects', 'C--work');
      mkdirSync(path.join(folder, 'chat-1', 'subagents'), { recursive: true });
    });

    afterEach(() => rmSync(home, { recursive: true, force: true }));

    const resultLine = (toolId: string, result: object) =>
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId }] },
        toolUseResult: result,
      });

    it("reads the file beside the run and the tool call's result in the chat", async () => {
      const runs = path.join(folder, 'chat-1', 'subagents');
      writeFileSync(
        path.join(runs, 'agent-a1.meta.json'),
        JSON.stringify({ toolUseId: 'toolu_1', effort: 'high', spawnDepth: 1 }),
      );
      writeFileSync(
        path.join(runs, 'agent-a2.meta.json'),
        JSON.stringify({ toolUseId: 'toolu_2', effort: 'low' }),
      );
      writeFileSync(
        path.join(folder, 'chat-1.jsonl'),
        [
          JSON.stringify({ type: 'assistant', message: { content: [{ id: 'toolu_1' }] } }),
          resultLine('toolu_1', { totalTokens: 42 }),
        ].join('\n'),
      );

      expect(await savedSubagentStats('chat-1', 'toolu_1', home)).toEqual({
        effort: 'high',
        depth: 1,
        tokens: 42,
      });
    });

    it("finds a subagent's subagent's result in its run", async () => {
      writeFileSync(path.join(folder, 'chat-1.jsonl'), '');
      writeFileSync(
        path.join(folder, 'chat-1', 'subagents', 'agent-a1.jsonl'),
        resultLine('toolu_9', { totalDurationMs: 5 }),
      );

      expect(await savedSubagentStats('chat-1', 'toolu_9', home)).toEqual({ durationMs: 5 });
    });

    it("reads a background run's totals from its task's last notification", async () => {
      const notice = (tokens: number) =>
        JSON.stringify({
          type: 'queued_command',
          content:
            '<task-notification>\n<tool-use-id>toolu_b</tool-use-id>\n<result>Found</result>\n' +
            `<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>3</tool_uses>` +
            '<duration_ms>47179</duration_ms></usage>\n</task-notification>',
        });
      writeFileSync(
        path.join(folder, 'chat-1.jsonl'),
        [resultLine('toolu_b', { status: 'async_launched' }), notice(100), notice(46_236)].join(
          '\n',
        ),
      );

      expect(await savedSubagentStats('chat-1', 'toolu_b', home)).toEqual({
        tokens: 46_236,
        toolUses: 3,
        durationMs: 47_179,
      });
    });

    it('has none for a chat that was never saved', async () => {
      expect(await savedSubagentStats('chat-2', 'toolu_1', home)).toEqual({});
    });
  });
});
