import {
  type Card,
  type CommandRequest,
  DEFAULT_SETTINGS,
  type OpenChat,
} from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-testing';
import {
  card,
  withBoard,
  TRANSITIONS,
  issue,
  openBoard,
  openJira,
  showTab,
  cardEl,
  button,
  board,
  drag,
} from './kanban-testing';

describe('kanban-page', () => {
  it('moves cards with Move to, keeping the one moved in reach of the keyboard, and by dragging them', async () => {
    const { bridge, calls } = withBoard([
      card('a', 'A', 'todo'),
      card('b', 'B', 'todo'),
      card('c', 'C', 'doing'),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);

    button(cardEl(el, 'A'), 'Move to…').click();
    await fixture.whenStable();
    expect(texts('[data-card="a"] .moves button')).toEqual([
      'In progress',
      'Done',
      'Down',
      'Cancel',
    ]);
    expect(document.activeElement!.textContent!.trim()).toBe('In progress');
    button(cardEl(el, 'A'), 'Done').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['B'], doing: ['C'], done: ['A'] });
    expect(document.activeElement!.closest('[data-card]')!.getAttribute('data-card')).toBe('a');
    expect(document.activeElement!.classList).toContain('move');

    button(cardEl(el, 'C'), 'Move to…').click();
    await fixture.whenStable();
    button(cardEl(el, 'C'), 'Done').click();
    await fixture.whenStable();
    button(cardEl(el, 'C'), 'Move to…').click();
    await fixture.whenStable();
    button(cardEl(el, 'C'), 'Up').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['B'], doing: [], done: ['C', 'A'] });

    // Dropped on a card, it goes before it; dropped in a column, at its foot.
    drag('dragstart', cardEl(el, 'B'));
    drag('dragover', cardEl(el, 'C'));
    await fixture.whenStable();
    expect(el.querySelector('[aria-labelledby="gr-kanban-done"]')!.classList).toContain('over');
    expect(cardEl(el, 'B').classList).toContain('dragged');
    drag('drop', cardEl(el, 'C'));
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: [], doing: [], done: ['B', 'C', 'A'] });
    expect(el.querySelector('.column.over, .card.dragged')).toBeNull();
    drag('dragstart', cardEl(el, 'A'));
    drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-doing"]')!);
    drag('drop', el.querySelector('[aria-labelledby="gr-kanban-doing"] h3')!);
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: [], doing: ['A'], done: ['B', 'C'] });
    expect(calls.filter((c) => c.command === 'kanban.move').map((c) => c.request)).toEqual([
      { id: 'a', column: 'done' },
      { id: 'c', column: 'done' },
      { id: 'c', column: 'done', before: 'a' },
      { id: 'b', column: 'done', before: 'c' },
      { id: 'a', column: 'doing' },
    ]);
  });

  it('opens a new chat from a card with its task written in, unsent; its first message puts the card in progress', async () => {
    const { bridge, calls, answers, emit } = withBoard([
      card('a', 'Context meter', 'todo', { notes: 'Fill it in from the usage events.' }),
    ]);
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'Context meter',
      settings: request.settings,
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);

    button(cardEl(el, 'Context meter'), 'New chapter').click();
    await fixture.whenStable();
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-message')!.value).toBe(
      'Context meter\n\nFill it in from the usage events.',
    );
    expect(texts('.meta button')).toContain('~/git/grimoire');
    expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
    // Again, it turns to that blank chat rather than open another.
    const chats = el.querySelectorAll('gr-chat-tab.chat').length;
    button(cardEl(el, 'Context meter'), 'New chapter').click();
    await fixture.whenStable();
    expect(el.querySelectorAll('gr-chat-tab.chat')).toHaveLength(chats);
    expect(
      calls.filter((c) => c.command === 'agents.start' || c.command === 'kanban.link'),
    ).toEqual([]);
    expect(board(texts).todo).toEqual(['Context meter']);

    await write(fixture, el, 'Context meter\n\nFill it in from the usage events.');
    const start = calls.find((c) => c.command === 'agents.start')!
      .request as CommandRequest<'agents.start'>;
    expect(start.settings.cwd).toBe('C:/Users/me/git/grimoire');
    expect(calls.filter((c) => c.command === 'kanban.link').map((c) => c.request)).toEqual([
      { id: 'a', chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/grimoire' },
    ]);
    expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
    expect(texts('[data-card="a"] .chats li')).toEqual(['Untitled chapter thinking']);
    emit('agents.title', { chatId: 'chat-1', title: 'Context meter', by: 'agent' });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();
    expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter waiting for you']);
    expect(el.querySelector('[data-card="a"] .status gr-icon')!.classList).toContain('breathe');

    // Closed, it's opened again from the card.
    button(el.querySelector('gr-chat-page gr-page-header')!, 'Close').click();
    await fixture.whenStable();
    expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter not open']);
    el.querySelector<HTMLButtonElement>('[data-card="a"] .chat')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'chat-1',
      settings: { cwd: 'C:/Users/me/git/grimoire' },
    });
    expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter idle']);
  });

  it('closes a card, keeping it under the board, and opens it again', async () => {
    const { bridge, calls } = withBoard([
      card('a', 'A', 'todo'),
      card('b', 'Set up the Angular project', 'done'),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    expect(el.querySelector('gr-kanban-page .closed')).toBeNull();

    button(cardEl(el, 'Set up the Angular project'), 'Close').click();
    await fixture.whenStable();
    expect(board(texts).done).toEqual([]);
    expect(texts('gr-kanban-page .closed > button')).toEqual(['Show the closed card']);
    el.querySelector<HTMLButtonElement>('gr-kanban-page .closed > button')!.click();
    await fixture.whenStable();
    expect(texts('gr-kanban-page .closed li')).toEqual([
      'Set up the Angular project Done · ~/git/grimoire Reopen',
    ]);

    button(el.querySelector('gr-kanban-page .closed')!, 'Reopen').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.close').map((c) => c.request)).toEqual([
      { id: 'b', closed: true },
      { id: 'b', closed: false },
    ]);
    expect(board(texts).done).toEqual(['Set up the Angular project']);
    expect(el.querySelector('gr-kanban-page .closed')).toBeNull();
  });

  it('shows one folder’s cards only, when you pick it', async () => {
    const { bridge } = withBoard([
      card('a', 'A', 'todo'),
      card('b', 'B', 'doing', { cwd: 'C:/Users/me/git/breeder' }),
      card('c', 'C', 'done'),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    expect(texts('gr-kanban-page .folders button')).toEqual([
      'All',
      '~/git/grimoire',
      '~/git/breeder',
    ]);
    expect(texts('gr-kanban-page .folders [aria-checked="true"]')).toEqual(['All']);

    button(el.querySelector('gr-kanban-page .folders')!, '~/git/breeder').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: [], doing: ['B'], done: [] });
    button(el.querySelector('gr-kanban-page .folders')!, 'All').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['A'], doing: ['B'], done: ['C'] });
  });

  it('notes a task the agent added, turning to the board, where its card links back to the chat', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    let cards: Card[] = [];
    answers['kanban.list'] = () => cards;
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'Track the meter',
      settings: request.settings,
      status: 'idle',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const cwd = 'C:/Users/me/git/grimoire';
    answers['layout.get'] = () => ({
      current: null,
      lastUsed: { agent: 'claude-code', settings: { cwd } },
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Put the context meter on the board');
    emit('agents.title', { chatId: 'chat-1', title: 'Track the meter', by: 'agent' });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          {
            kind: 'tool',
            id: 't1',
            tool: 'mcp__grimoire__add_todo',
            input: { title: 'Context meter', notes: 'Fill it in from the usage events.' },
            result: {
              text: 'Added "Context meter" to To do on the user\'s Kanban board.',
              isError: false,
            },
          },
          { kind: 'text', text: 'It’s on the board.' },
        ],
      },
    });
    cards = [
      card('a', 'Context meter', 'todo', {
        madeIn: { chatId: 'chat-1', agent: 'claude-code', cwd },
      }),
    ];
    emit('kanban.changed', { cards });
    await fixture.whenStable();

    expect(texts('gr-chat-page .note > *')).toEqual(['Added to the board', 'Context meter']);
    el.querySelector<HTMLButtonElement>('gr-chat-page .note')!.click();
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
    expect(el.querySelector('gr-output')).toBeNull();
    expect(board(texts).todo).toEqual(['Context meter']);
    expect(texts('[data-card="a"] .made-in')).toEqual(['From Claude Code, in Track the meter']);
    expect(el.querySelector('[data-card="a"] .chats')).toBeNull();

    // Closed, the chat is opened again from the card.
    button(el.querySelector('gr-chat-page gr-page-header')!, 'Close').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-card="a"] .made-in .chat')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'chat-1',
      settings: { cwd },
    });
    expect(texts('gr-chat-page .note > *')).toEqual([]);
    expect(calls.filter((c) => c.command === 'kanban.link')).toEqual([]);
  });

  it('shows your Jira issues as cards of their own, on a tab beside your tasks, each opening in Jira', async () => {
    const synced = new Date(2026, 10, 8, 9, 5).getTime();
    // The page says "synced at" only for a sync made today.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 12, 0));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { bridge, calls, answers } = withBoard([
      card('a', 'Mine', 'doing'),
      issue('j1', 'GRIM-12', 'Context meter', 'doing', { notes: 'Fill it in.' }),
    ]);
    answers['kanban.jira'] = () => ({ status: 'synced', syncedAt: synced, syncing: false });
    answers['kanban.syncJira'] = () => ({ status: 'synced', syncedAt: synced, syncing: false });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    // Opening the board syncs them, unless that was done a minute ago.
    expect(calls.filter((c) => c.command === 'kanban.syncJira').map((c) => c.request)).toEqual([
      { ifOlderThan: 60_000 },
    ]);

    // Your tasks show first, and the issues on a tab of their own.
    expect(texts('gr-kanban-page .tabs [aria-selected="true"]')).toEqual(['My tasks']);
    expect(board(texts).doing).toEqual(['Mine']);
    expect(cardEl(el, 'Mine').classList).not.toContain('jira');
    expect(texts('[data-card="a"] .actions button')).toEqual([
      'New chapter',
      'Move to…',
      'Change',
      'Close',
    ]);
    expect(el.querySelector('gr-kanban-page .jira-sync')).toBeNull();
    await showTab(fixture, el, 'Jira');
    expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
    expect(el.querySelector('gr-kanban-page .card.new')).toBeNull();
    const jira = cardEl(el, 'Context meter');
    expect(jira.classList).toContain('jira');
    expect(texts('[data-card="j1"] .issue > *')).toEqual(['Jira', 'GRIM-12', 'Bug', 'High']);
    expect(texts('[data-card="j1"] .notes')).toEqual(['Fill it in.']);
    expect(texts('[data-card="j1"] .where')).toEqual(['In Review']);
    expect(texts('[data-card="j1"] .actions button')).toEqual([
      'New chapter',
      'Move to…',
      'Change status…',
      'Open in Jira',
      'Close',
    ]);

    // It keeps Jira's order in its column.
    button(jira, 'Move to…').click();
    await fixture.whenStable();
    expect(texts('[data-card="j1"] .moves button')).toEqual(['To do', 'Done', 'Cancel']);
    button(jira, 'Cancel').click();
    await fixture.whenStable();
    drag('dragstart', jira);
    drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-doing"]')!);
    drag('drop', el.querySelector('[aria-labelledby="gr-kanban-doing"] h3')!);
    await fixture.whenStable();
    expect(board(texts).doing).toEqual(['Context meter']);
    expect(
      calls.filter((c) => c.command === 'kanban.move' || c.command === 'kanban.transitions'),
    ).toEqual([]);

    button(jira, 'Open in Jira').click();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://acme.atlassian.net/browse/GRIM-12');

    // Where they stand shows above the board, with a refresh.
    const time = new Date(synced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(texts('gr-kanban-page .jira-sync > *')).toEqual([
      'Jira',
      `synced at ${time}`,
      'Refresh',
    ]);
    button(el.querySelector('gr-kanban-page .jira-sync')!, 'Refresh').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.syncJira').at(-1)!.request).toEqual({});

    // Closed, it says its status and key.
    button(jira, 'Close').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-kanban-page .closed > button')!.click();
    await fixture.whenStable();
    expect(texts('gr-kanban-page .closed li')).toEqual([
      'Context meter In Review · GRIM-12 Reopen',
    ]);
  });

  it('opens a chat from a Jira card with its key, summary and description written in, where the board shows', async () => {
    const { bridge, calls, answers } = withBoard([
      card('a', 'A', 'todo'),
      card('b', 'B', 'todo', { cwd: 'C:/Users/me/git/breeder' }),
      issue('j1', 'GRIM-12', 'Context meter', 'todo', {
        notes: 'Fill it in.\n\n- From the usage events',
      }),
    ]);
    answers['layout.get'] = () => ({
      current: null,
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/Users/me/git/grimoire' } },
    });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    // It belongs to no folder: it shows whichever is picked.
    expect(texts('gr-kanban-page .folders button')).toEqual([
      'All',
      '~/git/grimoire',
      '~/git/breeder',
    ]);
    button(el.querySelector('gr-kanban-page .folders')!, '~/git/breeder').click();
    await fixture.whenStable();
    expect(board(texts).todo).toEqual(['B']);
    await showTab(fixture, el, 'Jira');
    expect(board(texts).todo).toEqual(['Context meter']);

    button(cardEl(el, 'Context meter'), 'New chapter').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-message')!.value).toBe(
      'GRIM-12: Context meter\n\nFill it in.\n\n- From the usage events',
    );
    await write(fixture, el, 'GRIM-12: Context meter');
    const start = calls.find((c) => c.command === 'agents.start')!
      .request as CommandRequest<'agents.start'>;
    expect(start.settings.cwd).toBe('C:/Users/me/git/breeder');
    expect(calls.filter((c) => c.command === 'kanban.link').map((c) => c.request)).toEqual([
      { id: 'j1', chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' },
    ]);
    // Its chat is listed on it, which stays where Jira has it.
    expect(board(texts).todo).toEqual(['Context meter']);
    expect(texts('[data-card="j1"] .chats li')).toEqual(['Untitled chapter thinking']);
  });

  it('moves a Jira card dragged into another column in Jira, there at once, by the one status Jira allows there', async () => {
    const { bridge, calls, jira } = withBoard([
      card('a', 'Mine', 'todo'),
      issue('j1', 'GRIM-12', 'Context meter', 'todo'),
      issue('j2', 'GRIM-13', 'Night theme', 'done'),
    ]);
    let answer!: () => void;
    jira.wait = new Promise((resolve) => (answer = resolve));
    const { fixture, el, texts } = await render(bridge);
    await openJira(fixture, el);
    const meter = cardEl(el, 'Context meter');
    expect(meter.getAttribute('draggable')).toBe('true');
    drag('dragstart', meter);
    drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-done"]')!);
    drag('drop', cardEl(el, 'Night theme'));
    await fixture.whenStable();
    // It's there at once, at the column's foot, while Jira moves it.
    expect(board(texts)).toEqual({ todo: [], doing: [], done: ['Night theme', 'Context meter'] });
    expect(texts('[data-card="j1"] .status-name')).toEqual(['Done']);
    expect(texts('[data-card="j1"] .actions')).toEqual(['Moving in Jira…']);
    expect(cardEl(el, 'Context meter').getAttribute('draggable')).toBe('false');
    expect(calls.filter((c) => c.command === 'kanban.transitions').map((c) => c.request)).toEqual([
      { id: 'j1', column: 'done' },
    ]);
    expect(calls.filter((c) => c.command === 'kanban.transition').map((c) => c.request)).toEqual([
      { id: 'j1', transition: TRANSITIONS[2] },
    ]);
    expect(calls.filter((c) => c.command === 'kanban.move')).toEqual([]);

    answer();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    // Moved, it's where Jira's order puts it.
    expect(board(texts).done).toEqual(['Context meter', 'Night theme']);
    expect(texts('[data-card="j1"] .actions button')).toContain('Change status…');
    expect(el.querySelector('[data-card="j1"] .jira-note')).toBeNull();
  });

  it('offers the statuses Jira allows in a column when it allows several, back where it was when cancelled', async () => {
    const { bridge, calls } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo')]);
    const { fixture, el, texts } = await render(bridge);
    await openJira(fixture, el);

    button(cardEl(el, 'Context meter'), 'Move to…').click();
    await fixture.whenStable();
    button(cardEl(el, 'Context meter'), 'In progress').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
    expect(texts('[data-card="j1"] .moves > *')).toEqual([
      'Move to',
      'In Progress',
      'In Review',
      'Cancel',
    ]);
    expect(document.activeElement!.textContent!.trim()).toBe('In Progress');
    button(cardEl(el, 'Context meter'), 'Cancel').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['Context meter'], doing: [], done: [] });
    expect(calls.filter((c) => c.command === 'kanban.transition')).toEqual([]);

    drag('dragstart', cardEl(el, 'Context meter'));
    drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-doing"]')!);
    drag('drop', el.querySelector('[aria-labelledby="gr-kanban-doing"] h3')!);
    await fixture.whenStable();
    button(cardEl(el, 'Context meter'), 'In Review').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.transition').map((c) => c.request)).toEqual([
      { id: 'j1', transition: TRANSITIONS[1] },
    ]);
    expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
    expect(texts('[data-card="j1"] .status-name')).toEqual(['In Review']);
  });

  it('puts a Jira card back, saying so, where Jira allows no status in the column', async () => {
    const { bridge, calls, jira } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo')]);
    jira.transitions = TRANSITIONS.filter((t) => t.column !== 'done');
    const { fixture, el, texts } = await render(bridge);
    await openJira(fixture, el);
    drag('dragstart', cardEl(el, 'Context meter'));
    drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-done"]')!);
    drag('drop', el.querySelector('[aria-labelledby="gr-kanban-done"] h3')!);
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['Context meter'], doing: [], done: [] });
    expect(texts('[data-card="j1"] .jira-note')).toEqual([
      'Jira doesn’t allow moving from To Do to Done',
    ]);
    expect(calls.filter((c) => c.command === 'kanban.transition')).toEqual([]);
  });

  it('changes a Jira card’s status to any Jira allows, in its own column too', async () => {
    const { bridge, calls } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo')]);
    const { fixture, el, texts } = await render(bridge);
    await openJira(fixture, el);
    button(cardEl(el, 'Context meter'), 'Change status…').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.transitions').map((c) => c.request)).toEqual([
      { id: 'j1' },
    ]);
    expect(texts('[data-card="j1"] .moves > *')).toEqual([
      'Change status to',
      'In Progress',
      'In Review',
      'Done',
      'Backlog',
      'Cancel',
    ]);
    button(cardEl(el, 'Context meter'), 'Backlog').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.transition').map((c) => c.request)).toEqual([
      { id: 'j1', transition: TRANSITIONS[3] },
    ]);
    expect(board(texts).todo).toEqual(['Context meter']);
    expect(texts('[data-card="j1"] .status-name')).toEqual(['Backlog']);
  });

  it('puts a Jira card back when Jira refuses, saying what Jira said, and offers to open it in Jira', async () => {
    const { bridge, jira } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo')]);
    jira.refuse = 'Jira didn’t move GRIM-12 to Done: Resolution is required.';
    const { fixture, el, texts } = await render(bridge);
    await openJira(fixture, el);
    button(cardEl(el, 'Context meter'), 'Move to…').click();
    await fixture.whenStable();
    button(cardEl(el, 'Context meter'), 'Done').click();
    await fixture.whenStable();
    expect(board(texts)).toEqual({ todo: ['Context meter'], doing: [], done: [] });
    expect(texts('[data-card="j1"] .status-name')).toEqual(['To Do']);
    expect(texts('[data-card="j1"] .jira-note')).toEqual([
      'Jira didn’t move GRIM-12 to Done: Resolution is required. Open in Jira',
    ]);
    button(el.querySelector('[data-card="j1"] .jira-note')!, 'Open in Jira').click();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://acme.atlassian.net/browse/GRIM-12');
    expect(el.querySelector('gr-kanban-page .error')).toBeNull();

    // The next move leaves the note.
    jira.refuse = '';
    button(cardEl(el, 'Context meter'), 'Move to…').click();
    await fixture.whenStable();
    button(cardEl(el, 'Context meter'), 'Done').click();
    await fixture.whenStable();
    expect(board(texts).done).toEqual(['Context meter']);
    expect(el.querySelector('[data-card="j1"] .jira-note')).toBeNull();
  });

  it('shows no Jira issues, nor their tab, and syncs none, while Jira is turned off', async () => {
    const { bridge, calls, answers } = withBoard([
      card('a', 'Mine', 'todo'),
      issue('j1', 'GRIM-12', 'Context meter', 'todo'),
    ]);
    answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, jira: false });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    expect(board(texts).todo).toEqual(['Mine']);
    expect(el.querySelector('gr-kanban-page .tabs')).toBeNull();
    expect(el.querySelector('gr-kanban-page .jira-sync')).toBeNull();
    expect(calls.filter((c) => c.command === 'kanban.syncJira')).toEqual([]);
  });

  it('says quietly when Jira can’t be reached, and nothing where there’s no Atlassian connector', async () => {
    const { bridge, answers, emit } = withBoard([card('a', 'Mine', 'todo')]);
    answers['kanban.jira'] = () => ({ status: 'none', syncing: false });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    expect(el.querySelector('gr-kanban-page .jira-sync')).toBeNull();
    emit('kanban.jira', { jira: { status: 'none', syncing: true } });
    await fixture.whenStable();
    expect(el.querySelector('gr-kanban-page .jira-sync')).toBeNull();

    emit('kanban.jira', { jira: { status: 'needs-auth', syncing: false } });
    await fixture.whenStable();
    await showTab(fixture, el, 'Jira');
    expect(texts('gr-kanban-page .jira-sync > *')).toEqual([
      'Jira',
      'the Atlassian connector needs connecting again on claude.ai',
      'Refresh',
    ]);
    emit('kanban.jira', { jira: { status: 'failed', error: 'HTTP 503', syncing: false } });
    await fixture.whenStable();
    expect(texts('gr-kanban-page .jira-sync > *')).toEqual([
      'Jira',
      'couldn’t sync: HTTP 503',
      'Refresh',
    ]);
    emit('kanban.jira', { jira: { status: 'failed', error: 'HTTP 503', syncing: true } });
    await fixture.whenStable();
    expect(texts('gr-kanban-page .jira-sync > *')).toEqual(['Jira', 'syncing…', 'Refresh']);
    expect(button(el.querySelector('gr-kanban-page .jira-sync')!, 'Refresh').disabled).toBe(true);
  });
});
