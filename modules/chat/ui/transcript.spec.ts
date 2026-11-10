import type { TokenUse } from '@grimoire/contract';
import { Diagrams } from './markdown/diagrams';
import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('transcript', () => {
  it('times the running turn by Stop, and shows how long each turn took once it ended', async () => {
    // The turn is timed from when it began to now, so the test fixes now.
    const now = new Date(2026, 10, 9, 15, 30).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = { kind: 'user' as const, id: 'u1', text: 'Fix the flaky login test' };
    emit('agents.entry', { chatId: 'chat-1', entry: { ...user, at: now - 134_000 } });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual(['Stop Esc 2m 14s']);
    expect(texts('.spent-line .took')).toEqual([]);

    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { ...user, at: now - 200_000, took: 200_000 },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('.stop')).toEqual([]);
    expect(texts('.spent-line .took')).toEqual(['3m 20s']);
    expect(el.querySelector('.spent-line .took')!.getAttribute('title')).toBe(
      'This turn took 3m 20s',
    );
  });

  it("shows what each turn spent at its end, the chat's costliest three in rubric", async () => {
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
    emit(
      'agents.entry',
      turn('u1', use(500, 100), { ...use(2_000), model: 'claude-haiku-4-5', subagent: true }),
    );
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
    expect(texts('.spent-line .spent')).toEqual([
      '3K tokens',
      '500 tokens',
      '4K tokens',
      '100 tokens',
      '2K tokens',
    ]);
    expect(texts('.spent-line .spent.costly')).toEqual(['3K tokens', '4K tokens', '2K tokens']);
    expect(el.querySelector('.spent-line .spent.costly')!.getAttribute('title')).toMatch(
      /^One of the costliest turns in this chapter: 3K tokens/,
    );
  });

  it("counts each turn's hooks on its closing line, expanding to each, what it printed and how it went", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const user = {
      kind: 'user' as const,
      id: 'u1',
      text: 'Fix the flaky login test',
      at: new Date(2026, 10, 9, 15, 30).getTime(),
    };
    const lint = { id: 'h1', name: 'PostToolUse:Edit', event: 'PostToolUse', tool: 'Edit' };
    const guard = {
      id: 'h2',
      name: 'PreToolUse:PowerShell',
      event: 'PreToolUse',
      tool: 'PowerShell',
    };
    const stop = { id: 'h3', name: 'Stop', event: 'Stop' };
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { ...user, hooks: [{ ...lint, outcome: 'running' }] },
    });
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
    expect(el.querySelector('.hook gr-output')!.getAttribute('aria-label')).toBe(
      'Output of PreToolUse:PowerShell',
    );
    expect(texts('.hook gr-output .code')).toEqual(['No rm -rf here']);
  });

  it('sets replies as markdown and numbers listings through the chat', async () => {
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

  it('sums up a run of tool notes, and expands them to the diff or the output', async () => {
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

    expect(texts('.note.summary > *')).toEqual([
      'Changed 1 file, ran the tests once',
      '+2 −1',
      '1 failed',
    ]);
    const run = el.querySelector<HTMLButtonElement>('.note.summary')!;
    expect(run.getAttribute('aria-expanded')).toBe('false');

    run.click();
    await fixture.whenStable();
    expect(run.getAttribute('aria-expanded')).toBe('true');
    expect(texts('.run .note > *')).toEqual([
      'Edited',
      'meter.ts',
      '+2 −1',
      'Tested',
      'npm test',
      'failed',
    ]);
    expect(el.querySelector('gr-diff-view, gr-output')).toBeNull();

    const notes = el.querySelectorAll<HTMLButtonElement>('.run .note');
    notes[0]!.click();
    await fixture.whenStable();
    expect(notes[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-diff-view .head b')).toEqual(['src/meter.ts']);
    expect(texts('gr-diff-view .head .detail')[0]).toBe('corrections, as marked by Claude Code');

    // Opening another note closes the one you had open.
    notes[1]!.click();
    await fixture.whenStable();
    expect(notes[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('gr-diff-view')).toBeNull();
    expect(texts('gr-output .head > *')).toEqual(['npm test', 'output']);
    expect(texts('gr-output .line')).toEqual(['12 passed', '1 failed']);

    notes[1]!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-output')).toBeNull();
  });

  it("opens a compaction's summary, and puts it away", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'u1');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { kind: 'compaction', id: 'c1', before: 92_000, summary: '1. **Intent**: say hi' },
    });
    await fixture.whenStable();
    const toggle = el.querySelector<HTMLButtonElement>('.compaction button')!;
    expect(toggle.textContent!.trim()).toBe('Read the summary');
    expect(el.querySelector('.summary')).toBeNull();

    toggle.click();
    await fixture.whenStable();
    expect(texts('.summary')).toEqual(['Intent: say hi']);
    expect(toggle.textContent!.trim()).toBe('Put the summary away');

    toggle.click();
    await fixture.whenStable();
    expect(el.querySelector('.summary')).toBeNull();
  });
});
