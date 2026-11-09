import type {
  AgentSetup,
  CommandName,
  CommandRequest,
  GrimoireBridge,
  GrimoireSettings,
  OpenChat,
  Preset,
  TokenUse,
} from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { Diagrams } from './markdown/diagrams';
import { fakeBridge, pick, picture, render, withFiles, write } from '@ui/testing/app-harness';

describe('chat', () => {
  it('opens on a blank chapter', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high effort',
      'Ask first',
      '~',
      'No preset',
    ]);
    expect(texts('.spine gr-ribbon b')).toEqual(['Untitled chapter']);
    expect(texts('.spine gr-ribbon i')).toEqual(['Claude Code · blank page']);
    expect(texts('.right-half gr-ribbon b')).toEqual(['New chapter']);
    expect(texts('gr-chapter-opening p')).toEqual([
      'A new chapter',
      expect.stringMatching(/^Begun at .+, to be written by Claude Code$/),
      'Write your first entry on the page below. Claude Code works in your home folder and asks before it edits a file or runs a command.',
    ]);
    expect(document.querySelector('#gr-next-entry')!.getAttribute('placeholder')).toBe(
      'Write the first entry…',
    );
    expect(texts('gr-transcript')).toEqual([]);
  });

  it('times the running turn by Stop, and shows how long each turn took once it ended', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = { kind: 'user' as const, id: 'u1', text: 'Fix the flaky login test' };
    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 134_000 } });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual(['Stop Esc 2m 14s']);
    expect(texts('.spent-line .took')).toEqual([]);

    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: Date.now() - 200_000, took: 200_000 } });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('.spent-line .took')).toEqual(['3m 20s']);
    expect(el.querySelector('.spent-line .took')!.getAttribute('title')).toBe('This turn took 3m 20s');
  });

  it("shows what each turn spent at its end, the chapter's costliest three in rubric", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'u1');
    const use = (input: number, output = 0) => ({
      model: 'claude-opus-5-5',
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output,
    });
    const turn = (id: string, ...uses: TokenUse[]) => ({
      chatId: 'chat-1',
      entry: { kind: 'user' as const, id, text: id, at: 1, took: 1, tokens: { at: 1, uses } },
    });
    emit('agents.entry', turn('u1', use(500, 100), { ...use(2_000), model: 'claude-haiku-4-5', subagent: true }));
    await fixture.whenStable();
    expect(texts('.spent-line .spent')).toEqual(['3K tokens']);
    // One turn alone isn't marked the costliest.
    expect(el.querySelector('.spent-line .spent.costly')).toBeNull();
    expect(el.querySelector('.spent-line .spent')!.getAttribute('title')).toBe(
      'This turn: 3K tokens, weighed as the API prices them\n' +
        'Opus 5.5: 500 fresh input, 100 output\n' +
        'Subagents on Haiku 4.5: 2K fresh input',
    );

    emit('agents.entry', turn('u2', use(500)));
    emit('agents.entry', turn('u3', use(4_000)));
    emit('agents.entry', turn('u4', use(100)));
    emit('agents.entry', turn('u5', use(2_000)));
    await fixture.whenStable();
    expect(texts('.spent-line .spent')).toEqual(['3K tokens', '500 tokens', '4K tokens', '100 tokens', '2K tokens']);
    expect(texts('.spent-line .spent.costly')).toEqual(['3K tokens', '4K tokens', '2K tokens']);
    expect(el.querySelector('.spent-line .spent.costly')!.getAttribute('title')).toMatch(
      /^One of the costliest turns in this chapter: 3K tokens/,
    );
  });

  it("counts each turn's hooks on its closing line, folding out to each, what it printed and how it went", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = { kind: 'user' as const, id: 'u1', text: 'Fix the flaky login test', at: Date.now() };
    const lint = { id: 'h1', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit' };
    const guard = { id: 'h2', name: 'PreToolUse:PowerShell', event: 'PreToolUse', tool: 'PowerShell' };
    const stop = { id: 'h3', name: 'Stop', event: 'Stop' };
    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, hooks: [{ ...lint, outcome: 'running' }] } });
    await fixture.whenStable();
    expect(texts('.spent-line .hooks')).toEqual(['1 hook · 1 running…']);
    // Stop stays where the turn writes, apart from its closing line.
    expect(texts('.stop')).toHaveLength(1);

    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        ...user,
        took: 3_000,
        hooks: [
          { ...lint, outcome: 'passed', output: 'Lint ok', took: 420 },
          { ...guard, outcome: 'blocked', output: 'No rm -rf here', took: 1_500 },
          { ...stop, outcome: 'passed', took: 12 },
        ],
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('.spent-line .hooks')).toEqual(['3 hooks ran · 1 barred the way']);
    expect(texts('.spent-line .hooks .failed')).toEqual(['· 1 barred the way']);
    expect(texts('.hook .note')).toEqual([]);

    el.querySelector<HTMLButtonElement>('.spent-line .hooks')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.spent-line .hooks')!.getAttribute('aria-expanded')).toBe('true');
    // One that passed and printed nothing is listed too.
    const parts = [...el.querySelectorAll('.hook .note')].map((line) =>
      [...line.children].map((part) => part.textContent!.trim()),
    );
    expect(parts).toEqual([
      ['After an edit', 'Edit', 'passed', '420ms'],
      ['Before a command', 'PowerShell', 'barred the way', '1s'],
      ['As the turn ended', 'passed', '12ms'],
    ]);
    expect(texts('.hook .note .failed')).toEqual(['barred the way']);
    const lines = [...el.querySelectorAll<HTMLButtonElement>('.hook .note')];
    expect(lines.map((line) => line.getAttribute('aria-disabled'))).toEqual([null, null, 'true']);

    lines[1]!.click();
    await fixture.whenStable();
    expect(el.querySelector('.hook gr-output')!.getAttribute('aria-label')).toBe('Output of PreToolUse:PowerShell');
    expect(texts('.hook gr-output .code')).toEqual(['No rm -rf here']);
  });

  it('starts the chat with the first entry and follows its events', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);

    await write(fixture, el, 'Fix the flaky login test');
    expect(calls.find((c) => c.command === 'agents.start')!.request).toEqual({
      agent: 'claude-code',
      settings: {},
      text: 'Fix the flaky login test',
    });
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('');
    expect(texts('.you p')).toEqual(['Fix the flaky login test']);
    expect(texts('.meta button')[4]).toBe('C:/work/grimoire');
    expect(texts('.stop')).toEqual(['Stop Esc']);

    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Read',
            input: { file_path: 'C:\\work\\grimoire\\src\\login.spec.ts' },
          },
        ],
      },
    });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { kind: 'agent', id: 'a2', blocks: [{ kind: 'text', text: 'The test ' }] },
    });
    emit('agents.text', { chatId: 'chat-1', entryId: 'a2', block: 0, text: 'races the timer.' });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    emit('agents.title', { chatId: 'chat-1', title: 'Fix flaky login test' });
    await fixture.whenStable();

    expect(texts('.reply .who')).toEqual(['Claude Code']);
    expect(texts('.reply gr-markdown p')).toEqual(['The test races the timer. Stop Esc']);
    expect(texts('.note .note-head')).toEqual(['Read']);
    expect(texts('.note .target')).toEqual(['login.spec.ts']);
    expect(el.querySelector('.note')!.getAttribute('title')).toBe('src/login.spec.ts');
    expect(texts('.note .detail')).toEqual(['running…']);
    expect(el.querySelector('.reply gr-markdown p .quill')).not.toBeNull();
    expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    // A title too long for its line is cut short; pointing at it shows it all.
    expect(el.querySelector('gr-running-head h1')!.getAttribute('title')).toBe('Fix flaky login test');
    expect(texts('[aria-current="page"] b')).toEqual(['Fix flaky login test']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · writing']);

    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    emit('agents.turnEnded', { chatId: 'chat-1', error: 'The agent stopped unexpectedly.' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('[role="alert"]')).toEqual(['The agent stopped unexpectedly.']);
  });

  it('sends later entries to the running chat, and Esc stops it', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    await write(fixture, el, 'Second');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: 'Second' },
    ]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.filter((c) => c.command === 'agents.interrupt').map((c) => c.request)).toEqual([
      { chatId: 'chat-1' },
    ]);
  });

  it('shows entries queued during a turn; Edit and Remove take them out', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.queued', {
      chatId: 'chat-1',
      queued: [
        { id: 'q1', text: 'Also add a tooltip.' },
        { id: 'q2', text: 'And a test.' },
      ],
    });
    await fixture.whenStable();
    expect(texts('.queued-text')).toEqual(['Also add a tooltip.', 'And a test.']);
    expect(texts('.queued-when')).toEqual([
      'sends when this turn ends',
      'sends when this turn ends',
    ]);

    const buttons = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.queued button')].filter(
        (b) => b.textContent!.trim() === label,
      );
    buttons('Edit')[0]!.click();
    buttons('Remove')[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.unqueue').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', id: 'q1' },
      { chatId: 'chat-1', id: 'q2' },
    ]);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    expect(entry.value).toBe('Also add a tooltip.');
    expect(document.activeElement).toBe(entry);
  });

  it('shows how much of the page allowance the chapter uses', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(el.querySelector('.allowance')).toBeNull();
    await write(fixture, el, 'Add the meter');
    emit('agents.context', { chatId: 'chat-1', context: { used: 124_000, limit: 200_000 } });
    await fixture.whenStable();
    expect(texts('.allowance > *')).toEqual(['', '62%', 'of the chapter’s page allowance']);
    expect(el.querySelector('.allowance')!.getAttribute('aria-valuenow')).toBe('62');
    expect(el.querySelector<HTMLElement>('.allowance .used')!.style.width).toBe('62%');
  });

  it('puts the queued entries back on the page when you stop the turn', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.interrupt'] = () => [{ id: 'q1', text: 'Also add a tooltip.' }];
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = 'Half a thought';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(entry.value).toBe('Half a thought\n\nAlso add a tooltip.');
  });

  it('sets replies as markdown and numbers listings through the chapter', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          { kind: 'text', text: 'The meter reads `usage`:\n\n- shows a share\n- warns at **80%**' },
        ],
      },
    });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a2',
        blocks: [
          {
            kind: 'text',
            text: "```ts\nconst used = 1;\n```\n\nAnd the spec:\n\n```ts\nit('shows",
          },
        ],
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    await fixture.whenStable();

    expect(texts('.reply gr-markdown > p')).toEqual(['The meter reads usage:', 'And the spec:']);
    expect(texts('.reply gr-markdown code')).toEqual(['usage']);
    expect(texts('.reply gr-markdown li')).toEqual(['shows a share', 'warns at 80%']);
    expect(texts('.reply gr-markdown li strong')).toEqual(['80%']);
    expect(texts('gr-listing figcaption')).toEqual(['Listing 1 · ts', 'Listing 2 · ts']);
    expect(texts('gr-listing .line')).toEqual(['const used = 1;', "it('shows Stop Esc"]);
    // The listing still being written stays open, with the quill on its last line.
    const listings = el.querySelectorAll('gr-listing .code');
    expect([...listings].map((l) => l.classList.contains('open'))).toEqual([false, true]);
    expect(el.querySelector('gr-listing:last-of-type .line .quill')).not.toBeNull();
  });

  it('draws a Mermaid listing as its diagram once it is written out', async () => {
    const { bridge, emit } = fakeBridge();
    // Mermaid can't lay out in jsdom: a fake draws every diagram the same.
    const diagrams = {
      draw: async () => ({ svg: '<svg class="drawn"></svg>', id: 'gr-diagram-1' }),
    };
    const { fixture, el, texts } = await render(bridge, [
      { provide: Diagrams, useValue: diagrams },
    ]);
    await write(fixture, el, 'Draw the flow');
    const reply = (text: string) =>
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [{ kind: 'text', text }] },
      });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    reply('```mermaid\ngraph TD\n  A -->');
    await fixture.whenStable();
    expect(texts('gr-listing figcaption')).toEqual(['Listing 1 · mermaid']);
    expect(el.querySelector('gr-diagram')).toBeNull();

    reply('```mermaid\ngraph TD\n  A --> B\n```');
    await fixture.whenStable();
    expect(texts('gr-diagram figcaption')).toEqual(['Listing 1 · mermaid Source']);
    expect(el.querySelector('gr-diagram .diagram svg.drawn')).not.toBeNull();
    expect(el.querySelector('gr-listing')).toBeNull();
  });

  it('sums up a run of margin notes, and folds them out to the corrections or the output', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Edit',
            input: {
              file_path: 'C:/work/grimoire/src/meter.ts',
              old_string: 'const a = 1;',
              new_string: 'const used = 1;\nconst limit = 2;',
            },
            result: { text: 'Updated.', isError: false },
          },
          {
            kind: 'tool',
            id: 't2',
            tool: 'Bash',
            input: { command: 'npm test' },
            result: { text: '\u001b[32m12 passed\u001b[0m\n1 failed\n', isError: true },
          },
          { kind: 'text', text: 'One test fails.' },
        ],
      },
    });
    await fixture.whenStable();

    expect(texts('.note.summary > *')).toEqual(['Changed 1 file, ran the tests once', '+2 −1', '1 failed']);
    const run = el.querySelector<HTMLButtonElement>('.note.summary')!;
    expect(run.getAttribute('aria-expanded')).toBe('false');

    run.click();
    await fixture.whenStable();
    expect(run.getAttribute('aria-expanded')).toBe('true');
    expect(texts('.run .note > *')).toEqual(['Edited', 'meter.ts', '+2 −1', 'Tested', 'npm test', 'failed']);
    expect(el.querySelector('gr-corrections, gr-output')).toBeNull();

    const notes = el.querySelectorAll<HTMLButtonElement>('.run .note');
    notes[0]!.click();
    await fixture.whenStable();
    expect(notes[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-corrections .head b')).toEqual(['src/meter.ts']);
    expect(texts('gr-corrections .head .detail')[0]).toBe('corrections, as marked by Claude Code');

    // Opening another note closes the one you had open.
    notes[1]!.click();
    await fixture.whenStable();
    expect(notes[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('gr-corrections')).toBeNull();
    expect(texts('gr-output .head > *')).toEqual(['npm test', 'output']);
    expect(texts('gr-output .line')).toEqual(['12 passed', '1 failed']);

    notes[1]!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-output')).toBeNull();
  });

  it('turns the facing page to what a helper did, from its note, and keeps it current as it works', async () => {
    const { bridge, emit, answers, calls } = fakeBridge();
    answers['agents.helper'] = () => ({
      entries: [
        {
          kind: 'agent',
          id: 'h1',
          model: 'claude-haiku-4-5',
          blocks: [
            { kind: 'tool', id: 'ht1', tool: 'Grep', input: { pattern: 'meter' }, result: { text: 'meter.ts', isError: false } },
            { kind: 'text', text: 'Found the meter.' },
          ],
        },
      ],
      state: 'working',
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    const helperCall = {
      kind: 'tool' as const,
      id: 't1',
      tool: 'Agent',
      input: {
        description: 'Find the meter',
        prompt: 'Look for the context meter.',
        subagent_type: 'Explore',
        model: 'sonnet',
        run_in_background: true,
      },
    };
    emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [helperCall] } });
    await fixture.whenStable();

    const note = [...el.querySelectorAll<HTMLButtonElement>('gr-chapter-page .note')].find((n) =>
      n.textContent!.includes('Asked a helper'),
    )!;
    note.click();
    await fixture.whenStable();
    expect(calls.at(-1)).toEqual({ command: 'agents.helper', request: { chatId: 'chat-1', toolId: 't1' } });
    expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Find the meter']);
    expect(texts('gr-helper-page .title')).toEqual(['Find the meter']);
    expect(texts('gr-helper-page .meta')).toEqual(['Explore · Haiku 4.5 · Working…']);
    // Its task opens the page, signed by the agent that asked.
    expect(texts('gr-helper-page gr-transcript .you .who')).toEqual(['Claude Code']);
    expect(texts('gr-helper-page gr-transcript .you .text')).toEqual(['Look for the context meter.']);
    expect(el.querySelector('gr-helper-page gr-transcript .row')!.querySelector('.you')).not.toBeNull();
    expect(texts('gr-helper-page gr-transcript .reply .who')).toEqual(['Helper']);
    expect(texts('gr-helper-page gr-transcript .note > *')).toEqual(['Searched', 'meter']);
    expect(el.querySelector('gr-helper-page gr-transcript .stop')).toBeNull();
    expect([...el.querySelectorAll('gr-helper-page gr-transcript .you .gr-link')]).toEqual([]);
    expect(el.querySelector('gr-helper-page gr-composer')).toBeNull();
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Working…']);

    // A background helper's tool call has its result at once; the helper is still at work.
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [{ ...helperCall, result: { text: 'Async agent launched successfully.', isError: false } }],
      },
    });
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [{ kind: 'tool', id: 'ht2', tool: 'Bash', input: { command: 'npm test' } }],
      },
    });
    await fixture.whenStable();
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Working…']);
    expect(el.querySelector('gr-helper-page .line.waiting')).toBeNull();

    // It asks for your OK in the chapter, where you give it.
    emit('agents.approval', {
      approval: { id: 'ht2', chatId: 'chat-1', tool: 'Bash', input: { command: 'npm test' } },
    });
    await fixture.whenStable();
    expect(texts('gr-helper-page .line.waiting')).toEqual(['Awaiting your seal in the chapter']);
    expect(el.querySelector('gr-helper-page gr-approval-slip')).toBeNull();
    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ht2' });
    await fixture.whenStable();
    expect(el.querySelector('gr-helper-page .line.waiting')).toBeNull();

    // It hands its report back, which reads as its last reply.
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [
          { kind: 'tool', id: 'ht2', tool: 'Bash', input: { command: 'npm test' }, result: { text: 'ok', isError: false } },
        ],
      },
    });
    emit('agents.helperEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h3',
        blocks: [
          { kind: 'text', text: 'Handing it back.' },
          { kind: 'tool', id: 'ht3', tool: 'SubagentHandback', input: { message: 'It is in **meter.ts**.' } },
        ],
      },
    });
    emit('agents.helperState', { chatId: 'chat-1', toolId: 't1', state: 'done' });
    await fixture.whenStable();
    expect(texts('gr-helper-page gr-transcript .reply gr-markdown')).toEqual([
      'Found the meter.',
      'Handing it back.',
      'It is in meter.ts.',
    ]);
    expect(texts('gr-helper-page gr-transcript .note > *')).toEqual(['Searched', 'meter', 'Tested', 'npm test']);
    expect(texts('gr-helper-page gr-running-foot')).toEqual(['Done']);
    expect(texts('gr-helper-page .meta')).toEqual(['Explore · Haiku 4.5 · Done']);
  });

  it('names the model a helper was asked to work on until it says which it works on', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.helper'] = () => ({ entries: [] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [{ kind: 'tool', id: 't1', tool: 'Agent', input: { description: 'Look', prompt: 'Look.', model: 'sonnet' } }],
      },
    });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-chapter-page .note')]
      .find((n) => n.textContent!.includes('Asked a helper'))!
      .click();
    await fixture.whenStable();
    expect(texts('gr-helper-page .meta')).toEqual(['sonnet · Working…']);
    expect(texts('gr-helper-page .line')).toEqual(['The helper has only just begun.']);
  });

  it('says why a chapter could not start', async () => {
    const { bridge } = fakeBridge();
    const answer = bridge.invoke;
    bridge.invoke = ((command: CommandName, request: never) =>
      command === 'agents.start'
        ? Promise.reject(new Error('Claude Code is not signed in'))
        : answer(command, request)) as GrimoireBridge['invoke'];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    expect(texts('[role="alert"]')).toEqual(['Claude Code is not signed in']);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
  });

  it('keeps Shift+Enter for a new line', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = 'Line one';
    entry.dispatchEvent(new Event('input'));
    entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    await fixture.whenStable();
    expect(calls.some((c) => c.command === 'agents.start')).toBe(false);
  });

  it('keeps what you wrote on a chapter, unsent, while you turn to another', async () => {
    const { bridge, calls } = fakeBridge({
      chooseFiles: vi.fn(async () => ['C:/work/grimoire/notes.txt']),
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const entry = () => el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry().value = 'Half a thought';
    entry().dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[aria-label="Attach files or a screenshot"]')!.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-ribbon.new button')!.click();
    await fixture.whenStable();
    expect(entry().value).toBe('');
    expect(el.querySelector('gr-composer gr-enclosures')).toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')][0]!.click();
    await fixture.whenStable();
    expect(entry().value).toBe('Half a thought');
    expect(texts('gr-composer .ref code')).toEqual(['notes.txt']);
    expect(calls.filter((c) => c.command === 'agents.send')).toEqual([]);
  });

  it('changes a blank chapter\'s settings on its settings card', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const model = el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model.click();
    await fixture.whenStable();

    expect(model.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Model for Claude Code']);
    expect(texts('gr-settings-card [aria-checked="true"]')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high',
      '~',
      'Ask first Asks before edits and commands',
      'No preset',
    ]);
    expect(texts('gr-settings-card [data-setting="folder"] code')).toEqual([
      '~',
      '~/git/grimoire',
      '~/git/breeder',
    ]);
    expect(document.activeElement?.textContent?.trim()).toBe('Opus 5.5');

    pick(el, 'Sonnet 5.5');
    await fixture.whenStable();
    // Sonnet takes no Extra high, and your settings give it no effort.
    expect(texts('gr-settings-card [data-setting="effort"] h3')).toEqual(['Effort for Sonnet 5.5']);
    expect(texts('gr-settings-card [data-setting="effort"] .choice')).toEqual(['Low', 'Medium', 'High', 'Max']);
    expect(texts('.meta button')[2]).toBe('Default effort');
    pick(el, 'Max');
    pick(el, 'Full access');
    pick(el, 'Choose another folder');
    await fixture.whenStable();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Max effort',
      'Full access',
      '~/git/new',
      'No preset',
    ]);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: {
        agent: 'claude-code',
        settings: { model: 'sonnet', effort: 'max', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
      },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
    expect(document.activeElement).toBe(model);

    await write(fixture, el, 'Hello');
    expect(calls.find((c) => c.command === 'agents.start')?.request).toMatchObject({
      settings: { model: 'sonnet', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
    });
  });

  it('begins a chapter on Auto, then shows the model Auto picked', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.start'] = (request: CommandRequest<'agents.start'>): OpenChat => ({
      id: 'chat-1',
      agent: request.agent,
      title: '',
      settings: { ...request.settings, cwd: 'C:/work/grimoire', model: 'sonnet', effort: 'medium' },
      status: 'thinking',
      entries: [{ kind: 'user', id: 'u1', text: request.text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    const model = () => el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual([
      'Auto',
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
    ]);

    pick(el, 'Auto');
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] [aria-checked="true"]')).toEqual(['Auto']);
    expect(texts('gr-settings-card [data-setting="effort"] .none')).toEqual(['Auto picks the effort too']);
    // Auto picks the effort with the model, so the head shows no effort yet.
    expect(texts('.meta button')).toEqual(['Claude Code', 'Auto', 'Ask first', '~', 'No preset']);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toMatchObject({
      lastUsed: { agent: 'claude-code', settings: { autoModel: true } },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    await write(fixture, el, 'Rename the ribbon');
    const started = calls.find((c) => c.command === 'agents.start')!.request as CommandRequest<'agents.start'>;
    expect(started.settings).toMatchObject({ autoModel: true });
    expect(started.settings.model).toBeUndefined();
    expect(texts('.meta button').slice(1, 3)).toEqual(['Auto: Sonnet 5.5', 'Medium effort']);

    // Once begun, Auto can't be picked again; another model ends it.
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
    expect(texts('gr-settings-card [data-setting="model"] .none')).toEqual([
      'Auto picked Sonnet 5.5 for your first entry',
    ]);
    pick(el, 'Opus 5.5');
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.configure')?.request).toEqual({
      chatId: 'chat-1',
      change: { model: 'opus' },
    });
  });

  it("sends what you write while a blank chapter's chat starts to that chat, once it has", async () => {
    const { bridge, calls, answers } = fakeBridge();
    let started!: (chat: OpenChat) => void;
    const start = answers['agents.start']!;
    answers['agents.start'] = (request: never) => new Promise<OpenChat>((resolve) => (started = () => resolve(start(request) as OpenChat)));
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Hello');
    await write(fixture, el, 'And the docs');
    expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
    expect(calls.filter((c) => c.command === 'agents.send')).toEqual([]);

    started(undefined as never);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: 'And the docs' },
    ]);
  });

  describe('a chapter that only reads, as another edits its project', () => {
    const opened = (id: string, title: string, more: Partial<OpenChat> = {}): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire', mode: 'accept-edits' },
      status: 'idle',
      entries: [{ kind: 'user', id: `${id}-u1`, text: 'Hello' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
      ...more,
    });
    const reading = { readOnly: { chatId: 'c1', title: 'Context meter' } };

    it('says so in its running head, and is made the editing chat when you ask', async () => {
      const { bridge, calls, emit, answers } = fakeBridge();
      answers['agents.openChats'] = () => [opened('c1', 'Context meter'), opened('c2', 'Explain it', reading)];
      answers['layout.get'] = () => ({ current: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      expect(texts('gr-running-head .read-only p')).toEqual(['Read-only — “Context meter” is editing']);
      expect(texts('gr-running-head .read-only button')).toEqual(['Make this the editing chapter']);
      expect(texts('.meta [data-setting="mode"]')).toEqual(['Accept edits']);

      el.querySelector<HTMLButtonElement>('gr-running-head .read-only button')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({ command: 'agents.takeOver', request: { chatId: 'c2' } });
      emit('agents.readOnly', { chatId: 'c2', readOnly: null });
      await fixture.whenStable();
      expect(el.querySelector('gr-running-head .read-only')).toBeNull();
      expect(texts('.meta [data-setting="mode"]')).toEqual(['Accept edits']);

      // Another chat took over, one not named yet.
      emit('agents.readOnly', { chatId: 'c2', readOnly: { chatId: 'c3', title: '' } });
      await fixture.whenStable();
      expect(texts('gr-running-head .read-only p')).toEqual(['Read-only — “Untitled chapter” is editing']);
    });

    it('changes its permission as any chat does', async () => {
      const { bridge, calls, answers } = fakeBridge();
      answers['agents.openChats'] = () => [opened('c1', 'Context meter'), opened('c2', 'Explain it', reading)];
      answers['layout.get'] = () => ({ current: 'c2' });
      const { fixture, el } = await render(bridge);
      el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
      await fixture.whenStable();
      const modes = [...el.querySelectorAll('gr-settings-card [data-setting="mode"] .choice')];
      expect(modes.map((m) => [m.textContent!.trim().split(/\s+/).slice(0, 2).join(' '), m.getAttribute('aria-checked'), m.getAttribute('aria-disabled')])).toEqual([
        ['Ask first', 'false', null],
        ['Accept edits', 'true', null],
        ['Plan only', 'false', null],
        ['Full access', 'false', null],
      ]);

      pick(el, 'Full access');
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
        { chatId: 'c2', change: { mode: 'allow-all' } },
      ]);
    });

    it('seals its plan as any approval, without making it the editing chat', async () => {
      const { bridge, calls, answers } = fakeBridge();
      const plan = { id: 'p1', chatId: 'c2', tool: 'ExitPlanMode', input: { plan: 'Add the meter' } };
      answers['agents.openChats'] = () => [
        opened('c1', 'Context meter'),
        opened('c2', 'Explain it', { ...reading, status: 'waiting', approvals: [plan] }),
      ];
      answers['layout.get'] = () => ({ current: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      expect(texts('gr-approval-slip .seal-button')).toEqual(['Allow once ⏎']);
      expect(texts('gr-approval-slip .deny')).toEqual(['Deny Esc']);

      el.querySelector<HTMLButtonElement>('gr-approval-slip .seal-button')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.decide').map((c) => c.request)).toEqual([
        { approvalId: 'p1', decision: 'allow-once' },
      ]);
      expect(calls.some((c) => c.command === 'agents.takeOver')).toBe(false);
    });
  });

  it('brings back your earlier entries with Up, and sends one with Enter', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Hello');
    emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'user', id: 'u2', text: 'Add a meter' } });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    const press = async (key: string) => {
      entry.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    await press('ArrowUp');
    expect(entry.value).toBe('Add a meter');
    await press('ArrowUp');
    expect(entry.value).toBe('Hello');
    await press('ArrowUp');
    expect(entry.value).toBe('Hello');
    await press('ArrowDown');
    expect(entry.value).toBe('Add a meter');
    await press('ArrowDown');
    expect(entry.value).toBe('');

    await press('ArrowUp');
    await press('Enter');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: 'Add a meter' },
    ]);
    expect(entry.value).toBe('');

    // Once you change what came back, Up is the caret's again.
    await press('ArrowUp');
    entry.value = 'Add a meter, please';
    entry.dispatchEvent(new Event('input'));
    await press('ArrowUp');
    expect(entry.value).toBe('Add a meter, please');
  });

  it('says what the next entry re-reads once the prompt cache has run out, and offers to compact first', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['compact'] }];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    emit('agents.cache', { chatId: 'chat-1', cache: { tokens: 283_412, until: Date.now() - 3 * 3_600_000 } });
    // Not while a turn runs: it's reading them already.
    await fixture.whenStable();
    expect(el.querySelector('gr-composer .cold')).toBeNull();

    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('gr-composer .cold')).toEqual([
      'Cache expired 3 hours ago, so your next entry re-reads about 283k tokens Compact first',
    ]);
    el.querySelector<HTMLButtonElement>('gr-composer .cold button')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);

    // A turn leaves a fresh cache.
    emit('agents.cache', { chatId: 'chat-1', cache: { tokens: 12_000, until: Date.now() + 3_600_000 } });
    await fixture.whenStable();
    expect(el.querySelector('gr-composer .cold')).toBeNull();
  });

  it('changes only the model and permission once the chapter has begun', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    expect(texts('gr-settings-card .card-head span')).toEqual([
      'Its agent and folder stay as it began. Pick to change the rest.',
    ]);
    expect(
      texts('gr-settings-card [data-setting="folder"] .choice[aria-disabled]'),
    ).toEqual(['~/git/grimoire', '~']);
    expect(texts('gr-settings-card .action')).toEqual(['Save these settings as a preset…']);

    pick(el, 'Plan only');
    pick(el, 'Medium');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mode: 'plan' } },
      { chatId: 'chat-1', change: { effort: 'medium' } },
    ]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mode: 'plan', effort: 'medium' },
    });
    await fixture.whenStable();
    expect(texts('.meta button').slice(2, 4)).toEqual(['Medium effort', 'Plan only']);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
  });

  it("turns MCP servers off for one chapter on its settings card, and not for the next", async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        mcpServers: [
          { name: 'github', source: 'project', tokens: 4200 },
          { name: 'slack', source: 'user', tokens: 900 },
        ],
      },
      settingsFiles: [],
      at: Date.now(),
    });
    answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, mcpOff: ['slack'] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    const column = 'gr-settings-card [data-setting="mcp"]';
    // What each costs; one off in every chapter stays off here.
    expect(texts(`${column} .choice`)).toEqual(['github 4,200 tokens', 'slack off in every chapter']);
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual(['github 4,200 tokens']);
    expect(texts(`${column} .choice[aria-disabled]`)).toEqual(['slack off in every chapter']);
    expect(texts(`${column} .none`)).toEqual(['A change counts from its next turn']);

    pick(el, 'github');
    pick(el, 'slack');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mcpOff: ['github'] } },
    ]);
    emit('agents.settings', { chatId: 'chat-1', settings: { cwd: 'C:/work/grimoire', mcpOff: ['github'] } });
    await fixture.whenStable();
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual([]);
    // A new chapter takes the settings used last, but not the servers turned off for this one.
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/work/grimoire' } },
    });
  });

  it('undoes an entry\'s edits, and marks them withdrawn', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    const edit = (id: string, file: string) => ({
      kind: 'tool' as const,
      id,
      tool: 'Edit',
      input: { file_path: `C:/work/grimoire/${file}`, old_string: 'a', new_string: 'b' },
      result: { text: 'ok', isError: false },
    });
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Add a meter' },
          { kind: 'agent', id: 'a1', blocks: [edit('t1', 'meter.ts'), { kind: 'text', text: 'Added.' }] },
          { kind: 'user', id: 'u2', text: 'Colour it' },
          {
            kind: 'agent',
            id: 'a2',
            blocks: [
              { kind: 'tool', id: 't2', tool: 'Read', input: { file_path: 'C:/work/grimoire/meter.css' }, result: { text: 'x', isError: false } },
              edit('t3', 'meter.css'),
              { kind: 'text', text: 'Coloured.' },
            ],
          },
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el, texts } = await render(bridge);
    const undoes = () => [...el.querySelectorAll<HTMLButtonElement>('.you .by button')].filter((b) => b.textContent!.trim() === 'Undo');
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual([null, null]);
    expect(texts('.you')).toHaveLength(2);

    undoes()[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.undo').map((c) => c.request)).toEqual([
      { chatId: 'c1', entryId: 'u2' },
    ]);
    emit('agents.withdrawn', { chatId: 'c1', withdrawn: ['u2'] });
    await fixture.whenStable();
    expect(texts('.note .detail')).toEqual(['+1 −1', 'withdrawn']);
    // Only the first entry's edit is left to undo.
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual([null]);

    emit('agents.status', { chatId: 'c1', status: 'thinking' });
    await fixture.whenStable();
    expect(undoes().map((b) => b.getAttribute('aria-disabled'))).toEqual(['true']);
  });

  it('offers Undo only where it can restore files, and not on entries a fork copied', async () => {
    const { bridge, answers } = fakeBridge();
    const edit = (id: string) => ({
      kind: 'tool' as const,
      id,
      tool: 'Write',
      input: { file_path: 'C:/work/grimoire/a.ts', content: 'a' },
      result: { text: 'ok', isError: false },
    });
    const reply = (id: string, text: string) => ({ kind: 'agent' as const, id, blocks: [{ kind: 'text' as const, text }] });
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter (a)',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Copied, with an edit' },
          { kind: 'agent', id: 'a1', blocks: [edit('t1'), { kind: 'text', text: 'Wrote it.' }] },
          { kind: 'user', id: 'u2', text: 'Mine, with an edit' },
          { kind: 'agent', id: 'a2', blocks: [edit('t2'), { kind: 'text', text: 'Wrote it again.' }] },
          { kind: 'user', id: 'u3', text: 'Mine, only talk' },
          reply('a3', 'Just talk.'),
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: ['u1'],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { el } = await render(bridge);
    const undoable = [...el.querySelectorAll('.you')].map((you) =>
      [...you.querySelectorAll('.by button')].some((b) => b.textContent!.trim() === 'Undo'),
    );
    expect(undoable).toEqual([false, true, false]);
  });

  it('forks a chapter into a variant and turns to it', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string, status: OpenChat['status'] = 'idle'): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status,
      entries: [{ kind: 'user', id: 'u1', text: 'Add a meter' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
    answers['layout.get'] = () => ({ current: 'c1' });
    answers['agents.fork'] = () => chat('c2', 'Context meter (a)');
    const { fixture, el, texts } = await render(bridge);
    const forkButton = () =>
      [...el.querySelectorAll<HTMLButtonElement>('.you .by button')].find((b) => b.textContent!.trim() === 'Fork')!;

    forkButton().click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.fork').map((c) => c.request)).toEqual([
      { chatId: 'c1', entryId: 'u1' },
    ]);
    expect(texts('gr-running-head h1')).toEqual(['Context meter (a)']);
    expect(texts('gr-ribbon b')).toEqual(['Context meter', 'Context meter (a)', 'New chapter']);
  });

  it('pins and stars a chapter with its dog-ears, but not a blank one', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [{ kind: 'user', id: 'u1', text: 'Add a meter' }],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: ['star'],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el } = await render(bridge);
    const labels = () => [...el.querySelectorAll('gr-dog-ears button')].map((b) => b.getAttribute('aria-label'));
    expect(labels()).toEqual(['Pin this chapter', 'Starred. Unfold to unstar']);

    el.querySelector<HTMLButtonElement>('gr-dog-ears .pin')!.click();
    el.querySelector<HTMLButtonElement>('gr-dog-ears .star')!.click();
    expect(calls.filter((c) => c.command === 'agents.dogEar').map((c) => c.request)).toEqual([
      { chatId: 'c1', dogEar: 'pin', folded: true },
      { chatId: 'c1', dogEar: 'star', folded: false },
    ]);
    emit('agents.dogEars', { chatId: 'c1', dogEars: ['pin'] });
    await fixture.whenStable();
    expect(labels()).toEqual(['Pinned. Unfold to unpin', 'Star this chapter']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
    await fixture.whenStable();
    const blank = [...el.querySelectorAll('gr-dog-ears button')];
    expect(blank.map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    (blank[0] as HTMLButtonElement).click();
    expect(calls.filter((c) => c.command === 'agents.dogEar')).toHaveLength(2);
  });

  it('turns the facing page to the agent\'s commands at a "/" in the entry', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
      { name: 'init', description: 'Write a CLAUDE.md', kind: 'command' },
      { name: 'code-review', description: 'Review the diff', kind: 'skill' },
      { name: 'simplify', description: 'Tidy the changed code', kind: 'skill' },
      { name: 'review', description: 'Review a pull request', kind: 'command' },
    ];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    emit('agents.context', { chatId: 'chat-1', context: { used: 62, limit: 100 } });
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    const type = async (text: string) => {
      entry.value = text;
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (key: string) => {
      entry.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    await type('/');
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code', cwd: 'C:/work/grimoire' },
    ]);
    expect(texts('gr-command-index h3')).toEqual(['Claude Code’s commands', 'Claude Code’s skills']);
    expect(texts('gr-command-index .entry .label')).toEqual([
      '/compact',
      '/init',
      '/review',
      'code-review',
      'simplify',
    ]);
    expect(texts('gr-command-index .entry .where')).toEqual([
      '62% used',
      'C:/work/grimoire',
      'command',
      'skill',
      'skill',
    ]);
    expect(texts('gr-command-index .count')).toEqual(['Claude Code’s commands and skills · 5 entries']);
    expect(texts('gr-composer .slash-hint')).toEqual([
      'Claude Code’s commands and skills are on the facing page →',
    ]);

    await type('/re');
    expect(texts('gr-command-index .entry .label')).toEqual(['/review', 'code-review']);
    expect(texts('gr-command-index .entry b')).toEqual(['/re', 're']);
    await press('ArrowDown');
    expect(texts('gr-command-index .entry[aria-selected="true"] .label')).toEqual(['code-review']);
    expect(entry.getAttribute('aria-activedescendant')).toBe('gr-command-code-review');
    await press('Tab');
    expect(entry.value).toBe('/code-review ');
    expect(el.querySelector('gr-command-index')).toBeNull();
    expect(texts('gr-composer .slash-hint')).toEqual([]);

    await type('/zzz');
    expect(texts('gr-command-index .entries .note')).toEqual([
      'Nothing in Claude Code’s commands and skills matches “/zzz”.',
    ]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-index')).toBeNull();
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);

    await type('/comp');
    await press('Enter');
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(entry.value).toBe('');
    expect(el.querySelector('gr-command-index')).toBeNull();
    // Asked for each time the facing page turns to them; the service keeps them a minute.
    expect(calls.filter((c) => c.command === 'agents.commands')).toHaveLength(3);
  });

  it('shows what the agent suggests next on the empty page, and only Tab writes it in', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
    ];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    const type = async (text: string) => {
      entry.value = text;
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (key: string) => {
      entry.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    const suggest = async (suggestion: string | null) => {
      emit('agents.suggestion', { chatId: 'chat-1', suggestion });
      await fixture.whenStable();
    };
    const sends = () => calls.filter((c) => c.command === 'agents.send');

    // Only once the turn has ended.
    await suggest('Run the tests');
    expect(entry.placeholder).toBe('Write the next entry…');
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(entry.placeholder).toBe('Run the tests');
    expect(texts('gr-composer .suggestion-hint')).toEqual(['Tab to write it in']);

    await press('Enter');
    expect(sends()).toEqual([]);
    await press('Tab');
    expect(entry.value).toBe('Run the tests');
    expect(entry.placeholder).toBe('Write the next entry…');
    expect(texts('gr-composer .suggestion-hint')).toEqual([]);
    await press('Enter');
    expect(sends().map((c) => c.request)).toEqual([{ chatId: 'chat-1', text: 'Run the tests' }]);

    // Writing anything puts it away, even once the page is empty again.
    await suggest('Commit it');
    expect(entry.placeholder).toBe('Commit it');
    await type('N');
    expect(entry.placeholder).toBe('Write the next entry…');
    await type('');
    expect(entry.placeholder).toBe('Write the next entry…');
    await press('Tab');
    expect(entry.value).toBe('');

    // While the commands are listed, Tab completes the one picked.
    await suggest('Push it');
    await type('/');
    await press('Tab');
    expect(entry.value).toBe('/compact ');
    await type('');

    // Gone once the service says so, as when a turn begins.
    await suggest(null);
    expect(entry.placeholder).toBe('Write the next entry…');

    // Turned off on the Colophon, it shows no more.
    await suggest('Push it');
    expect(entry.placeholder).toBe('Push it');
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('#gr-colophon-settings ~ .form .word')]
      .find((button) => button.textContent!.trim() === 'Off')!
      .click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { suggestions: false },
    ]);
    el.querySelector<HTMLButtonElement>('gr-thumb-page .row .gr-link')!.click();
    await fixture.whenStable();
    const back = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    expect(back.placeholder).toBe('Write the next entry…');
    expect(texts('gr-composer .suggestion-hint')).toEqual([]);
  });

  it('offers separate tasks as cards under the last reply, each opening a new chapter with it written in', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const offered = [
      { title: 'Write the docs', prompt: 'Document the meter\nin the README' },
      { title: 'Cut a release', prompt: '\nTag and publish 1.2' },
    ];
    answers['agents.takeFollowUp'] = ({ index }: CommandRequest<'agents.takeFollowUp'>) => {
      emit('agents.followUps', { chatId: 'chat-1', followUps: offered.filter((_, i) => i !== index) });
      return {
        agent: 'claude-code',
        settings: { cwd: 'C:/Users/me/git/grimoire', model: 'sonnet', mode: 'plan', mcpOff: ['github'] },
        prompt: offered[index]!.prompt,
      };
    };
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    const offer = async (followUps: typeof offered | null) => {
      emit('agents.followUps', { chatId: 'chat-1', followUps });
      await fixture.whenStable();
    };

    // Only once the turn has ended.
    await offer(offered);
    expect(el.querySelector('gr-follow-ups')).toBeNull();
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('gr-transcript gr-follow-ups .head')).toEqual(['Separate chapters you could begin']);
    expect(texts('gr-follow-ups .title')).toEqual(['Write the docs', 'Cut a release']);
    expect(texts('gr-follow-ups .line')).toEqual(['Document the meter', 'Tag and publish 1.2']);

    // A click opens a blank chapter with the task written in, not sent; the other card stays.
    el.querySelectorAll<HTMLButtonElement>('gr-follow-ups .card')[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.takeFollowUp').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', index: 1 },
    ]);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('\nTag and publish 1.2');
    expect(texts('.meta button')).toContain('Sonnet 5.5');
    expect(texts('.meta button')).toContain('Plan only');
    expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
    [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')][0]!.click();
    await fixture.whenStable();
    expect(texts('gr-follow-ups .title')).toEqual(['Write the docs']);

    // All go once the next turn begins.
    emit('agents.status', { chatId: 'chat-1', status: 'thinking' });
    await offer(null);
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(el.querySelector('gr-follow-ups')).toBeNull();

    // The Colophon turns them off.
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const off = [...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="gr-colophon-follow-ups"] .word')];
    expect(texts('#gr-colophon-follow-ups')).toEqual(['Suggest separate chapters']);
    off.find((button) => button.textContent!.trim() === 'Off')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { followUps: false },
    ]);
    expect(texts('[aria-labelledby="gr-colophon-follow-ups"] .word[aria-checked="true"]')).toEqual(['Off']);
  });

  it('uses a command clicked on the facing page', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => [
      { name: 'compact', description: 'Free up context', kind: 'command' },
    ];
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = '/';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-command-index .entry')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(document.activeElement).toBe(entry);
  });

  it('says why the agent\'s commands could not be listed', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.commands'] = () => {
      throw new Error('Claude Code is not installed');
    };
    const { fixture, el, texts } = await render(bridge);
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.value = '/';
    entry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // A blank chapter's folder isn't chosen yet: the agent looks in your home folder.
    expect(calls.filter((c) => c.command === 'agents.commands').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);
    expect(texts('gr-command-index .entries .note')).toEqual([
      'Claude Code’s commands and skills couldn’t be listed: Claude Code is not installed',
    ]);
  });

  it('renames a chapter in place with the pen beside its title', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['rename'] }];
    const { fixture, el, texts } = await render(bridge);
    await fixture.whenStable();
    const pen = () => el.querySelector<HTMLButtonElement>('[aria-label="Rename chapter"]');
    const field = () => el.querySelector<HTMLInputElement>('gr-running-head input.rename');
    const rename = async (title: string, key: string) => {
      pen()!.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(field());
      field()!.value = title;
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    // A blank chapter's chat starts with the title you gave it.
    await rename('Login bug', 'Enter');
    expect(texts('gr-running-head h1')).toEqual(['Login bug']);
    await write(fixture, el, 'First');
    expect(calls.find((c) => c.command === 'agents.start')!.request).toMatchObject({ title: 'Login bug' });

    await rename('  Flaky login test ', 'Enter');
    expect(calls.filter((c) => c.command === 'agents.rename').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', title: 'Flaky login test' },
    ]);
    expect(texts('gr-running-head h1')).toEqual(['Flaky login test']);
    expect(document.activeElement).toBe(pen());

    // Esc puts the title back, and leaves the turn running.
    await rename('Something else', 'Escape');
    expect(texts('gr-running-head h1')).toEqual(['Flaky login test']);
    expect(calls.filter((c) => c.command === 'agents.rename')).toHaveLength(1);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
  });

  it('leaves the pen out for agents that can\'t rename their chats', async () => {
    const { bridge } = fakeBridge();
    const { el } = await render(bridge);
    expect(el.querySelector('[aria-label="Rename chapter"]')).toBeNull();
  });

  it('tags a chapter in its running head, and takes tags off again', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const add = async (tag: string, key: string) => {
      el.querySelector<HTMLButtonElement>('gr-chapter-tags .gr-link')!.click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>('gr-chapter-tags input')!;
      expect(document.activeElement).toBe(field);
      field.value = tag;
      field.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    const tagCalls = () => calls.filter((c) => c.command === 'agents.tag').map((c) => c.request);

    // A blank chapter's tags go to its chat once it starts.
    await add('ui', 'Enter');
    expect(texts('gr-chapter-tags .tag')).toEqual(['ui']);
    await write(fixture, el, 'First');
    expect(tagCalls()).toEqual([{ chatId: 'chat-1', tags: ['ui'] }]);

    await add(' bug ', 'Enter');
    await add('UI', 'Enter');
    await add('later', 'Escape');
    expect(texts('gr-chapter-tags .tag')).toEqual(['ui', 'bug']);
    expect(tagCalls()).toEqual([
      { chatId: 'chat-1', tags: ['ui'] },
      { chatId: 'chat-1', tags: ['ui', 'bug'] },
    ]);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
    expect(document.activeElement).toBe(el.querySelector('gr-chapter-tags .gr-link'));

    el.querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-chapter-tags .tag')).toEqual(['bug']);
    expect(tagCalls().at(-1)).toEqual({ chatId: 'chat-1', tags: ['bug'] });
  });

  it('saves a chapter\'s settings as a preset, and puts chapters on it', async () => {
    const { bridge, calls, answers } = fakeBridge();
    let saved: Preset[] = [];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) => (saved = [...saved, preset]);
    const { fixture, el, texts } = await render(bridge);
    const head = () => texts('.meta button');
    const open = async (setting: string) => {
      el.querySelector<HTMLButtonElement>(`.meta [data-setting="${setting}"]`)!.click();
      await fixture.whenStable();
    };
    const presetColumn = '.column[data-setting="preset"]';

    await open('preset');
    expect(texts(`${presetColumn} .none`)).toEqual(['No saved presets yet']);
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual(['No preset']);
    el.querySelector<HTMLButtonElement>(`${presetColumn} .action`)!.click();
    await fixture.whenStable();
    const name = el.querySelector<HTMLInputElement>('.preset-name')!;
    expect(document.activeElement).toBe(name);
    name.value = 'Plan a feature';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    // The defaults are written in, so the preset means the same later.
    expect(calls.find((c) => c.command === 'presets.save')!.request).toEqual({
      name: 'Plan a feature',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me', model: 'opus', effort: 'xhigh', mode: 'ask' },
    });
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual(['Plan a feature Claude Code · Ask first']);
    expect(head()[5]).toBe('Plan a feature');
    expect(document.activeElement).toBe(el.querySelector(`${presetColumn} .action`));

    // Another setting takes the chapter off the preset; picking the preset puts it back.
    pick(el, 'Plan only');
    pick(el, 'Low');
    await fixture.whenStable();
    expect(head()[5]).toBe('No preset');
    pick(el, 'Plan a feature');
    await fixture.whenStable();
    expect(head().slice(2)).toEqual(['Extra high effort', 'Ask first', '~', 'Plan a feature']);

    // Once begun in another folder, the chapter can't take it.
    pick(el, '~/git/breeder');
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await write(fixture, el, 'First');
    await open('preset');
    const choice = [...el.querySelectorAll(`${presetColumn} .choice`)].find((c) =>
      c.textContent!.includes('Plan a feature'),
    )!;
    expect(choice.getAttribute('aria-disabled')).toBe('true');
    expect(head()[5]).toBe('No preset');
  });

  it('attaches files, and pasted or dropped pictures, and sends them with the entry', async () => {
    const { bridge, calls } = fakeBridge({
      chooseFiles: vi.fn(async () => ['C:/work/grimoire/src/app/ribbon.ts', 'D:/notes.txt']),
      pathOf: vi.fn((file: File) => (file.name === 'README.md' ? 'C:/work/grimoire/README.md' : '')),
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');

    el.querySelector<HTMLButtonElement>('[aria-label="Attach files or a screenshot"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual(['src/app/ribbon.ts', 'D:/notes.txt']);
    expect(texts('gr-composer .ref figcaption span')).toEqual([
      'Ref. 1. Attached file',
      'Ref. 2. Attached file',
    ]);

    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    entry.dispatchEvent(withFiles('paste', [picture('shot.png')]));
    await fixture.whenStable();
    entry.dispatchEvent(withFiles('drop', [new File(['# Grimoire'], 'README.md'), picture('photo.png')]));
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual(['src/app/ribbon.ts', 'D:/notes.txt', 'README.md']);
    expect(texts('gr-composer .plate figcaption span')).toEqual([
      expect.stringMatching(/^Plate I\. Screenshot, pasted at .+$/),
      expect.stringMatching(/^Plate II\. Picture, dropped at .+$/),
    ]);
    expect(el.querySelector('gr-composer .plate img')!.getAttribute('src')).toBe(
      'data:image/png;base64,AQID',
    );

    el.querySelector<HTMLButtonElement>('[aria-label="Remove notes.txt"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Remove plate II"]')!.click();
    await fixture.whenStable();
    await write(fixture, el, 'Why is this blurry?');
    expect(calls.filter((c) => c.command === 'agents.send').at(-1)!.request).toEqual({
      chatId: 'chat-1',
      text: 'Why is this blurry?',
      enclosures: [
        { kind: 'file', path: 'C:/work/grimoire/src/app/ribbon.ts' },
        {
          kind: 'picture',
          mediaType: 'image/png',
          data: 'AQID',
          caption: expect.stringMatching(/^Screenshot, pasted at /),
        },
        { kind: 'file', path: 'C:/work/grimoire/README.md' },
      ],
    });
    expect(el.querySelector('gr-composer gr-enclosures')).toBeNull();
  });

  it('shows what went with an entry, on its page and while it waits', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'user',
        id: 'u2',
        text: '',
        enclosures: [
          { kind: 'picture', mediaType: 'image/png', data: 'AQID' },
          { kind: 'file', path: 'src/app/ribbon.ts' },
        ],
      },
    });
    emit('agents.queued', {
      chatId: 'chat-1',
      queued: [
        { id: 'q1', text: 'And this.', enclosures: [{ kind: 'file', path: 'C:/work/grimoire/notes.txt' }] },
      ],
    });
    await fixture.whenStable();
    expect(texts('.you p')).toEqual(['First']);
    expect(texts('.you .plate figcaption span')).toEqual(['Plate I. Picture']);
    expect(texts('.you .ref code')).toEqual(['src/app/ribbon.ts']);
    expect(el.querySelector('.you .x')).toBeNull();
    expect(texts('.queued-text')).toEqual(['And this. + 1 attached']);

    [...el.querySelectorAll<HTMLButtonElement>('.queued button')]
      .find((b) => b.textContent!.trim() === 'Edit')!
      .click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('And this.');
    expect(texts('gr-composer .ref code')).toEqual(['notes.txt']);
  });

  it('shows why an undo failed', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: '',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [
          { kind: 'user', id: 'u1', text: 'Add a meter' },
          {
            kind: 'agent',
            id: 'a1',
            blocks: [
              {
                kind: 'tool',
                id: 't1',
                tool: 'Write',
                input: { file_path: 'C:/work/grimoire/meter.ts', content: 'meter' },
                result: { text: 'ok', isError: false },
              },
            ],
          },
        ],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    answers['agents.undo'] = () => Promise.reject(new Error('No checkpoint for this entry'));
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('.you .by button')!.click();
    await fixture.whenStable();
    expect(texts('.error')).toEqual(['No checkpoint for this entry']);
  });

  it('turns the facing page to every slip awaiting your seal, oldest first', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, command: string, at: number): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/Users/me/git/grimoire' },
      status: 'waiting',
      entries: [],
      approvals: [{ id: `${id}-seal`, chatId: id, tool: 'Bash', input: { command }, at }],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', 'npm test', 200),
      chat('c2', 'Context meter', 'git push', 100),
    ];
    answers['layout.get'] = () => ({ current: 'c2', lastUsed: null });
    const { fixture, el, texts } = await render(bridge);
    const ribbon = [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon button')].find((b) =>
      b.textContent!.includes('Awaiting your seal'),
    )!;
    const focusedSlip = () => document.activeElement?.closest('gr-approval-slip')?.querySelector('.well')?.textContent;

    ribbon.click();
    await fixture.whenStable();
    expect(ribbon.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-seals-page .hint')).toEqual(['2 slips from 2 chapters, oldest first']);
    expect(texts('gr-seals-page .gr-link')[0]).toBe('Back to the Outline Esc');
    expect(texts('gr-seals-page gr-approval-slip .head b')).toEqual([
      'Context meter',
      'Fix flaky login test',
    ]);
    expect(texts('gr-seals-page gr-approval-slip .meta span')[0]).toBe('Runs in ~/git/grimoire');
    // In its chapter, the slip is a stub pointing to the facing page.
    expect(texts('gr-chapter-page gr-seal-stub code')).toEqual(['git push']);
    expect(focusedSlip()).toBe('$git push');
    el.querySelector('gr-seals-page gr-approval-slip')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(focusedSlip()).toBe('$npm test');

    // Esc turns back, denying nothing.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-chapter-page gr-approval-slip .well')).toEqual(['$git push']);
    expect(calls.some((c) => c.command === 'agents.decide')).toBe(false);

    // The stub opens the page on its own slip; sealing answers in that chapter.
    ribbon.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-seal-stub button')!.click();
    await fixture.whenStable();
    expect(focusedSlip()).toBe('$git push');
    el.querySelectorAll<HTMLButtonElement>('gr-seals-page .seal-button')[1]!.click();
    expect(calls.find((c) => c.command === 'agents.decide')?.request).toEqual({
      approvalId: 'c1-seal',
      decision: 'allow-once',
    });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 'c1-seal' });
    await fixture.whenStable();
    expect(texts('gr-seals-page .hint')).toEqual(['1 slip from 1 chapter, oldest first']);

    // Sealing the last one turns the page back.
    emit('agents.approvalSettled', { chatId: 'c2', approvalId: 'c2-seal' });
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-facing-page .tabs [aria-pressed="true"]')).toEqual(['Outline']);
  });

  it('opens a slip\'s chapter from the facing page', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = () => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        settings: { cwd: 'C:/work' },
        status: 'waiting',
        entries: [],
        approvals: [{ id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' } }],
        queued: [],
        plan: [],
        withdrawn: [],
        dogEars: [],

        tags: [],
        copied: [],
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-running-head h1')).toEqual(['Untitled chapter']);
    el.querySelector<HTMLButtonElement>('gr-ribbon[data-tone="seal"] button')!.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-seals-page gr-approval-slip .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-seals-page')).toBeNull();
    expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
    expect(texts('gr-chapter-page gr-approval-slip .well')).toEqual(['$npm test']);
  });

  it('tucks an approval into the page and seals it', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Push it');
    emit('agents.approval', {
      approval: {
        id: 'ap1',
        chatId: 'chat-1',
        tool: 'Bash',
        input: { command: 'git push origin main', description: 'Pushes the branch' },
        alwaysAllow: { rule: 'git push', scope: 'project' },
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();

    expect(texts('gr-approval-slip .head > *')).toEqual([
      '¶ Awaiting your seal',
      'Claude Code asks to run this command',
    ]);
    expect(texts('gr-approval-slip .well')).toEqual(['$git push origin main']);
    expect(texts('gr-approval-slip .meta span')).toEqual([
      'Runs in C:/work/grimoire',
      'Pushes the branch',
    ]);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow git push in this project ⇧⏎',
      'Deny Esc',
    ]);
    expect(texts('.stop')).toEqual([]);
    expect(texts('gr-ribbon .seal')).toEqual(['1']);
    expect(document.activeElement?.textContent).toContain('Allow once');

    el.querySelector<HTMLButtonElement>('gr-approval-slip .seal-button')!.click();
    el.querySelector('gr-approval-slip')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.filter((c) => c.command === 'agents.decide').map((c) => c.request)).toEqual([
      { approvalId: 'ap1', decision: 'allow-once' },
      { approvalId: 'ap1', decision: 'allow-always' },
      { approvalId: 'ap1', decision: 'deny' },
    ]);
    expect(calls.some((c) => c.command === 'agents.interrupt')).toBe(false);

    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ap1' });
    await fixture.whenStable();
    expect(el.querySelector('gr-approval-slip')).toBeNull();
    expect(texts('gr-ribbon .seal')).toEqual([]);
  });

  it('shows a file change as corrections on the slip', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Rename it');
    emit('agents.approval', {
      approval: {
        id: 'ap2',
        chatId: 'chat-1',
        tool: 'Edit',
        input: {
          file_path: 'C:/work/grimoire/src/a.ts',
          old_string: 'const a = 1;\nexport { a };',
          new_string: 'const b = 1;\nexport { b };',
        },
        alwaysAllow: { scope: 'chat' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-corrections .head b')).toEqual(['src/a.ts']);
    expect(texts('gr-corrections .line .mark')).toEqual(['dele', 'dele', '‸ insert 2 lines', '']);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow edits in this chapter ⇧⏎',
      'Deny Esc',
    ]);
  });

  it('prints the agent’s questions as a form and sends your answers', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Build the meter');
    emit('agents.approval', {
      approval: {
        id: 'q1',
        chatId: 'chat-1',
        tool: 'AskUserQuestion',
        input: {},
        questions: [
          {
            question: 'Where should the meter appear?',
            options: [
              { label: 'In the composer', recommended: true },
              { label: 'In the running head' },
            ],
            multiSelect: false,
          },
          {
            question: 'Which warnings do you want?',
            options: [{ label: 'At 80% used' }, { label: 'At 95% used' }],
            multiSelect: true,
          },
        ],
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();

    expect(texts('gr-questions-form h2')).toEqual(['Questions from Claude Code']);
    expect(texts('gr-questions-form legend')).toEqual([
      'I.Where should the meter appear?Tick one.',
      'II.Which warnings do you want?Tick any.',
    ]);
    expect(texts('gr-questions-form .recommended')).toEqual(['recommended']);
    // Questions don't wait for a seal.
    expect(texts('gr-ribbon .seal')).toEqual([]);

    const options = [...el.querySelectorAll<HTMLInputElement>('gr-questions-form .option input')];
    expect(options.map((o) => o.type)).toEqual(['radio', 'radio', 'checkbox', 'checkbox']);
    options[1]!.click();
    options[0]!.click();
    options[2]!.click();
    options[3]!.click();
    options[3]!.click();
    const ownWords = el.querySelectorAll<HTMLInputElement>(
      'gr-questions-form .own-words input',
    )[1]!;
    ownWords.value = ' and at 99% ';
    ownWords.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-questions-form .option.on span:first-of-type')).toEqual([
      'In the composer',
      'At 80% used',
    ]);

    el.querySelector<HTMLButtonElement>('gr-questions-form .send')!.click();
    expect(calls.filter((c) => c.command === 'agents.answer').map((c) => c.request)).toEqual([
      {
        approvalId: 'q1',
        answers: [
          { chosen: ['In the composer'] },
          { chosen: ['At 80% used'], ownWords: 'and at 99%' },
        ],
      },
    ]);
  });

  it('keeps the chapter\'s plan in the Outline, and its tools out of the margin', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-outline .none')).toEqual([
      'No plan yet. Claude Code writes one here when a task takes several steps.',
    ]);
    await write(fixture, el, 'Add a context meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          { kind: 'tool', id: 't1', tool: 'TaskCreate', input: { subject: 'Read the composer' } },
          { kind: 'tool', id: 't2', tool: 'Read', input: { file_path: 'C:/work/grimoire/a.ts' } },
        ],
      },
    });
    emit('agents.plan', {
      chatId: 'chat-1',
      plan: [
        { text: 'Read the composer', status: 'done' },
        { text: 'Fill in the meter', status: 'active', activeText: 'Filling in the meter' },
        { text: 'Run the tests', status: 'pending' },
      ],
    });
    emit('agents.status', { chatId: 'chat-1', status: 'writing' });
    await fixture.whenStable();

    expect(texts('gr-outline li > *')).toEqual([
      'i.', 'Read the composer', 'done',
      'ii.', 'Fill in the meter', 'writing',
      'iii.', 'Run the tests', 'to do',
    ]);
    expect(texts('gr-outline li.now .text')).toEqual(['Fill in the meter']);
    expect(texts('gr-facing-page gr-running-foot')).toEqual(['1 of 3 done']);
    expect(texts('.note .note-head')).toEqual(['Read']);
  });

  describe('a second chapter on the facing page', () => {
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: `C:/work/${id}` },
      status: 'idle',
      entries: [{ kind: 'user', id: `u-${id}`, text: `Hello ${title}` }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    });
    const tab = (el: HTMLElement, label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-facing-tabs .tabs button')].find(
        (b) => b.textContent!.trim() === label,
      )!;
    const beside = (el: HTMLElement) => el.querySelector<HTMLElement>('gr-chapter-page[beside]');
    const layouts = (calls: { command: string; request: unknown }[]) =>
      calls.filter((c) => c.command === 'layout.set').map((c) => c.request as Record<string, unknown>);

    it('puts another open chapter there, to work in as on the left page', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1' });
      const { fixture, el, texts } = await render(bridge);

      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chapter .ask')).toEqual([
        'Which chapter goes on this page, beside the one you’re on?',
      ]);
      expect(texts('gr-second-chapter .pick')).toEqual(['Fix flaky login test']);
      expect(texts('gr-second-chapter .meta')).toEqual(['Claude Code · C:/work/c2']);

      el.querySelector<HTMLButtonElement>('gr-second-chapter .pick')!.click();
      await fixture.whenStable();
      expect(layouts(calls)).toContainEqual({ beside: 'c2' });
      // Both pages are chapters: the left one stays, the other heads the facing page with its title.
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Fix flaky login test']);
      expect(beside(el)!.querySelector('.meta')!.textContent).toContain('C:/work/c2');
      expect(texts('gr-ribbon.beside b')).toEqual(['Fix flaky login test']);
      expect(texts('gr-ribbon.beside i')).toEqual(['Claude Code · idle · on the facing page']);

      // Its entry goes to its own chat.
      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = 'Run the tests again';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({ command: 'agents.send', request: { chatId: 'c2', text: 'Run the tests again' } });

      // Its settings open on it, without turning the left page.
      beside(el)!.querySelector<HTMLButtonElement>('.meta button')!.click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-settings-card')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      // Esc there closes them, and leaves the left page alone.
      beside(el)!
        .querySelector('.meta button')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await fixture.whenStable();
      expect(el.querySelector('gr-settings-card')).toBeNull();

      // Its ribbon swaps the two pages.
      el.querySelector<HTMLButtonElement>('gr-ribbon.beside .tail')!.click();
      await fixture.whenStable();
      expect(texts('gr-running-head h1')).toEqual(['Fix flaky login test']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Context meter']);
      expect(layouts(calls).slice(-2)).toEqual([{ beside: 'c1' }, { current: 'c2' }]);

      // Another chapter takes it off the page; it stays open.
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Another chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chapter .pick')).toEqual(['Context meter']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-ribbon.chapter b')).toEqual(['Context meter', 'Fix flaky login test']);
    });

    it('opens a new chapter there, and keeps it there once it begins', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
      answers['layout.get'] = () => ({ current: 'c1' });
      answers['agents.start'] = () => chat('c9', '');
      const { fixture, el, texts } = await render(bridge);
      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chapter .none')).toEqual(['No other chapter is open.']);

      [...el.querySelectorAll<HTMLButtonElement>('gr-second-chapter .gr-link')]
        .find((b) => b.textContent!.trim() === 'A new chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-chapter-opening')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);

      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = 'Write the ribbon tests';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
      expect(layouts(calls)).toContainEqual({ beside: 'c9' });
      expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    it('opens the book with the chapter that was beside the one you were on', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { el, texts } = await render(bridge);
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
      expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Fix flaky login test']);
      expect(beside(el)).not.toBeNull();
    });

    it('lists the agent\'s commands for its entry on the left page', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      answers['agents.commands'] = () => [{ name: 'compact', description: 'Free up context', kind: 'command' }];
      const { fixture, el, texts } = await render(bridge);
      const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry-beside')!;
      entry.value = '/';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(el.querySelector('gr-page:not(.facing) gr-command-index')).not.toBeNull();
      expect(el.querySelector('gr-page.facing gr-command-index')).toBeNull();
      expect(el.querySelector('#gr-next-entry-beside')).toBe(entry);
      expect(texts('gr-command-index .entry .label')).toEqual(['/compact']);
      expect(texts('gr-composer .slash-hint')).toEqual([
        'Claude Code’s commands and skills are on the facing page ←',
      ]);
      expect(texts('gr-command-index .gr-link')[0]).toMatch(/^Back to the chapter/);

      entry.value = '';
      entry.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(el.querySelector('gr-command-index')).toBeNull();
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    it('forgets the chapter beside once it closes', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Close')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chapter .none')).toEqual(['No other chapter is open.']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-running-head h1')).toEqual(['Context meter']);
    });

    describe('parallel texts', () => {
      const parallel = (el: HTMLElement) =>
        el.querySelector<HTMLButtonElement>('gr-composer button[aria-label^="Parallel texts"]');
      const write = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }, text: string) => {
        const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
        entry.value = text;
        entry.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      };
      const forking = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['fork'] }];

      it('sends the entry to a copy of the chapter on a second model, beside it', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1', focus: true });
        answers['agents.parallel'] = (request: CommandRequest<'agents.parallel'>): OpenChat => ({
          ...chat('c2', 'Context meter (a)'),
          settings: { cwd: 'C:/work/c1', model: request.model },
          status: 'thinking',
          readOnly: { chatId: 'c1', title: 'Context meter' },
        });
        const { fixture, el, texts } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');

        parallel(el)!.click();
        await fixture.whenStable();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('true');
        // The chapter is on Opus, the default: the others are offered, the first picked.
        expect(texts('gr-composer .parallel-model')).toEqual(['Sonnet 5.5', 'Haiku 5.5']);
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Sonnet 5.5']);
        expect(texts('gr-composer .parallel-where')).toEqual(['a copy of this chapter, on the facing page']);
        el.querySelectorAll<HTMLButtonElement>('gr-composer .parallel-model')[1]!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Haiku 5.5']);

        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        // The service sends it to both: the chapter, and its copy.
        expect(calls).toContainEqual({
          command: 'agents.parallel',
          request: { from: { chatId: 'c1' }, model: 'haiku', text: 'Colour it' },
        });
        expect(calls.some((c) => c.command === 'agents.send')).toBe(false);
        // Out of focus, so the copy shows on the facing page.
        expect(layouts(calls)).toContainEqual({ focus: false });
        expect(layouts(calls)).toContainEqual({ beside: 'c2' });
        expect(texts('gr-running-head h1')).toEqual(['Context meter']);
        expect(texts('gr-facing-tabs .tabs [aria-pressed="true"]')).toEqual(['Context meter (a)']);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
        // It works in the same folder, so it only reads while the chapter edits.
        expect(beside(el)!.querySelector('.read-only p')!.textContent!.trim()).toBe(
          'Read-only — “Context meter” is editing',
        );
        // Parallel is off again, and not offered on the facing page.
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');
        expect(beside(el)!.querySelector('button[aria-label^="Parallel texts"]')).toBeNull();
      });

      it('starts a blank chapter first, then the second afresh', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.parallel'] = (): OpenChat => ({ ...chat('c9', ''), status: 'thinking' });
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-where')).toEqual(['a chapter of its own, on the facing page']);

        await write(el, fixture, 'Fix the login test');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        const started = calls.findIndex((c) => c.command === 'agents.start');
        const second = calls.findIndex((c) => c.command === 'agents.parallel');
        expect(started).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(started);
        expect(calls[second]!.request).toMatchObject({
          from: { agent: 'claude-code', alongside: 'chat-1' },
          model: 'sonnet',
          text: 'Fix the login test',
        });
        expect(layouts(calls)).toContainEqual({ beside: 'c9' });
        expect(el.querySelectorAll('gr-ribbon.chapter')).toHaveLength(2);
        expect(el.querySelectorAll('gr-ribbon.beside')).toHaveLength(1);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      });

      it('waits for the turn to end to copy a chapter', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [{ ...chat('c1', 'Context meter'), status: 'thinking' }];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { fixture, el } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-disabled')).toBe('true');
        parallel(el)!.click();
        await fixture.whenStable();
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
      });

      it('shows on the chapter why the copy couldn\'t be made', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        answers['agents.parallel'] = () =>
          Promise.reject(new Error('Claude Code can’t copy a chat to another model'));
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        expect(texts('.error')).toEqual(['Claude Code can’t copy a chat to another model']);
        expect(beside(el)).toBeNull();
      });

      it('isn\'t offered when the agent can\'t copy a chapter that has begun', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { el } = await render(bridge);
        expect(parallel(el)).toBeNull();
      });
    });
  });
});
