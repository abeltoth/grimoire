import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClaudeMessage } from './messages';
import {
  savedExtras,
  savedFileResults,
  withSavedAttribution,
  withSavedResult,
} from './saved-patches';

const answer = (id: string) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: 'Updated.' }],
});

describe('saved file results', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'grimoire-patches-'));
    const folder = path.join(home, 'projects', 'C--work');
    mkdirSync(folder, { recursive: true });
    const patch = { filePath: 'a.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [] }] };
    writeFileSync(
      path.join(folder, 'chat-1.jsonl'),
      [
        { type: 'user', message: answer('toolu_1'), toolUseResult: patch },
        { type: 'user', message: answer('toolu_2'), toolUseResult: { stdout: 'ok' } },
        {
          type: 'user',
          message: answer('toolu_3'),
          toolUseResult: { cell_type: 'code', new_source: 'x' },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\nnot json',
    );
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('reads them from the subagents’ runs too', async () => {
    const runs = path.join(home, 'projects', 'C--work', 'chat-1', 'subagents');
    mkdirSync(runs, { recursive: true });
    const patch = { structuredPatch: [{ oldStart: 2, newStart: 2, lines: ['+x'] }] };
    writeFileSync(
      path.join(runs, 'agent-a1.jsonl'),
      JSON.stringify({ type: 'user', message: answer('toolu_s1'), toolUseResult: patch }),
    );
    writeFileSync(path.join(runs, 'agent-a1.meta.json'), '{}');
    expect([...(await savedFileResults('chat-1', home)).keys()]).toEqual([
      'toolu_1',
      'toolu_3',
      'toolu_s1',
    ]);
  });

  it('reads the file tools’ results, by tool call, and nothing else', async () => {
    const results = await savedFileResults('chat-1', home);
    expect([...results.keys()]).toEqual(['toolu_1', 'toolu_3']);
    expect(results.get('toolu_1')).toMatchObject({ filePath: 'a.ts' });
  });

  it('reads what each reply was made under, by its API message ID, the subagents’ runs too', async () => {
    const reply = (id: string, attribution: object) =>
      JSON.stringify({ type: 'assistant', message: { id, content: [] }, ...attribution });
    const folder = path.join(home, 'projects', 'C--work');
    writeFileSync(
      path.join(folder, 'chat-1.jsonl'),
      [reply('msg_1', { attributionSkill: 'commit' }), reply('msg_2', {})].join('\n'),
    );
    const runs = path.join(folder, 'chat-1', 'subagents');
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      path.join(runs, 'agent-a1.jsonl'),
      reply('msg_s1', { attributionAgent: 'Explore', attributionSkill: 'commit' }),
    );
    const { attributions } = await savedExtras('chat-1', home);
    expect([...attributions]).toEqual([
      ['msg_1', { attributionSkill: 'commit' }],
      ['msg_s1', { attributionSkill: 'commit', attributionAgent: 'Explore' }],
    ]);

    const saved: ClaudeMessage = { type: 'assistant', message: { id: 'msg_1' } };
    expect(withSavedAttribution(saved, attributions).attributionSkill).toBe('commit');
    const other: ClaudeMessage = { type: 'assistant', message: { id: 'msg_2' } };
    expect(withSavedAttribution(other, attributions)).toBe(other);
  });

  it('has none for a chat it can’t find', async () => {
    expect((await savedFileResults('chat-9', home)).size).toBe(0);
  });

  it('gives a saved message the result of the call it answers', () => {
    const results = new Map([['toolu_1', { filePath: 'a.ts' }]]);
    const message: ClaudeMessage = { type: 'user', message: answer('toolu_1') };
    expect(withSavedResult(message, results).tool_use_result).toEqual({ filePath: 'a.ts' });
    const other = { type: 'user', message: answer('toolu_2') };
    expect(withSavedResult(other, results)).toBe(other);
    const reply = { type: 'assistant', message: answer('toolu_1') };
    expect(withSavedResult(reply, results)).toBe(reply);
  });
});
