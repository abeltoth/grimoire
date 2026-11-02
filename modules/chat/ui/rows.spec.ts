import type { AgentEntry, Entry, ToolBlock } from '@grimoire/contract';
import { type Note, summarize, toRows } from './rows';

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

  it('folds out a change as corrections and anything else as its output', () => {
    const edit = tool(
      'Write',
      { file_path: '/repo/a.ts', content: 'one\ntwo\n' },
      { text: 'Written.', isError: false },
    );
    const failedEdit = tool(
      'Edit',
      { file_path: '/repo/b.ts', old_string: 'x', new_string: 'y' },
      { text: 'String not found.', isError: true },
    );
    const rows = toRows(
      [
        agent(
          'a1',
          edit,
          failedEdit,
          tool('Glob', { pattern: '*.ts' }, { text: 'a.ts\nb.ts', isError: false }),
          tool('Read', { file_path: '/repo/c.ts' }, { text: '', isError: false }),
          tool('Bash', { command: 'npm test' }),
        ),
      ],
      '/repo',
    );
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes.map(({ counts, fold }) => ({ counts, fold }))).toEqual([
      {
        counts: '+2 −0',
        fold: {
          kind: 'corrections',
          file: 'a.ts',
          lines: [
            { kind: 'inserted', text: 'one' },
            { kind: 'inserted', text: 'two' },
          ],
        },
      },
      { counts: undefined, fold: { kind: 'output', title: 'b.ts', text: 'String not found.' } },
      { counts: undefined, fold: { kind: 'output', title: '*.ts', text: 'a.ts\nb.ts' } },
      { counts: undefined, fold: undefined },
      { counts: undefined, fold: undefined },
    ]);
  });

  it('shows a file by its name and anything else in full', () => {
    const rows = toRows(
      [agent('a1', tool('Edit', { file_path: '/repo/src/app/a.ts' }), tool('Bash', { command: 'npm test -- --watch=false' }))],
      '/repo',
    );
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes.map(({ target, label }) => ({ target, label }))).toEqual([
      { target: 'src/app/a.ts', label: 'a.ts' },
      { target: 'npm test -- --watch=false', label: 'npm test -- --watch=false' },
    ]);
  });

  it('sums up a run of notes, but not a note on its own', () => {
    const done = { text: 'ok', isError: false };
    const rows = toRows(
      [
        agent('a1', tool('Read', { file_path: '/repo/a.ts' }, done), text('One.')),
        agent(
          'a2',
          tool('Read', { file_path: '/repo/a.ts' }, done),
          tool('Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y\nz' }, done),
          tool('Read', { file_path: '/repo/b.ts' }, done),
          tool('Write', { file_path: '/repo/a.ts', content: 'w\n' }, done),
          tool('Bash', { command: 'npm test' }, { text: 'boom', isError: true }),
          tool('Grep', { pattern: 'x' }, done),
          tool('Grep', { pattern: 'y' }),
          text('Two.'),
        ),
      ],
      '/repo',
    );
    expect(rows[0]).not.toHaveProperty('summary');
    expect(rows[1]).toMatchObject({
      summary: {
        key: 'a2/0/all',
        text: 'Read 2 files, changed 1 file, ran 1 command, searched twice',
        counts: '+3 −1',
        running: true,
        failed: 1,
        withdrawn: false,
      },
    });
  });

  it('sums up a run whose changes were all undone as withdrawn', () => {
    const changed = (target: string): Note => ({
      key: target,
      mark: '*',
      verb: 'Edited',
      target,
      label: target,
      did: 'changed',
      running: false,
      failed: false,
      counts: '+1 −1',
      added: 1,
      removed: 1,
      withdrawn: true,
    });
    expect(summarize([changed('a.ts'), changed('b.ts')])).toEqual({
      key: 'a.ts/all',
      text: 'Changed 2 files',
      running: false,
      failed: 0,
      withdrawn: true,
    });
  });

  it('keeps thinking as its own row and doubles the marks after six notes', () => {
    const tools = Array.from({ length: 7 }, () => tool('WebFetch', { url: 'https://example.com' }));
    const rows = toRows([agent('a1', { kind: 'thinking', text: 'Hmm' }, ...tools)]);
    expect(rows[0]).toEqual({ kind: 'thinking', key: 'a1/0', text: 'Hmm' });
    const notes = rows[1]!.kind === 'notes' ? rows[1]!.notes : [];
    expect(notes.map((note) => note.mark)).toEqual(['*', '†', '‡', '§', '‖', '¶', '**']);
  });
});
