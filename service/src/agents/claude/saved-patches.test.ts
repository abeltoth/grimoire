import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClaudeMessage } from './messages';
import { savedFileResults, withSavedResult } from './saved-patches';

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

  it('reads the file tools’ results, by tool call, and nothing else', async () => {
    const results = await savedFileResults('chat-1', home);
    expect([...results.keys()]).toEqual(['toolu_1', 'toolu_3']);
    expect(results.get('toolu_1')).toMatchObject({ filePath: 'a.ts' });
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
