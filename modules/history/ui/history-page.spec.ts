import { type CommandRequest, DEFAULT_SETTINGS, type OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

const byProject = () => ({ ...DEFAULT_SETTINGS, historyGroup: 'project' as const });

describe('history', () => {
  it('lists every chat in the History, in parts by project, narrowed and tagged there', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['settings.get'] = byProject;
    answers['agents.chats'] = () => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        cwd: 'C:/Users/me/git/grimoire',
        updatedAt: 9,
      },
      {
        id: 'c2',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        cwd: 'C:/Users/me/git/breeder',
        updatedAt: 8,
      },
      {
        id: 'c3',
        agent: 'claude-code',
        title: 'Refactor storage migrations',
        cwd: 'C:/Users/me/git/grimoire/.claude/worktrees/storage',
        updatedAt: 7,
      },
      {
        id: 'c4',
        agent: 'claude-code',
        title: 'Morning repo summary',
        cwd: 'C:/Users/me/git/grimoire',
        updatedAt: 1,
      },
    ];
    answers['history.pinsAndTags'] = () => ({
      pins: { c4: ['pin'] },
      tags: { c1: ['ui', 'bug'], c2: ['bug'] },
    });
    answers['agents.open'] = (request: CommandRequest<'agents.open'>): OpenChat => ({
      id: request.chatId,
      agent: request.agent,
      title: 'Fix flaky login test',
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
    const tab = [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')].find(
      (t) => t.textContent!.trim() === 'Table of contents',
    )!;
    tab.click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Table of contents']);
    expect(texts('gr-history-page h3')).toEqual(['Part I', 'Part II']);
    expect(texts('gr-history-page h2')).toEqual([
      'grimoire ~/git/grimoire',
      'breeder ~/git/breeder',
    ]);
    // A pinned chat comes first in its part; a worktree's chat is in its repository's.
    expect(texts('gr-history-page li .chat')).toEqual([
      'Morning repo summary',
      'Context meter',
      'Refactor storage migrations',
      'Fix flaky login test',
    ]);
    expect(texts('gr-history-page li .tag')).toEqual(['ui', 'bug', 'bug']);
    // The tags to narrow by are in the panel the bar opens; the toggle counts the picked ones.
    expect(el.querySelector('gr-history-page .pick')).toBeNull();
    const toggle = el.querySelector<HTMLButtonElement>('gr-history-page .tags-toggle')!;
    toggle.click();
    await fixture.whenStable();
    expect(texts('gr-history-page .pick')).toEqual(['bug', 'ui']);

    const pick = (tag: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-history-page .pick')].find(
        (b) => b.textContent!.trim() === tag,
      )!;
    pick('bug').click();
    await fixture.whenStable();
    expect(pick('bug').getAttribute('aria-pressed')).toBe('true');
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter', 'Fix flaky login test']);
    pick('ui').click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter']);
    expect(toggle.textContent!.trim()).toBe('Tags · 2');
    el.querySelector<HTMLButtonElement>(
      'gr-history-page [aria-label="Show chapters tagged"] .gr-link',
    )!.click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toHaveLength(4);

    const row = (id: string) =>
      el.querySelector<HTMLElement>(`gr-history-page li[data-chat="${id}"]`)!;
    // The tags are only shown here; they're changed on the chat itself.
    expect(row('c1').querySelector('.add, .untag')).toBeNull();

    // Tags and titles changed on a chat itself show here too.
    emit('history.tags', { chatId: 'c2', tags: ['bug', 'login'] });
    emit('agents.title', { chatId: 'c4', title: 'Morning summary', by: 'agent' });
    await fixture.whenStable();
    expect(texts('gr-history-page li[data-chat="c2"] .tag')).toEqual(['bug', 'login']);
    expect(texts('gr-history-page li[data-chat="c4"] .chat')).toEqual(['Morning summary']);

    // A title opens its chat on the left page; the history stays open beside it.
    row('c2').querySelector<HTMLButtonElement>('.chat')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c2', settings: { cwd: 'C:/Users/me/git/breeder' } },
    ]);
    expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
    expect(row('c2').getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('gr-history-page')).not.toBeNull();
  });

  it('searches the chats in the History for words, each with its passage', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['settings.get'] = byProject;
    answers['agents.chats'] = () => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        cwd: 'C:/Users/me/git/grimoire',
        updatedAt: 9,
      },
      {
        id: 'c2',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        cwd: 'C:/Users/me/git/breeder',
        updatedAt: 8,
      },
      {
        id: 'c3',
        agent: 'claude-code',
        title: 'Refactor storage migrations',
        cwd: 'C:/Users/me/git/grimoire',
        updatedAt: 7,
      },
    ];
    answers['search.chats'] = ({ query }: CommandRequest<'search.chats'>) => {
      if (query === 'boom') throw new Error('the worker stopped');
      if (query !== 'timer') return [];
      return [
        {
          chatId: 'c2',
          agent: 'claude-code',
          kind: 'agent',
          excerpt: [
            { text: '…the login test waited on a ' },
            { text: 'timer', match: true },
            { text: '; it now…' },
          ],
        },
        { chatId: 'c1', agent: 'claude-code', kind: 'title', excerpt: [{ text: 'Context meter' }] },
        // A chat the history doesn't list yet is left out.
        {
          chatId: 'new',
          agent: 'claude-code',
          kind: 'you',
          excerpt: [{ text: 'timer', match: true }],
        },
      ];
    };
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
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-history-search')!;
    expect(document.activeElement).toBe(field);
    const search = async (query: string) => {
      field.value = query;
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    await search('timer');
    expect(calls.filter((c) => c.command === 'search.chats').map((c) => c.request)).toEqual([
      { query: 'timer' },
    ]);
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter', 'Fix flaky login test']);
    // A passage is shown with who wrote it; a title that has the words shows as it is.
    expect(texts('gr-history-page .excerpt')).toEqual([
      'Claude Code …the login test waited on a timer; it now…',
    ]);
    expect(texts('gr-history-page .excerpt b')).toEqual(['timer']);
    expect(texts('gr-history-page .count')).toEqual(['2 chapters']);

    // Enter opens the first chat listed.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c1', settings: { cwd: 'C:/Users/me/git/grimoire' } },
    ]);

    await search('zzz');
    expect(texts('gr-history-page .none')).toEqual(['Nothing in the chapters matches “zzz”.']);
    expect(texts('gr-history-page .count')).toEqual(['0 chapters']);

    await search('boom');
    expect(texts('gr-history-page [role="alert"]')).toEqual([
      'The chapters couldn’t be looked through: the worker stopped',
    ]);

    // An empty search lists every chat again, without asking.
    await search('  ');
    expect(texts('gr-history-page li .chat')).toHaveLength(3);
    expect(texts('gr-history-page .count')).toEqual(['']);
    expect(el.querySelector('gr-history-page [role="alert"]')).toBeNull();
    expect(calls.filter((c) => c.command === 'search.chats')).toHaveLength(3);
  });

  it('says so in the History when there are no chats, or none with the tags picked', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.chats'] = () => [];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-history-page .none')).toEqual([
      'No chapters yet. Each chat you begin is written in here.',
    ]);
    expect(el.querySelector('gr-history-page .group')).toBeNull();
    expect(el.querySelector('gr-history-page .tags-toggle')).toBeNull();
  });

  it('shows each chat’s summary when you point at its title, else the title', async () => {
    const { bridge, answers, emit } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', updatedAt: 9 },
      { id: 'c2', agent: 'claude-code', title: 'Login test', updatedAt: 8 },
    ];
    answers['history.pinsAndTags'] = () => ({
      pins: {},
      tags: {},
      summaries: { c1: 'Shows how full the context window is' },
    });
    const { fixture, el } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    const hint = (id: string) =>
      el.querySelector(`gr-history-page li[data-chat="${id}"] .chat`)!.getAttribute('title');
    expect(hint('c1')).toBe('Shows how full the context window is');
    expect(hint('c2')).toBe('Login test');
    // Every chat is in the same project, so none names it.
    expect(el.querySelector('gr-history-page li .project')).toBeNull();

    // A summary written elsewhere, such as by auto labels, shows here too.
    emit('history.summary', { chatId: 'c2', summary: 'Fixes a flaky test' });
    await fixture.whenStable();
    expect(hint('c2')).toBe('Fixes a flaky test');
  });

  it('shows the first 50 chats, and 50 more each time you ask, until a search narrows it again', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.chats'] = () =>
      Array.from({ length: 120 }, (_, i) => ({
        id: `c${i}`,
        agent: 'claude-code',
        title: `Chat ${i}`,
        updatedAt: 1000 - i,
      }));
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toHaveLength(50);
    expect(texts('gr-history-page .more')).toEqual(['Show 50 more (70 left)']);

    el.querySelector<HTMLButtonElement>('gr-history-page .more')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-history-page .more')!.click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toHaveLength(120);
    expect(el.querySelector('gr-history-page .more')).toBeNull();

    // Grouping anew starts from the first 50 again.
    [...el.querySelectorAll<HTMLButtonElement>('gr-history-page .choice')]
      .find((b) => b.textContent!.trim() === 'Project')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toHaveLength(50);
  });

  describe('by date', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 10, 13, 15, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('groups the chats by date, each with its project, and keeps up as chats are written in', async () => {
      const { bridge, calls, answers, emit } = fakeBridge();
      const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
      let chats = [
        {
          id: 'c1',
          agent: 'claude-code',
          title: 'Context meter',
          cwd: 'C:/Users/me/git/grimoire',
          updatedAt: at(13, 9),
        },
        {
          id: 'c2',
          agent: 'claude-code',
          title: 'Fix flaky login test',
          cwd: 'C:/Users/me/git/breeder',
          updatedAt: at(12, 18),
        },
        {
          id: 'c3',
          agent: 'claude-code',
          title: 'Morning repo summary',
          cwd: 'C:/Users/me/git/grimoire',
          updatedAt: at(2, 8),
        },
      ];
      answers['agents.chats'] = () => chats;
      answers['history.pinsAndTags'] = () => ({ pins: { c3: ['pin'] }, tags: {} });
      const { fixture, el, texts } = await render(bridge);
      [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
        .find((t) => t.textContent!.trim() === 'Table of contents')!
        .click();
      await fixture.whenStable();

      expect(texts('gr-history-page h2')).toEqual(['Pinned', 'Today', 'Yesterday']);
      expect(el.querySelector('gr-history-page h3')).toBeNull();
      expect(texts('gr-history-page li .chat')).toEqual([
        'Morning repo summary',
        'Context meter',
        'Fix flaky login test',
      ]);
      expect(texts('gr-history-page li .project')).toEqual(['grimoire', 'grimoire', 'breeder']);
      // Under a single day's heading a chat shows only its time; elsewhere its day.
      const time = (at: number) =>
        new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      expect(texts('gr-history-page li .when')).toEqual([
        new Date(at(2, 8)).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        time(at(13, 9)),
        time(at(12, 18)),
      ]);
      const choice = (label: string) =>
        [...el.querySelectorAll<HTMLButtonElement>('gr-history-page .choice')].find(
          (b) => b.textContent!.trim() === label,
        )!;
      expect(choice('Date').getAttribute('aria-pressed')).toBe('true');

      // A chat written in moves to the top once its turn ends; a new one shows up.
      chats = [
        { ...chats[1]!, updatedAt: at(13, 14) },
        {
          id: 'c4',
          agent: 'claude-code',
          title: 'New idea',
          cwd: 'C:/Users/me/git/grimoire',
          updatedAt: at(13, 14),
        },
        chats[0]!,
        chats[2]!,
      ];
      emit('agents.turnEnded', { chatId: 'c4' });
      await fixture.whenStable();
      expect(texts('gr-history-page h2')).toEqual(['Pinned', 'Today']);
      expect(texts('gr-history-page li .chat')).toEqual([
        'Morning repo summary',
        'Fix flaky login test',
        'New idea',
        'Context meter',
      ]);

      // By project, the chats go back into their parts, and the choice is kept.
      choice('Project').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
        { historyGroup: 'project' },
      ]);
      expect(texts('gr-history-page h3')).toEqual(['Part I', 'Part II']);
      expect(el.querySelector('gr-history-page li .project')).toBeNull();
    });
  });
});
