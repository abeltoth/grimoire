import type {
  Card,
  CardColumn,
  CardDraft,
  CommandRequest,
  JiraTransition,
  OpenChat,
} from '@grimoire/contract';
import { CARD_COLUMNS } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('kanban', () => {
  describe('the Kanban board', () => {
    const card = (id: string, title: string, column: CardColumn, change: Partial<Card> = {}): Card => ({
      id,
      kind: 'task',
      title,
      notes: '',
      cwd: 'C:/Users/me/git/grimoire',
      column,
      createdAt: 0,
      chats: [],
      ...change,
    });

    /** A fake service keeping the cards as the service does: column by column, each change told to windows. */
    function withBoard(start: Card[] = []) {
      const fake = fakeBridge();
      let cards = start;
      let next = start.length + 1;
      const sorted = (all: Card[]) =>
        [...all].sort((a, b) => CARD_COLUMNS.indexOf(a.column) - CARD_COLUMNS.indexOf(b.column));
      const changed = (all: Card[]) => {
        cards = sorted(all);
        fake.emit('kanban.changed', { cards });
        return cards;
      };
      const place = (id: string, column: CardColumn, before?: string) => {
        const moved = { ...cards.find((c) => c.id === id)!, column };
        const rest = cards.filter((c) => c.id !== id);
        const at = before ? rest.findIndex((c) => c.id === before) : -1;
        rest.splice(at === -1 ? rest.length : at, 0, moved);
        return rest;
      };
      fake.answers['kanban.list'] = () => cards;
      fake.answers['kanban.save'] = ({ id, ...draft }: CardDraft) =>
        changed(
          id
            ? cards.map((c) => (c.id === id ? { ...c, ...draft } : c))
            : [...cards, card(`card-${next++}`, draft.title, 'todo', draft)],
        );
      fake.answers['kanban.move'] = ({ id, column, before }: CommandRequest<'kanban.move'>) =>
        changed(place(id, column, before));
      fake.answers['kanban.close'] = ({ id, closed }: CommandRequest<'kanban.close'>) =>
        changed(
          cards.map((c) => {
            if (c.id !== id) return c;
            const { closedAt: _, ...open } = c;
            return closed ? { ...open, closedAt: Date.now() } : open;
          }),
        );
      fake.answers['kanban.link'] = ({ id, ...chat }: CommandRequest<'kanban.link'>) => {
        cards = cards.map((c) => (c.id === id ? { ...c, chats: [...c.chats, { ...chat, at: 0 }] } : c));
        const linked = cards.find((c) => c.id === id)!;
        return changed(linked.kind === 'task' && linked.column === 'todo' ? place(id, 'doing') : cards);
      };
      /** Jira: the transitions it allows, what it says as it refuses one, and a change answered once `wait` is. */
      const jira = { transitions: TRANSITIONS, refuse: '', wait: Promise.resolve() };
      fake.answers['kanban.transitions'] = ({ column }: CommandRequest<'kanban.transitions'>) =>
        jira.transitions.filter((t) => !column || t.column === column);
      fake.answers['kanban.transition'] = async ({ id, transition }: CommandRequest<'kanban.transition'>) => {
        await jira.wait;
        if (jira.refuse) throw new Error(jira.refuse);
        return changed(
          cards.map((c) =>
            c.id === id ? { ...c, column: transition.column, jira: { ...c.jira!, status: transition.status } } : c,
          ),
        );
      };
      return { ...fake, jira };
    }

    /** The statuses Jira allows an issue in To Do. */
    const TRANSITIONS: JiraTransition[] = [
      { id: '11', name: 'Start', status: 'In Progress', column: 'doing' },
      { id: '21', name: 'Review', status: 'In Review', column: 'doing' },
      { id: '31', name: 'Finish', status: 'Done', column: 'done' },
      { id: '41', name: 'Park', status: 'Backlog', column: 'todo' },
    ];

    /** An issue from Jira, as the service lists it. */
    const issue = (id: string, key: string, title: string, column: CardColumn, change: Partial<Card> = {}): Card =>
      card(id, title, column, {
        kind: 'jira',
        cwd: '',
        jira: {
          key,
          url: `https://acme.atlassian.net/browse/${key}`,
          type: 'Bug',
          priority: 'High',
          status: column === 'doing' ? 'In Review' : 'To Do',
        },
        ...change,
      });

    async function openBoard(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement) {
      [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
        .find((tab) => tab.textContent!.trim() === 'Kanban')!
        .click();
      await fixture.whenStable();
    }

    const cardEl = (el: HTMLElement, title: string) =>
      [...el.querySelectorAll<HTMLElement>('gr-kanban-page .card[data-card]')].find(
        (c) => c.querySelector('.name')?.textContent!.trim() === title,
      )!;
    const button = (root: Element, text: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
      )!;
    /** Each column's card titles, in order. */
    const board = (texts: (selector: string) => string[]) =>
      Object.fromEntries(
        CARD_COLUMNS.map((column) => [
          column,
          texts(`gr-kanban-page [aria-labelledby="gr-kanban-${column}"] .card[data-card] .name`),
        ]),
      ) as Record<CardColumn, string[]>;
    const field = (el: HTMLElement, selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const drag = (type: string, target: Element) =>
      target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

    it('writes a new card at the foot of To do, in the folder of the chat you’re on, and changes it in place', async () => {
      const { bridge, calls, answers } = withBoard([card('a', 'Write ribbon tests', 'todo')]);
      answers['layout.get'] = () => ({
        current: null,
        lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/Users/me/git/breeder' } },
      });
      const { fixture, el, texts } = await render(bridge);
      await openBoard(fixture, el);
      expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
      expect(texts('gr-kanban-page h3')).toEqual(['To do 1', 'In progress 0', 'Done 0']);

      el.querySelector<HTMLButtonElement>('gr-kanban-page .add')!.click();
      await fixture.whenStable();
      expect(texts('gr-card-form [aria-checked="true"]')).toEqual(['~/git/breeder']);
      field(el, 'gr-card-form .name', 'Add dark theme tokens');
      field(el, 'gr-card-form .notes', 'The night theme first.');
      el.querySelector<HTMLButtonElement>('gr-card-form .send')!.click();
      await fixture.whenStable();
      expect(calls.find((c) => c.command === 'kanban.save')!.request).toEqual({
        title: 'Add dark theme tokens',
        notes: 'The night theme first.',
        cwd: 'C:/Users/me/git/breeder',
      });
      expect(el.querySelector('gr-card-form')).toBeNull();
      expect(board(texts).todo).toEqual(['Write ribbon tests', 'Add dark theme tokens']);
      expect(texts('[data-card="card-2"] .notes')).toEqual(['The night theme first.']);
      expect(texts('[data-card="card-2"] .where')).toEqual(['~/git/breeder']);

      button(cardEl(el, 'Add dark theme tokens'), 'Change').click();
      await fixture.whenStable();
      expect(el.querySelector<HTMLInputElement>('gr-card-form .name')!.value).toBe('Add dark theme tokens');
      field(el, 'gr-card-form .name', 'Add night theme tokens');
      button(el.querySelector('gr-card-form')!, '~/git/grimoire').click();
      el.querySelector<HTMLButtonElement>('gr-card-form .send')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'kanban.save').at(-1)!.request).toEqual({
        id: 'card-2',
        title: 'Add night theme tokens',
        notes: 'The night theme first.',
        cwd: 'C:/Users/me/git/grimoire',
      });
      expect(board(texts).todo).toEqual(['Write ribbon tests', 'Add night theme tokens']);
    });

    it('moves cards with Move to, keeping the one moved in reach of the keyboard, and by dragging them', async () => {
      const { bridge, calls } = withBoard([card('a', 'A', 'todo'), card('b', 'B', 'todo'), card('c', 'C', 'doing')]);
      const { fixture, el, texts } = await render(bridge);
      await openBoard(fixture, el);

      button(cardEl(el, 'A'), 'Move to…').click();
      await fixture.whenStable();
      expect(texts('[data-card="a"] .moves button')).toEqual(['In progress', 'Done', 'Down', 'Cancel']);
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
        pins: [],
        tags: [],
        copied: [],
      });
      const { fixture, el, texts } = await render(bridge);
      await openBoard(fixture, el);

      button(cardEl(el, 'Context meter'), 'New chapter').click();
      await fixture.whenStable();
      expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
      expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe(
        'Context meter\n\nFill it in from the usage events.',
      );
      expect(texts('.meta button')).toContain('~/git/grimoire');
      expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
      // Again, it turns to that blank chat rather than open another.
      const chats = el.querySelectorAll('gr-chat-tab.chat').length;
      button(cardEl(el, 'Context meter'), 'New chapter').click();
      await fixture.whenStable();
      expect(el.querySelectorAll('gr-chat-tab.chat')).toHaveLength(chats);
      expect(calls.filter((c) => c.command === 'agents.start' || c.command === 'kanban.link')).toEqual([]);
      expect(board(texts).todo).toEqual(['Context meter']);

      await write(fixture, el, 'Context meter\n\nFill it in from the usage events.');
      const start = calls.find((c) => c.command === 'agents.start')!.request as CommandRequest<'agents.start'>;
      expect(start.settings.cwd).toBe('C:/Users/me/git/grimoire');
      expect(calls.filter((c) => c.command === 'kanban.link').map((c) => c.request)).toEqual([
        { id: 'a', chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/grimoire' },
      ]);
      expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
      expect(texts('[data-card="a"] .chats li')).toEqual(['Untitled chapter thinking']);
      emit('agents.title', { chatId: 'chat-1', title: 'Context meter' });
      emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
      await fixture.whenStable();
      expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter waiting for you']);
      expect(el.querySelector('[data-card="a"] .status gr-icon')!.classList).toContain('breathe');

      // The chat bears its card's badge.
      expect(texts('gr-header-badges button')).toEqual(['Context meter']);
      expect(el.querySelector('gr-header-badges button')!.getAttribute('title')).toBe(
        'This chapter’s card on the Kanban board, in In progress: Context meter',
      );

      // Closed, it's opened again from the card.
      button(el.querySelector('gr-chat-page gr-page-header')!, 'Close').click();
      await fixture.whenStable();
      expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter not open']);
      expect(texts('gr-header-badges button')).toEqual([]);
      el.querySelector<HTMLButtonElement>('[data-card="a"] .chat')!.click();
      await fixture.whenStable();
      expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
        agent: 'claude-code',
        chatId: 'chat-1',
        settings: { cwd: 'C:/Users/me/git/grimoire' },
      });
      expect(texts('[data-card="a"] .chats li')).toEqual(['Context meter idle']);
      expect(texts('gr-header-badges button')).toEqual(['Context meter']);
    });

    it('closes a card, keeping it under the board, and opens it again', async () => {
      const { bridge, calls } = withBoard([card('a', 'A', 'todo'), card('b', 'Set up the Angular project', 'done')]);
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
      expect(texts('gr-kanban-page .folders button')).toEqual(['All', '~/git/grimoire', '~/git/breeder']);
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
        pins: [],
        tags: [],
        copied: [],
      });
      const cwd = 'C:/Users/me/git/grimoire';
      answers['layout.get'] = () => ({ current: null, lastUsed: { agent: 'claude-code', settings: { cwd } } });
      const { fixture, el, texts } = await render(bridge);
      await write(fixture, el, 'Put the context meter on the board');
      emit('agents.title', { chatId: 'chat-1', title: 'Track the meter' });
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
              result: { text: 'Added "Context meter" to To do on the user\'s Kanban board.', isError: false },
            },
            { kind: 'text', text: 'It’s on the board.' },
          ],
        },
      });
      cards = [card('a', 'Context meter', 'todo', { madeIn: { chatId: 'chat-1', agent: 'claude-code', cwd } })];
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

    it('shows your Jira issues as cards of their own, each opening in Jira', async () => {
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

      expect(board(texts).doing).toEqual(['Mine', 'Context meter']);
      const jira = cardEl(el, 'Context meter');
      expect(jira.classList).toContain('jira');
      expect(cardEl(el, 'Mine').classList).not.toContain('jira');
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
      expect(texts('[data-card="a"] .actions button')).toEqual(['New chapter', 'Move to…', 'Change', 'Close']);

      // It keeps Jira's order in its column.
      button(jira, 'Move to…').click();
      await fixture.whenStable();
      expect(texts('[data-card="j1"] .moves button')).toEqual(['To do', 'Done', 'Cancel']);
      button(jira, 'Cancel').click();
      await fixture.whenStable();
      drag('dragstart', jira);
      drag('dragover', cardEl(el, 'Mine'));
      drag('drop', cardEl(el, 'Mine'));
      await fixture.whenStable();
      expect(board(texts).doing).toEqual(['Mine', 'Context meter']);
      expect(calls.filter((c) => c.command === 'kanban.move' || c.command === 'kanban.transitions')).toEqual([]);

      button(jira, 'Open in Jira').click();
      expect(bridge.openExternal).toHaveBeenCalledWith('https://acme.atlassian.net/browse/GRIM-12');

      // Where they stand shows above the board, with a refresh.
      const time = new Date(synced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      expect(texts('gr-kanban-page .jira-sync > *')).toEqual(['Jira', `synced at ${time}`, 'Refresh']);
      button(el.querySelector('gr-kanban-page .jira-sync')!, 'Refresh').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'kanban.syncJira').at(-1)!.request).toEqual({});

      // Closed, it says its status and key.
      button(jira, 'Close').click();
      await fixture.whenStable();
      el.querySelector<HTMLButtonElement>('gr-kanban-page .closed > button')!.click();
      await fixture.whenStable();
      expect(texts('gr-kanban-page .closed li')).toEqual(['Context meter In Review · GRIM-12 Reopen']);
    });

    it('opens a chat from a Jira card with its key, summary and description written in, where the board shows', async () => {
      const { bridge, calls, answers } = withBoard([
        card('a', 'A', 'todo'),
        card('b', 'B', 'todo', { cwd: 'C:/Users/me/git/breeder' }),
        issue('j1', 'GRIM-12', 'Context meter', 'todo', { notes: 'Fill it in.\n\n- From the usage events' }),
      ]);
      answers['layout.get'] = () => ({
        current: null,
        lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/Users/me/git/grimoire' } },
      });
      const { fixture, el, texts } = await render(bridge);
      await openBoard(fixture, el);
      // It belongs to no folder: it shows whichever is picked.
      expect(texts('gr-kanban-page .folders button')).toEqual(['All', '~/git/grimoire', '~/git/breeder']);
      button(el.querySelector('gr-kanban-page .folders')!, '~/git/breeder').click();
      await fixture.whenStable();
      expect(board(texts).todo).toEqual(['B', 'Context meter']);

      button(cardEl(el, 'Context meter'), 'New chapter').click();
      await fixture.whenStable();
      expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe(
        'GRIM-12: Context meter\n\nFill it in.\n\n- From the usage events',
      );
      await write(fixture, el, 'GRIM-12: Context meter');
      const start = calls.find((c) => c.command === 'agents.start')!.request as CommandRequest<'agents.start'>;
      expect(start.settings.cwd).toBe('C:/Users/me/git/breeder');
      expect(calls.filter((c) => c.command === 'kanban.link').map((c) => c.request)).toEqual([
        { id: 'j1', chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' },
      ]);
      // Its chat is listed on it, which stays where Jira has it.
      expect(board(texts).todo).toEqual(['B', 'Context meter']);
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
      await openBoard(fixture, el);
      const meter = cardEl(el, 'Context meter');
      expect(meter.getAttribute('draggable')).toBe('true');
      drag('dragstart', meter);
      drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-done"]')!);
      drag('drop', cardEl(el, 'Night theme'));
      await fixture.whenStable();
      // It's there at once, at the column's foot, while Jira moves it.
      expect(board(texts)).toEqual({ todo: ['Mine'], doing: [], done: ['Night theme', 'Context meter'] });
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
      await openBoard(fixture, el);

      button(cardEl(el, 'Context meter'), 'Move to…').click();
      await fixture.whenStable();
      button(cardEl(el, 'Context meter'), 'In progress').click();
      await fixture.whenStable();
      expect(board(texts)).toEqual({ todo: [], doing: ['Context meter'], done: [] });
      expect(texts('[data-card="j1"] .moves > *')).toEqual(['Move to', 'In Progress', 'In Review', 'Cancel']);
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
      await openBoard(fixture, el);
      drag('dragstart', cardEl(el, 'Context meter'));
      drag('dragover', el.querySelector('[aria-labelledby="gr-kanban-done"]')!);
      drag('drop', el.querySelector('[aria-labelledby="gr-kanban-done"] h3')!);
      await fixture.whenStable();
      expect(board(texts)).toEqual({ todo: ['Context meter'], doing: [], done: [] });
      expect(texts('[data-card="j1"] .jira-note')).toEqual(['Jira doesn’t allow moving from To Do to Done']);
      expect(calls.filter((c) => c.command === 'kanban.transition')).toEqual([]);
    });

    it('changes a Jira card’s status to any Jira allows, in its own column too', async () => {
      const { bridge, calls } = withBoard([issue('j1', 'GRIM-12', 'Context meter', 'todo')]);
      const { fixture, el, texts } = await render(bridge);
      await openBoard(fixture, el);
      button(cardEl(el, 'Context meter'), 'Change status…').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'kanban.transitions').map((c) => c.request)).toEqual([{ id: 'j1' }]);
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
      await openBoard(fixture, el);
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
      expect(texts('gr-kanban-page .jira-sync > *')).toEqual([
        'Jira',
        'the Atlassian connector needs connecting again on claude.ai',
        'Refresh',
      ]);
      emit('kanban.jira', { jira: { status: 'failed', error: 'HTTP 503', syncing: false } });
      await fixture.whenStable();
      expect(texts('gr-kanban-page .jira-sync > *')).toEqual(['Jira', 'couldn’t sync: HTTP 503', 'Refresh']);
      emit('kanban.jira', { jira: { status: 'failed', error: 'HTTP 503', syncing: true } });
      await fixture.whenStable();
      expect(texts('gr-kanban-page .jira-sync > *')).toEqual(['Jira', 'syncing…', 'Refresh']);
      expect(button(el.querySelector('gr-kanban-page .jira-sync')!, 'Refresh').disabled).toBe(true);
    });
  });
});
