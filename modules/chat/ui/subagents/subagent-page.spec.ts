import { fakeBridge, render, write } from '@ui/testing/app-testing';

describe('subagent-page', () => {
  it('turns the right page to what a subagent did, from its note, and keeps it current as it works', async () => {
    const { bridge, emit, answers, calls } = fakeBridge();
    answers['agents.subagent'] = () => ({
      entries: [
        {
          kind: 'agent',
          id: 'h1',
          model: 'claude-haiku-4-5',
          blocks: [
            {
              kind: 'tool',
              id: 'ht1',
              tool: 'Grep',
              input: { pattern: 'meter' },
              result: { text: 'meter.ts', isError: false },
            },
            { kind: 'text', text: 'Found the meter.' },
          ],
        },
      ],
      state: 'working',
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    const subagentCall = {
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
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: { kind: 'agent', id: 'a1', blocks: [subagentCall] },
    });
    await fixture.whenStable();

    const note = [...el.querySelectorAll<HTMLButtonElement>('gr-chat-page .note')].find((n) =>
      n.textContent!.includes('Asked a helper'),
    )!;
    note.click();
    await fixture.whenStable();
    expect(calls.at(-1)).toEqual({
      command: 'agents.subagent',
      request: { chatId: 'chat-1', toolId: 't1' },
    });
    expect(texts('gr-right-page-tabs .tabs [aria-pressed="true"]')).toEqual(['Find the meter']);
    expect(texts('gr-subagent-page .title')).toEqual(['Find the meter']);
    expect(texts('gr-subagent-page .meta')).toEqual(['Explore · Haiku 4.5 · Working…']);
    // Its task opens the page, signed by the agent that asked.
    expect(texts('gr-subagent-page gr-transcript .you .who')).toEqual(['Claude Code']);
    expect(texts('gr-subagent-page gr-transcript .you .text')).toEqual([
      'Look for the context meter.',
    ]);
    expect(
      el.querySelector('gr-subagent-page gr-transcript .row')!.querySelector('.you'),
    ).not.toBeNull();
    expect(texts('gr-subagent-page gr-transcript .reply .who')).toEqual(['Helper']);
    expect(texts('gr-subagent-page gr-transcript .note > *')).toEqual(['Searched', 'meter']);
    expect(el.querySelector('gr-subagent-page gr-transcript .stop')).toBeNull();
    expect([...el.querySelectorAll('gr-subagent-page gr-transcript .you .gr-link')]).toEqual([]);
    expect(el.querySelector('gr-subagent-page gr-composer')).toBeNull();
    expect(texts('gr-subagent-page gr-page-footer')).toEqual(['Working…']);

    // A background subagent's tool call has its result at once; the subagent is still at work.
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            ...subagentCall,
            result: { text: 'Async agent launched successfully.', isError: false },
          },
        ],
      },
    });
    emit('agents.subagentEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [{ kind: 'tool', id: 'ht2', tool: 'Bash', input: { command: 'npm test' } }],
      },
    });
    await fixture.whenStable();
    expect(texts('gr-subagent-page gr-page-footer')).toEqual(['Working…']);
    expect(el.querySelector('gr-subagent-page .line.waiting')).toBeNull();

    // It asks for your OK in the chat, where you give it.
    emit('agents.approval', {
      approval: { id: 'ht2', chatId: 'chat-1', tool: 'Bash', input: { command: 'npm test' } },
    });
    await fixture.whenStable();
    expect(texts('gr-subagent-page .line.waiting')).toEqual(['Awaiting your seal in the chapter']);
    expect(el.querySelector('gr-subagent-page gr-approval-card')).toBeNull();
    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ht2' });
    await fixture.whenStable();
    expect(el.querySelector('gr-subagent-page .line.waiting')).toBeNull();

    // It hands its report back, which reads as its last reply.
    emit('agents.subagentEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h2',
        blocks: [
          {
            kind: 'tool',
            id: 'ht2',
            tool: 'Bash',
            input: { command: 'npm test' },
            result: { text: 'ok', isError: false },
          },
        ],
      },
    });
    emit('agents.subagentEntry', {
      chatId: 'chat-1',
      toolId: 't1',
      entry: {
        kind: 'agent',
        id: 'h3',
        blocks: [
          { kind: 'text', text: 'Handing it back.' },
          {
            kind: 'tool',
            id: 'ht3',
            tool: 'SubagentHandback',
            input: { message: 'It is in **meter.ts**.' },
          },
        ],
      },
    });
    emit('agents.subagentState', { chatId: 'chat-1', toolId: 't1', state: 'done' });
    await fixture.whenStable();
    expect(texts('gr-subagent-page gr-transcript .reply gr-markdown')).toEqual([
      'Found the meter.',
      'Handing it back.',
      'It is in meter.ts.',
    ]);
    expect(texts('gr-subagent-page gr-transcript .note > *')).toEqual([
      'Searched',
      'meter',
      'Tested',
      'npm test',
    ]);
    expect(texts('gr-subagent-page gr-page-footer')).toEqual(['Done']);
    expect(texts('gr-subagent-page .meta')).toEqual(['Explore · Haiku 4.5 · Done']);
  });

  it('names the model a subagent was asked to work on until it says which it works on', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.subagent'] = () => ({ entries: [] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Agent',
            input: { description: 'Look', prompt: 'Look.', model: 'sonnet' },
          },
        ],
      },
    });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-chat-page .note')]
      .find((n) => n.textContent!.includes('Asked a helper'))!
      .click();
    await fixture.whenStable();
    expect(texts('gr-subagent-page .meta')).toEqual(['sonnet · Working…']);
    expect(texts('gr-subagent-page .line')).toEqual(['The helper has only just begun.']);
  });

  it('heads with its effort and how it runs, and foots with what its run took', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.subagent'] = () => ({
      entries: [],
      stats: { effort: 'medium', background: true, depth: 2 },
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Find the meter');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'Agent',
            input: { description: 'Look', prompt: 'Look.', effort: 'low' },
          },
        ],
      },
    });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-chat-page .note')]
      .find((n) => n.textContent!.includes('Asked a helper'))!
      .click();
    await fixture.whenStable();
    expect(texts('gr-subagent-page .meta')).toEqual([
      'Medium effort · Off the page · A helper’s helper · Working…',
    ]);
    expect(texts('gr-subagent-page .took')).toEqual([]);

    emit('agents.subagentStats', {
      chatId: 'chat-1',
      toolId: 't1',
      stats: {
        durationMs: 75_000,
        tokens: 12_000,
        toolUses: 6,
        tools: { read: 4, search: 0, shell: 2, edit: 0, other: 0 },
        lines: { added: 0, removed: 0 },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-subagent-page .took')).toEqual(['1m 15s · 12K tokens · 6 tool calls']);
    expect(el.querySelector('gr-subagent-page .took')!.getAttribute('title')).toBe(
      '4 reads, 2 shell commands',
    );
  });
});
