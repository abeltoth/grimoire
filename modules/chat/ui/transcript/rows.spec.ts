import type { AgentEntry, Entry, HookRun, ToolBlock } from '@grimoire/contract';
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
    expect(reply.notes.map(({ verb, target, running }) => ({ verb, target, running }))).toEqual([
      { verb: 'Read', target: '/repo/src/login.ts', running: false },
      { verb: 'Tested', target: 'npm test', running: true },
    ]);
  });

  it('writes paths in the chat folder relative to it', () => {
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

  it('puts the byline on the first reply of a turn', () => {
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
      expect.objectContaining({ verb: 'Searched', failed: true }),
    ]);
  });

  it('expands a change as a diff and anything else as its output', () => {
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
    expect(notes.map(({ counts, details }) => ({ counts, details }))).toEqual([
      {
        counts: '+2 −0',
        details: {
          kind: 'diff',
          file: 'a.ts',
          path: '/repo/a.ts',
          lines: [
            { kind: 'inserted', text: 'one' },
            { kind: 'inserted', text: 'two' },
          ],
        },
      },
      { counts: undefined, details: { kind: 'output', title: 'b.ts', text: 'String not found.' } },
      { counts: undefined, details: { kind: 'output', title: '*.ts', text: 'a.ts\nb.ts' } },
      { counts: undefined, details: undefined },
      {
        counts: undefined,
        details: { kind: 'output', title: 'npm test', text: '', running: true },
      },
    ]);
  });

  it('marks a tool waiting for your approval, and the run of notes it is in', () => {
    const rows = toRows(
      [
        agent(
          'a1',
          tool('Read', { file_path: '/a.ts' }, { text: '', isError: false }),
          tool('Bash', { command: 'git push' }),
        ),
      ],
      undefined,
      { waiting: new Set(['Bash-id']) },
    );
    const row = rows[0]!;
    if (row.kind !== 'notes') throw new Error('expected notes');
    expect(row.notes.map((note) => note.waiting)).toEqual([undefined, true]);
    expect(row.summary?.waiting).toBe(true);
  });

  it('opens a running tool to what it was asked, its output still to come', () => {
    const rows = toRows([
      agent('a1', tool('WebSearch', { query: 'signals', allowed_domains: ['angular.dev'] })),
    ]);
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes[0]!.details).toEqual({
      kind: 'output',
      title: 'signals',
      text: 'query: signals\nallowed_domains: ["angular.dev"]',
      running: true,
    });
  });

  it('expands a web search as the pages it found and its summary, or as it came when unread', () => {
    const found = [
      'Web search results for query: "signals"',
      '',
      'Links: [{"title":"Signals","url":"https://angular.dev/guide/signals"}]',
      '',
      'Signals hold state.',
    ].join('\n');
    const rows = toRows([
      agent(
        'a1',
        tool('WebSearch', { query: 'signals' }, { text: found, isError: false }),
        tool('WebSearch', { query: 'signals' }, { text: found, isError: true }),
        tool('WebSearch', { query: 'signals' }, { text: 'No results', isError: false }),
      ),
    ]);
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes.map(({ details }) => details)).toEqual([
      {
        kind: 'web',
        query: 'signals',
        sources: [{ title: 'Signals', url: 'https://angular.dev/guide/signals' }],
        summary: 'Signals hold state.',
      },
      { kind: 'output', title: 'signals', text: found },
      { kind: 'output', title: 'signals', text: 'No results' },
    ]);
  });

  it('shows a file by its name and anything else in full', () => {
    const rows = toRows(
      [
        agent(
          'a1',
          tool('Edit', { file_path: '/repo/src/app/a.ts' }),
          tool('Bash', { command: 'npm test -- --watch=false' }),
        ),
      ],
      '/repo',
    );
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes.map(({ target, label }) => ({ target, label }))).toEqual([
      { target: 'src/app/a.ts', label: 'a.ts' },
      { target: 'npm test -- --watch=false', label: 'npm test -- --watch=false' },
    ]);
  });

  it('shows a command by what it does, when the agent said, and heads its output so', () => {
    const ok = { text: 'ok', isError: false };
    const long = `cd /repo && ${'x'.repeat(80)}`;
    const rows = toRows([
      agent(
        'a1',
        {
          ...tool('Bash', { command: 'npm test -w ui', description: 'Run UI tests' }, ok),
          id: 'b1',
        },
        { ...tool('Bash', { command: 'ls' }, ok), id: 'b2' },
        { ...tool('Bash', { command: long }, ok), id: 'b3' },
      ),
    ]);
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(
      notes.map(({ target, label, described, details }) => ({ target, label, described, details })),
    ).toEqual([
      {
        target: 'npm test -w ui',
        label: 'Run UI tests',
        described: true,
        details: { kind: 'output', title: 'Run UI tests', text: 'ok', command: 'npm test -w ui' },
      },
      {
        target: 'ls',
        label: 'ls',
        described: undefined,
        details: { kind: 'output', title: 'ls', text: 'ok' },
      },
      {
        target: long,
        label: long,
        described: undefined,
        details: { kind: 'output', title: 'Command', text: 'ok', command: long },
      },
    ]);
  });

  it('merges changes in a row to one file, stacking their diffs', () => {
    const done = { text: 'Updated.', isError: false };
    const edit = (
      id: string,
      file: string,
      from: string,
      to: string,
      result?: ToolBlock['result'],
    ) => ({
      ...tool('Edit', { file_path: file, old_string: from, new_string: to }, result),
      id,
    });
    const rows = toRows(
      [
        agent(
          'a1',
          edit('e1', '/repo/a.ts', 'one', 'ONE', done),
          edit('e2', '/repo/a.ts', 'two', 'TWO\nTHREE', done),
          edit('e3', '/repo/a.ts', 'x', 'y', { text: 'String not found.', isError: true }),
          edit('e4', '/repo/a.ts', 'four', 'FOUR'),
          edit('e5', '/repo/b.ts', 'five', 'FIVE', done),
        ),
      ],
      '/repo',
    );
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(
      notes.map(({ label, times, counts, running, failed }) => ({
        label,
        times,
        counts,
        running,
        failed,
      })),
    ).toEqual([
      { label: 'a.ts', times: 2, counts: '+3 −2', running: false, failed: false },
      { label: 'a.ts', times: undefined, counts: undefined, running: false, failed: true },
      { label: 'a.ts', times: undefined, counts: '+1 −1', running: true, failed: false },
      { label: 'b.ts', times: undefined, counts: '+1 −1', running: false, failed: false },
    ]);
    expect(notes[0]!.details).toEqual({
      kind: 'diff',
      file: 'a.ts',
      path: '/repo/a.ts',
      lines: [
        { kind: 'removed', text: 'one' },
        { kind: 'inserted', text: 'ONE' },
        { kind: 'removed', text: 'two' },
        { kind: 'inserted', text: 'TWO' },
        { kind: 'inserted', text: 'THREE' },
      ],
      breaks: [2],
    });
    expect(rows[0]!.kind === 'notes' && rows[0]!.summary).toMatchObject({
      text: 'Changed 2 files',
      counts: '+5 −4',
    });
  });

  it('links a message that resumed a subagent to its run, but not one sent elsewhere', () => {
    const resumed = { text: '{"success":true,"resumedAgentId":"a819"}', isError: false };
    const sent = { text: '{"success":true,"message":"Sent"}', isError: false };
    const rows = toRows([
      agent(
        'a1',
        tool(
          'SendMessage',
          { to: 'a819', summary: 'Ask for more', message: 'More, please.' },
          resumed,
        ),
        { ...tool('SendMessage', { to: 'other', message: 'Hi' }, sent), id: 'other-id' },
      ),
    ]);
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(
      notes.map(({ verb, target, did, subagent }) => ({
        verb,
        target,
        did,
        subagent: subagent?.id,
      })),
    ).toEqual([
      {
        verb: 'Messaged a helper',
        target: 'Ask for more',
        did: 'helped',
        subagent: 'SendMessage-id',
      },
      { verb: 'SendMessage', target: '', did: 'other', subagent: undefined },
    ]);
  });

  it('notes a task the agent added to the Kanban board by its title, and sums them up', () => {
    const added = {
      text: 'Added "Context meter" to To do on the user\'s Kanban board.',
      isError: false,
    };
    const rows = toRows([
      agent(
        'a1',
        tool(
          'mcp__grimoire__add_todo',
          { title: ' Context meter ', notes: 'From the usage events.' },
          added,
        ),
        { ...tool('mcp__grimoire__add_todo', { title: 'Ribbon tests' }), id: 'second-id' },
      ),
    ]);
    const notes = rows[0]!.kind === 'notes' ? rows[0]!.notes : [];
    expect(notes.map(({ verb, label, did, running }) => ({ verb, label, did, running }))).toEqual([
      { verb: 'Added to the board', label: 'Context meter', did: 'added', running: false },
      { verb: 'Added to the board', label: 'Ribbon tests', did: 'added', running: true },
    ]);
    expect(rows[0]).toMatchObject({ summary: { text: 'Added 2 tasks to the board' } });
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
        text: 'Read 2 files, changed 1 file, ran the tests once, searched twice',
        counts: '+3 −1',
        running: true,
        failed: 1,
        withdrawn: false,
      },
    });
  });

  it('keeps thinking as its own row', () => {
    const tools = Array.from({ length: 7 }, () => tool('WebFetch', { url: 'https://example.com' }));
    const rows = toRows([agent('a1', { kind: 'thinking', text: 'Hmm' }, ...tools)]);
    expect(rows[0]).toEqual({ kind: 'thinking', key: 'a1/0', text: 'Hmm' });
    const notes = rows[1]!.kind === 'notes' ? rows[1]!.notes : [];
    expect(notes).toHaveLength(7);
  });

  it("counts a turn's hooks on its closing line as they run, and what it spent once it ended", () => {
    const run = (id: string, outcome: HookRun['outcome']): HookRun => ({
      id,
      name: 'Stop',
      event: 'Stop',
      outcome,
    });
    const uses = [
      {
        model: 'claude-opus-5-5',
        input: 1,
        cacheWritten: 0,
        cacheWrittenLong: 0,
        cacheRead: 0,
        output: 1,
      },
    ];
    const running: Entry = {
      kind: 'user',
      id: 'u1',
      text: 'Go',
      tokens: { at: 1, uses },
      hooks: [run('h1', 'passed'), run('h2', 'blocked'), run('h3', 'running')],
    };
    const rows = toRows([running, agent('a1', text('Working'))]);
    expect(rows.map((row) => row.kind)).toEqual(['you', 'reply', 'spent']);
    expect(rows[2]).toEqual({
      kind: 'spent',
      key: 'u1/spent',
      hooks: { key: 'u1/hooks', runs: running.hooks, running: 1, blocked: 1, failed: 0 },
    });

    const ended = toRows([{ ...running, took: 5 }, agent('a1', text('Done'))]).at(-1)!;
    expect(
      ended.kind === 'spent' && [ended.took, ended.tokens?.uses, ended.hooks?.runs.length],
    ).toEqual([5, uses, 3]);
    expect(toRows([you('u2', 'Hi')]).map((row) => row.kind)).toEqual(['you']);
  });

  it('shows a compaction on a line of its own, between the replies around it', () => {
    const rows = toRows([
      you('u1', '/compact'),
      { kind: 'compaction', id: 'c1', trigger: 'manual', before: 92_000 },
      agent('a1', text('Done.')),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['you', 'compaction', 'reply']);
    expect(rows[1]).toEqual({ kind: 'compaction', key: 'c1', trigger: 'manual', before: 92_000 });
  });
});
