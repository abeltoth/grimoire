import { TestBed } from '@angular/core/testing';
import type {
  CommandRequest,
  OpenChat,
  Preset,
} from '@grimoire/contract';
import { POPOUT } from './core/popout';
import { provideShellEntries } from './shell/shell-registry';
import { fakeBridge, pick, render, write } from '../testing/app-harness';

describe('App', () => {
  it('marks the background service connected once it answers', async () => {
    const { el } = await render(fakeBridge().bridge);
    expect(el.getAttribute('data-service-state')).toBe('connected');
    expect(el.textContent).not.toContain('Background service unreachable');
  });

  it('says in the page footer when the service is unreachable', async () => {
    const { el } = await render(
      fakeBridge({ invoke: () => Promise.reject(new Error('pipe closed')) }).bridge,
    );
    expect(el.getAttribute('data-service-state')).toBe('failed');
    const alert = el.querySelector('gr-status-indicators .alert')!;
    expect(alert.textContent).toContain('Background service unreachable');
    expect(alert.getAttribute('title')).toBe('pipe closed');
  });

  it('draws window controls on Windows and wires them', async () => {
    const { bridge } = fakeBridge();
    const { el } = await render(bridge);
    el.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click();
    expect(bridge.window.minimize).toHaveBeenCalledOnce();
    expect(bridge.window.close).toHaveBeenCalledOnce();
  });

  it('leaves the window controls to macOS', async () => {
    const { el } = await render(fakeBridge({ platform: 'mac' }).bridge);
    expect(el.querySelector('[aria-label="Close window"]')).toBeNull();
  });

  it('shows the registered page tabs, then the command palette', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-page-tabs button')).toEqual([
      'Table of contents',
      'Front matter',
      'Kanban',
      'Memory map',
      'Scheduled chats',
      'Ledger',
      'Scriptorium',
      'Colophon',
      'Index Ctrl K',
    ]);
  });

  it('prints shortcuts the way the platform writes them', async () => {
    const mac = await render(fakeBridge({ platform: 'mac' }).bridge);
    expect(mac.el.querySelector('gr-page-tabs .command-palette')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Command K',
    );
    expect(mac.texts('gr-page-tabs .gr-kbd')).toEqual(['⌘K']);
    expect(mac.texts('gr-chat-tab.new i')).toEqual(['Last settings · ⌘N']);
    TestBed.resetTestingModule();

    const windows = await render(fakeBridge().bridge);
    expect(windows.el.querySelector('gr-page-tabs .command-palette')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Control K',
    );
    expect(windows.texts('gr-chat-tab.new i')).toEqual(['Last settings · Ctrl+N']);
  });

  it('opens a new blank chat from the New chat tab', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('.meta [data-setting="folder"]')!.click();
    await fixture.whenStable();
    pick(el, '~/git/grimoire');
    await write(fixture, el, 'Fix the flaky login test');

    el.querySelector<HTMLButtonElement>('gr-chat-tab.new button')!.click();
    await fixture.whenStable();
    expect(texts('gr-page-header h1')).toEqual(['Untitled chapter']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
    // The chat tabs keep the order the chats were opened in.
    expect(texts('gr-chat-tab.chat i')).toEqual([
      'Claude Code · thinking',
      'Claude Code · blank page',
    ]);
    expect(texts('.spine gr-chat-tab i')).toEqual(['Claude Code · blank page']);
    // The new chat takes the settings last used.
    expect(texts('.meta button')[4]).toBe('~/git/grimoire');

    // The book opens at the first chat: the one after it moves right of the spine.
    [...el.querySelectorAll<HTMLButtonElement>('gr-chat-tab.chat button')][0]!.click();
    await fixture.whenStable();
    expect(texts('.you p')).toEqual(['Fix the flaky login test']);
    expect(texts('.left-half gr-chat-tab')).toEqual([]);
    expect(texts('.spine gr-chat-tab i')).toEqual(['Claude Code · thinking']);
    expect(texts('.right-half gr-chat-tab.chat i')).toEqual(['Claude Code · blank page']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · thinking']);
  });

  it('opens a chat\'s settings from a right-click on its chat tab', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    el.querySelector('gr-chat-tab.chat button')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Agent']);
  });

  it('searches actions and chats in the command palette, turned to with Ctrl+K', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c7', agent: 'claude-code', title: 'Old notes', cwd: 'C:/Users/me', updatedAt: 0, pins: ['pin', 'star'], tags: [] },
      { id: 'c8', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/grimoire', updatedAt: 1, pins: ['star'], tags: [] },
      { id: 'c9', agent: 'claude-code', title: 'New onboarding flow', cwd: 'C:/Users/me/git/breeder', updatedAt: 2, pins: [], tags: [] },
    ];
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'New onboarding flow',
      settings: request.settings,
      status: 'idle',
      entries: [{ kind: 'user', id: 'u1', text: 'Plan the onboarding' }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],

      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    // The chats arrive from the service a moment later.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(texts('gr-command-palette h2')).toEqual(['Index']);
    expect(texts('gr-command-palette h3')).toEqual(['Actions', 'Chapters']);
    // A pinned chat stays at the top, however old.
    expect(texts('gr-command-palette .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'Close chapter',
      'Single page',
      'Old notes',
      'New onboarding flow',
      'Fix flaky login test',
    ]);
    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    expect(document.activeElement).toBe(field);

    field.value = 'new';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entry .label')).toEqual([
      'New chapter',
      'New chapter from preset',
      'New onboarding flow',
    ]);
    expect(texts('gr-command-palette .entry b')).toEqual(['New', 'New', 'New']);
    expect(texts('gr-command-palette .count')).toEqual(['3 entries']);
    expect(texts('gr-command-palette .entry .gloss')).toEqual([
      'with your last settings',
      'pick a preset first',
      'Claude Code · ~/git/breeder',
    ]);
    expect(texts('gr-command-palette .entry .where .gr-kbd')).toEqual(['Ctrl', 'N']);
    expect(texts('gr-command-palette .entry[aria-selected="true"] .label')).toEqual(['New chapter']);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c9', settings: { cwd: 'C:/Users/me/git/breeder' } },
    ]);
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(texts('gr-page-header h1')).toEqual(['New onboarding flow']);
  });

  it('opens the command palette from its tab, and turns back with Esc', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const notch = el.querySelector<HTMLButtonElement>('gr-page-tabs .command-palette')!;
    notch.click();
    await fixture.whenStable();
    expect(notch.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-command-palette .row .gr-link')).toEqual(['Back to the Outline Esc']);

    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    field.value = 'zzz';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entries .note')).toEqual(['Nothing in the index matches “zzz”.']);
    expect(texts('gr-command-palette .count')).toEqual(['0 entries']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(notch.getAttribute('aria-current')).toBeNull();
  });

  it('turns the right page to a page tab\'s page, blank until its feature is written', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge, [
      provideShellEntries((shell) => shell.pageTabs.add({ id: 'atlas', label: 'Atlas', order: 70 })),
    ]);
    const atlas = [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')].find(
      (tab) => tab.textContent!.trim() === 'Atlas',
    )!;
    atlas.click();
    await fixture.whenStable();
    expect(atlas.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-tab-page .title')).toEqual(['Atlas']);
    expect(texts('gr-tab-page .blank')).toEqual(['Not written yet.']);
    expect(texts('gr-tab-page .row .gr-link')).toEqual(['Back to the Outline Esc']);

    // Its tab again turns back, and so does Esc.
    atlas.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();
    atlas.click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();
    expect(atlas.getAttribute('aria-current')).toBeNull();
  });

  it('begins a chat from a preset listed in the command palette', async () => {
    const { bridge, answers } = fakeBridge();
    answers['presets.list'] = (): Preset[] => [
      {
        name: 'Bug fix',
        agent: 'claude-code',
        settings: { cwd: 'C:/Users/me/git/breeder', model: 'sonnet', mode: 'accept-edits' },
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    field.value = 'preset';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-command-palette .entry .where')).toEqual(['opens a list ›']);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    expect(texts('gr-command-palette h3')).toEqual(['Presets']);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(texts('gr-command-palette .entry .gloss')).toEqual(['Claude Code · Accept edits · ~/git/breeder']);
    // Esc goes back to the whole command palette first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(texts('gr-command-palette h3')).toEqual(['Actions']);
    el.querySelector<HTMLButtonElement>('#gr-command-palette-action-from-preset')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-command-palette .entry')!.click();
    await fixture.whenStable();

    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Default effort',
      'Accept edits',
      '~/git/breeder',
      'Bug fix',
    ]);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('reopens the chats the hub has open, on the one you were on', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string, text: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status: 'idle',
      entries: [{ kind: 'user', id: `${id}-u`, text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', 'Why does login fail?'),
      chat('c2', 'Context meter', 'Add a context meter'),
    ];
    answers['layout.get'] = () => ({ current: 'c2' });
    const { fixture, el, texts } = await render(bridge);

    expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    expect(texts('.you p')).toEqual(['Add a context meter']);
    expect(texts('gr-chat-tab b')).toEqual([
      'Fix flaky login test',
      'Context meter',
      'New chapter',
    ]);

    el.querySelectorAll<HTMLButtonElement>('gr-chat-tab.chat button')[0]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'layout.set').map((c) => c.request)).toEqual([
      { current: 'c1' },
    ]);
  });

  it('closes a chat from the page header, with Ctrl+W, or by middle-clicking its chat tab', async () => {
    const { bridge, calls, answers } = fakeBridge();
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work' },
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [chat('c1', 'One'), chat('c2', 'Two'), chat('c3', 'Three')];
    answers['layout.get'] = () => ({ current: 'c2' });
    const { fixture, el, texts } = await render(bridge);
    const closed = () =>
      calls.filter((c) => c.command === 'agents.close').map((c) => (c.request as { chatId: string }).chatId);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-header .gr-link')]
      .find((b) => b.textContent!.trim() === 'Close')!
      .click();
    await fixture.whenStable();
    expect(closed()).toEqual(['c2']);
    expect(texts('gr-page-header h1')).toEqual(['Three']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    await fixture.whenStable();
    expect(closed()).toEqual(['c2', 'c3']);
    expect(texts('gr-page-header h1')).toEqual(['One']);

    el.querySelector<HTMLButtonElement>('[aria-current="page"]')!.dispatchEvent(
      new MouseEvent('auxclick', { button: 1, bubbles: true }),
    );
    await fixture.whenStable();
    expect(closed()).toEqual(['c2', 'c3', 'c1']);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('opens a new chat with Ctrl+N', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fix the flaky login test');
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('shows the first right page that can be picked', async () => {
    const { el, texts } = await render(fakeBridge().bridge);
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Outline']);
    expect(texts('.tabs [aria-disabled="true"]')).toEqual([]);
    expect(el.querySelector('gr-plan')).not.toBeNull();
  });

  it('shows no indicators or badges without a repository or a schedule', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-status-indicators button')).toEqual([]);
    expect(texts('gr-header-badges button')).toEqual([]);
  });

  it('lays the chat alone on the desk at Single page, and brings everything back at Two pages', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);

    const shown = (selector: string) => el.querySelector(selector) !== null;

    [...el.querySelectorAll<HTMLButtonElement>('gr-right-page .gr-link')]
      .find((link) => link.textContent!.includes('Single page'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.classList).toContain('single');
    expect(shown('gr-title-bar')).toBe(false);
    expect(shown('gr-page-tabs')).toBe(false);
    expect(shown('gr-chat-tabs')).toBe(false);
    expect(shown('gr-right-page')).toBe(false);
    expect(shown('.desk.end gr-window-controls [aria-label="Close window"]')).toBe(true);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: true } });

    // The Command palette comes back beside the chat, and goes again with it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.classList).not.toContain('single');
    expect(shown('gr-right-page gr-command-palette')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(false);
    const labels = [...el.querySelectorAll('gr-command-palette .entry .label')].map((n) => n.textContent!.trim());
    expect(labels).toContain('Two pages');
    expect(labels).not.toContain('Single page');
    expect(el.querySelector('gr-command-palette .gr-link')!.textContent).toContain('Back to the single page');
    expect(el.querySelector('gr-command-palette .hint')!.textContent).not.toContain('thumb notch');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(shown('gr-right-page')).toBe(false);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-header .gr-link')]
      .find((link) => link.textContent!.includes('Two pages'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).not.toContain('focus');
    expect(shown('gr-title-bar')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(true);
    expect(shown('gr-chat-tabs')).toBe(true);
    expect(shown('gr-right-page')).toBe(true);
    expect(shown('.desk')).toBe(false);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: false } });
  });

  it('opens at a single page when the book was left that way', async () => {
    const { bridge, answers } = fakeBridge();
    answers['layout.get'] = () => ({ current: null, lastUsed: null, focus: true });
    const { fixture, el } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.querySelector('gr-title-bar')).toBeNull();
    expect(el.querySelector('gr-right-page')).toBeNull();
  });

  it('notes in the page footer, in focus, the other chats waiting for you', async () => {
    const { bridge, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, approvals: OpenChat['approvals']): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status: approvals.length ? 'waiting' : 'idle',
      entries: [],
      approvals,
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],
      tags: [],
      copied: [],
    });
    const question = {
      question: 'Where should the meter appear?',
      options: [{ label: 'In the composer' }, { label: 'In the running head' }],
      multiSelect: false,
    };
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', [
        { id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' }, at: 1 },
        { id: 's2', chatId: 'c1', tool: 'Bash', input: { command: 'git push' }, at: 2 },
      ]),
      chat('c2', 'Context meter', [
        { id: 'q1', chatId: 'c2', tool: 'AskUserQuestion', input: {}, questions: [question], at: 3 },
      ]),
      chat('c3', 'New onboarding flow', [
        { id: 's3', chatId: 'c3', tool: 'Bash', input: { command: 'npm run build' }, at: 4 },
      ]),
    ];
    answers['layout.get'] = () => ({ current: 'c3', lastUsed: null, focus: true });
    const { fixture, el, texts } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const notes = () => texts('gr-status-indicators .alert');
    const note = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-status-indicators .alert')].find((b) =>
        b.textContent!.includes(text),
      )!;

    // The chat on the desk shows its own approval card on its page.
    expect(notes()).toEqual(['2 approvals awaiting your seal', 'Questions from Context meter']);
    expect(note('awaiting your seal').getAttribute('title')).toBe('From Fix flaky login test');

    note('awaiting your seal').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-right-page')).not.toBeNull();
    expect(el.classList).toContain('focus');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    note('Questions from').click();
    await fixture.whenStable();
    expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    expect(el.classList).toContain('focus');
    expect(notes()).toEqual(['3 approvals awaiting your seal']);
    expect(note('awaiting').getAttribute('title')).toBe(
      'From Fix flaky login test and New onboarding flow',
    );

    // Answered elsewhere, the note goes.
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's1' });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's2' });
    emit('agents.approvalSettled', { chatId: 'c3', approvalId: 's3' });
    await fixture.whenStable();
    expect(notes()).toEqual([]);
  });

  describe('popouts', () => {
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
      pins: [],
      tags: [],
      copied: [],
    });
    const link = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.gr-link')].find((b) => b.textContent!.trim() === label);
    const chatTabs = (texts: (selector: string) => string[]) => texts('gr-chat-tab.chat b');
    /** Lets what the window's closing set off finish. */
    const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };

    it('pops a chat out into a window of its own, and takes it back when that window closes', async () => {
      const { bridge, answers, calls, closePopout } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1' });
      const { fixture, el, texts } = await render(bridge);

      link(el, 'Pop out')!.click();
      await fixture.whenStable();
      expect(bridge.popOut).toHaveBeenCalledWith('c1');
      // It's out of the book; the chat stays open with the agent.
      expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
      expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
      expect(calls.some((c) => c.command === 'agents.close')).toBe(false);

      closePopout('c1');
      await settle(fixture);
      expect(chatTabs(texts)).toEqual(['Fix flaky login test', 'Context meter']);
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);

      // A popout closed with its chat doesn't bring it back.
      link(el, 'Pop out')!.click();
      await fixture.whenStable();
      answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
      closePopout('c1');
      await settle(fixture);
      expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
    });

    it('opens the book without the chats popped out', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c2', popouts: [{ chatId: 'c1' }] });
      const { texts } = await render(bridge);
      expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
      expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
    });

    it('pops out the chat on the right page, but not a blank one', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      link(el.querySelector('gr-chat-page[beside]')!, 'Pop out')!.click();
      await fixture.whenStable();
      expect(bridge.popOut).toHaveBeenCalledWith('c2');
      expect(el.querySelector('gr-chat-page[beside]')).toBeNull();
      expect(texts('gr-second-chat .none')).toEqual(['No other chapter is open.']);

      [...el.querySelectorAll<HTMLButtonElement>('gr-second-chat .gr-link')]
        .find((b) => b.textContent!.trim() === 'A new chapter')!
        .click();
      await fixture.whenStable();
      expect(link(el.querySelector('gr-chat-page[beside]')!, 'Pop out')).toBeUndefined();
    });

    describe('in its own window', () => {
      const popout = (id: string) => [{ provide: POPOUT, useValue: id }];

      it('holds its one chat alone on the desk, and goes back in the book', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c1', 'Context meter'), chat('c2', 'Fix flaky login test')];
        answers['layout.get'] = () => ({ current: 'c1', focus: true });
        const { fixture, el, texts } = await render(bridge, popout('c2'));
        expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
        for (const part of ['gr-title-bar', 'gr-chat-tabs', 'gr-page-tabs', 'gr-right-page'])
          expect(el.querySelector(part)).toBeNull();
        expect(el.querySelector('gr-window-controls')).not.toBeNull();
        expect(link(el, 'Pop out')).toBeUndefined();
        expect(link(el, 'Two pages')).toBeUndefined();
        expect(el.querySelector('gr-composer button[aria-label^="Parallel texts"]')).toBeNull();
        // It doesn't move the book's place, or listen for popouts.
        expect(calls.filter((c) => c.command === 'layout.set')).toEqual([]);
        expect(bridge.onPopoutClosed).not.toHaveBeenCalled();

        link(el, 'Back in the book')!.click();
        await fixture.whenStable();
        expect(bridge.window.close).toHaveBeenCalled();
      });

      it('lists the agent\'s commands on its own page, above the message field', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        answers['agents.commands'] = () => [{ name: 'compact', description: 'Free up context', kind: 'command' }];
        const { fixture, el, texts } = await render(bridge, popout('c2'));
        const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
        field.value = '/';
        field.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        expect(texts('gr-chat-page gr-slash-commands .entry .label')).toEqual(['/compact']);
        expect(el.querySelector('gr-slash-commands gr-page-footer')).toBeNull();
        expect(el.querySelector('gr-transcript')).toBeNull();
        expect(el.querySelector('#gr-next-message')).toBe(field);
        expect(texts('gr-composer .slash-hint')).toEqual(['Claude Code’s commands and skills are listed above ↑']);

        field.value = '';
        field.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        expect(el.querySelector('gr-slash-commands')).toBeNull();
        expect(el.querySelector('gr-transcript')).not.toBeNull();
      });

      it('closes its window when its chat closes, or isn\'t open', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        const { fixture, el } = await render(bridge, popout('c2'));
        link(el, 'Close')!.click();
        await fixture.whenStable();
        expect(calls).toContainEqual({ command: 'agents.close', request: { chatId: 'c2' } });
        expect(bridge.window.close).toHaveBeenCalled();

        TestBed.resetTestingModule();
        const other = fakeBridge();
        other.answers['agents.openChats'] = () => [];
        await render(other.bridge, popout('c2'));
        expect(other.bridge.window.close).toHaveBeenCalled();
      });

      it('pops a fork out as a popout of its own', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
        answers['agents.fork'] = () => chat('c3', 'Fix flaky login test (a)');
        const { fixture, el, texts } = await render(bridge, popout('c2'));
        [...el.querySelectorAll<HTMLButtonElement>('.you .by button')]
          .find((b) => b.textContent!.trim() === 'Fork')!
          .click();
        await fixture.whenStable();
        expect(bridge.popOut).toHaveBeenCalledWith('c3');
        expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
      });
    });
  });
});
