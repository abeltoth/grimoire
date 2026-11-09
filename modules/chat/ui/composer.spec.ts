import type { GrimoireSettings, OpenChat } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('composer', () => {
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
});
