import type { AgentEntry, Entry, ToolBlock } from '@grimoire/contract';
import { toRows } from './rows';

const you = (id: string, text: string): Entry => ({ kind: 'user', id, text });
const agent = (id: string, ...blocks: AgentEntry['blocks']): Entry => ({
  kind: 'agent',
  id,
  blocks,
});
const text = (value: string) => ({ kind: 'text' as const, text: value });
const tool = (tool: string, input: unknown, result?: ToolBlock['result']): ToolBlock => ({
  kind: 'tool',
  id: `${tool}-id`,
  tool,
  input,
  ...(result ? { result } : {}),
});

describe('toRows', () => {
  it('sets the tools in the margin beside the reply that follows them', () => {
    const rows = toRows([
      you('u1', 'Why does login fail?'),
      agent('a1', tool('Read', { file_path: '/repo/src/login.ts' }, { text: '', isError: false })),
      agent('a2', tool('Bash', { command: 'npm test' })),
      agent('a3', text('The timer races.')),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['you', 'reply']);
    const reply = rows[1]!;
    if (reply.kind !== 'reply') throw new Error('expected a reply');
    expect(
      reply.notes.map(({ mark, verb, target, running }) => ({ mark, verb, target, running })),
    ).toEqual([
      { mark: '*', verb: 'Read', target: '/repo/src/login.ts', running: false },
      { mark: '†', verb: 'Ran', target: 'npm test', running: true },
    ]);
  });

  it('writes paths in the chapter folder relative to it', () => {
    const rows = toRows(
      [
        agent(
          'a1',
          tool('Edit', { file_path: 'C:\\Work\\Repo\\src\\a.ts' }),
          tool('Read', { file_path: 'D:/other/b.ts' }),
        ),
      ],
      'c:/work/repo',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'notes',
        notes: [
          expect.objectContaining({ verb: 'Edited', target: 'src/a.ts' }),
          expect.objectContaining({ verb: 'Read', target: 'D:/other/b.ts' }),
        ],
      }),
    ]);
  });

  it('puts the byline on the first reply of a turn and restarts the marks', () => {
    const rows = toRows([
      you('u1', 'One'),
      agent('a1', tool('Glob', { pattern: '*.ts' }), text('First'), text('Second')),
      you('u2', 'Two'),
      agent(
        'a2',
        tool('Grep', { pattern: 'login' }, { text: 'nope', isError: true }),
        text('Third'),
      ),
    ]);
    const replies = rows.filter((row) => row.kind === 'reply');
    expect(replies.map((row) => [row.text, row.byline])).toEqual([
      ['First', true],
      ['Second', false],
      ['Third', true],
    ]);
    expect(replies[2]!.notes).toEqual([
      expect.objectContaining({ mark: '*', verb: 'Searched', failed: true }),
    ]);
  });

  it('keeps thinking as its own row and doubles the marks after six notes', () => {
    const tools = Array.from({ length: 7 }, () => tool('WebFetch', { url: 'https://example.com' }));
    const rows = toRows([agent('a1', { kind: 'thinking', text: 'Hmm' }, ...tools)]);
    expect(rows[0]).toEqual({ kind: 'thinking', key: 'a1/0', text: 'Hmm' });
    const notes = rows[1]!.kind === 'notes' ? rows[1]!.notes : [];
    expect(notes.map((note) => note.mark)).toEqual(['*', '†', '‡', '§', '‖', '¶', '**']);
  });
});
