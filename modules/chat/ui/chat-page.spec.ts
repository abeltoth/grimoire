import type { CommandName, GrimoireBridge, OpenChat } from '@grimoire/contract';
import { fakeBridge, pick, render, write } from '@ui/testing/app-harness';

describe('chat-page', () => {
  it('opens on a blank chat', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-page-header h1')).toEqual(['Untitled chapter']);
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high effort',
      'Ask first',
      '~',
      'No preset',
    ]);
    expect(texts('.spine gr-chat-tab b')).toEqual(['Untitled chapter']);
    expect(texts('.spine gr-chat-tab i')).toEqual(['Claude Code · blank page']);
    expect(texts('.right-half gr-chat-tab b')).toEqual(['New chapter']);
    expect(texts('gr-chat-intro p')).toEqual([
      'A new chapter',
      expect.stringMatching(/^Begun at .+, to be written by Claude Code$/),
      'Write your first entry on the page below. Claude Code works in your home folder and asks before it edits a file or runs a command.',
    ]);
    expect(document.querySelector('#gr-next-message')!.getAttribute('placeholder')).toBe(
      'Write the first entry…',
    );
    expect(texts('gr-transcript')).toEqual([]);
  });

  it('says why a chat could not start', async () => {
    const { bridge } = fakeBridge();
    const answer = bridge.invoke;
    bridge.invoke = ((command: CommandName, request: never) =>
      command === 'agents.start'
        ? Promise.reject(new Error('Claude Code is not signed in'))
        : answer(command, request)) as GrimoireBridge['invoke'];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    expect(texts('[role="alert"]')).toEqual(['Claude Code is not signed in']);
    expect(texts('gr-page-header h1')).toEqual(['Untitled chapter']);
  });

  describe('a chat that only reads, as another edits its project', () => {
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
      copied: [],
      ...more,
    });
    const reading = { readOnly: { chatId: 'c1', title: 'Context meter' } };

    it('says so in its page header, and is made the editing chat when you ask', async () => {
      const { bridge, calls, emit, answers } = fakeBridge();
      answers['agents.openChats'] = () => [opened('c1', 'Context meter'), opened('c2', 'Explain it', reading)];
      answers['layout.get'] = () => ({ current: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      expect(texts('gr-page-header .read-only p')).toEqual(['Read-only — “Context meter” is editing']);
      expect(texts('gr-page-header .read-only button')).toEqual(['Make this the editing chapter']);
      expect(texts('.meta [data-setting="mode"]')).toEqual(['Accept edits']);

      el.querySelector<HTMLButtonElement>('gr-page-header .read-only button')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({ command: 'agents.takeOver', request: { chatId: 'c2' } });
      emit('agents.readOnly', { chatId: 'c2', readOnly: null });
      await fixture.whenStable();
      expect(el.querySelector('gr-page-header .read-only')).toBeNull();
      expect(texts('.meta [data-setting="mode"]')).toEqual(['Accept edits']);

      // Another chat took over, one not named yet.
      emit('agents.readOnly', { chatId: 'c2', readOnly: { chatId: 'c3', title: '' } });
      await fixture.whenStable();
      expect(texts('gr-page-header .read-only p')).toEqual(['Read-only — “Untitled chapter” is editing']);
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

    it('approves its plan as any approval, without making it the editing chat', async () => {
      const { bridge, calls, answers } = fakeBridge();
      const plan = { id: 'p1', chatId: 'c2', tool: 'ExitPlanMode', input: { plan: 'Add the meter' } };
      answers['agents.openChats'] = () => [
        opened('c1', 'Context meter'),
        opened('c2', 'Explain it', { ...reading, status: 'waiting', approvals: [plan] }),
      ];
      answers['layout.get'] = () => ({ current: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      expect(texts('gr-approval-card .approve-button')).toEqual(['Allow once ⏎']);
      expect(texts('gr-approval-card .deny')).toEqual(['Deny Esc']);

      el.querySelector<HTMLButtonElement>('gr-approval-card .approve-button')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.decide').map((c) => c.request)).toEqual([
        { approvalId: 'p1', decision: 'allow-once' },
      ]);
      expect(calls.some((c) => c.command === 'agents.takeOver')).toBe(false);
    });
  });

  it('undoes a message\'s edits, and marks them withdrawn', async () => {
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
    // Only the first message's edit is left to undo.
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

  it('forks a chat into a variant and turns to it', async () => {
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
    expect(texts('gr-page-header h1')).toEqual(['Context meter (a)']);
    expect(texts('gr-chat-tab b')).toEqual(['Context meter', 'Context meter (a)', 'New chapter']);
  });

  it('renames a chat in place with the pen beside its title', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['rename'] }];
    const { fixture, el, texts } = await render(bridge);
    await fixture.whenStable();
    const pen = () => el.querySelector<HTMLButtonElement>('[aria-label="Rename chapter"]');
    const field = () => el.querySelector<HTMLInputElement>('gr-page-header input.rename');
    const rename = async (title: string, key: string) => {
      pen()!.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(field());
      field()!.value = title;
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };

    // A blank chat starts with the title you gave it.
    await rename('Login bug', 'Enter');
    expect(texts('gr-page-header h1')).toEqual(['Login bug']);
    await write(fixture, el, 'First');
    expect(calls.find((c) => c.command === 'agents.start')!.request).toMatchObject({ title: 'Login bug' });

    await rename('  Flaky login test ', 'Enter');
    expect(calls.filter((c) => c.command === 'agents.rename').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', title: 'Flaky login test' },
    ]);
    expect(texts('gr-page-header h1')).toEqual(['Flaky login test']);
    expect(document.activeElement).toBe(pen());

    // Esc puts the title back, and leaves the turn running.
    await rename('Something else', 'Escape');
    expect(texts('gr-page-header h1')).toEqual(['Flaky login test']);
    expect(calls.filter((c) => c.command === 'agents.rename')).toHaveLength(1);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
  });

  it('leaves the pen out for agents that can\'t rename their chats', async () => {
    const { bridge } = fakeBridge();
    const { el } = await render(bridge);
    expect(el.querySelector('[aria-label="Rename chapter"]')).toBeNull();
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
});
