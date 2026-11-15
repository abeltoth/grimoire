import { describe, expect, it } from 'vitest';
import { hunksOf } from './file-patch';
import { ClaudeTranscript } from './transcript';

describe('hunksOf', () => {
  it('reads the patch an edit or a write over a file reports', () => {
    expect(
      hunksOf({
        filePath: '/r/a.ts',
        structuredPatch: [
          { oldStart: 12, oldLines: 2, newStart: 12, newLines: 2, lines: [' a', '-b', '+c'] },
          { oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ['-d', '+e'] },
        ],
      }),
    ).toEqual([
      { oldStart: 12, newStart: 12, lines: [' a', '-b', '+c'] },
      { oldStart: 40, newStart: 40, lines: ['-d', '+e'] },
    ]);
  });

  it('has none for a new file, an empty patch or another tool’s result', () => {
    expect(hunksOf({ type: 'create', content: 'x', structuredPatch: [] })).toBeUndefined();
    expect(hunksOf({ structuredPatch: [{ oldStart: 'x' }] })).toBeUndefined();
    expect(hunksOf({ stdout: 'ok' })).toBeUndefined();
    expect(hunksOf('Updated.')).toBeUndefined();
    expect(hunksOf(undefined)).toBeUndefined();
  });

  it('sets a notebook cell’s old source against its new, its unchanged ends kept', () => {
    expect(
      hunksOf({
        cell_type: 'code',
        old_source: 'import a\nx = 1\nprint(x)',
        new_source: 'import a\nx = 2\ny = 3\nprint(x)',
      }),
    ).toEqual([
      {
        oldStart: 1,
        newStart: 1,
        lines: [' import a', '-x = 1', '+x = 2', '+y = 3', ' print(x)'],
      },
    ]);
    expect(hunksOf({ cell_type: 'code', new_source: 'a' })).toEqual([
      { oldStart: 1, newStart: 1, lines: ['+a'] },
    ]);
    expect(hunksOf({ cell_type: 'code', old_source: 'a', new_source: 'a' })).toBeUndefined();
  });
});

describe('a file tool’s result in the transcript', () => {
  it('carries what the tool changed, from the structured result beside it', () => {
    const transcript = new ClaudeTranscript(false);
    transcript.apply({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'a.ts' } }],
      },
    });
    transcript.apply({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Updated.' }] },
      tool_use_result: { structuredPatch: [{ oldStart: 3, newStart: 3, lines: ['-a', '+b'] }] },
    });
    const [entry] = transcript.entries;
    expect(entry?.kind === 'agent' && entry.blocks[0]).toMatchObject({
      result: {
        text: 'Updated.',
        isError: false,
        hunks: [{ oldStart: 3, newStart: 3, lines: ['-a', '+b'] }],
      },
    });
  });
});
