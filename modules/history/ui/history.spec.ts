import type {
  CommandRequest,
  OpenChat,
} from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('history', () => {
  it('lists every chat in the History, in parts by project, narrowed and tagged there', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', cwd: 'C:/Users/me/git/grimoire', updatedAt: 9, pins: [], tags: ['ui', 'bug'] },
      { id: 'c2', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/breeder', updatedAt: 8, pins: [], tags: ['bug'] },
      { id: 'c3', agent: 'claude-code', title: 'Refactor storage migrations', cwd: 'C:/Users/me/git/grimoire/.claude/worktrees/storage', updatedAt: 7, pins: [], tags: [] },
      { id: 'c4', agent: 'claude-code', title: 'Morning repo summary', cwd: 'C:/Users/me/git/grimoire', updatedAt: 1, pins: ['pin'], tags: [] },
    ];
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
      pins: [],
      tags: ['bug'],
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
    expect(texts('gr-history-page h2')).toEqual(['grimoire ~/git/grimoire', 'breeder ~/git/breeder']);
    // A pinned chat comes first in its part; a worktree's chat is in its repository's.
    expect(texts('gr-history-page li .chat')).toEqual([
      'Morning repo summary',
      'Context meter',
      'Refactor storage migrations',
      'Fix flaky login test',
    ]);
    expect(texts('gr-history-page li .tag')).toEqual(['ui', 'bug', 'bug']);
    expect(texts('gr-history-page .pick')).toEqual(['bug', 'ui']);

    const pick = (tag: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-history-page .pick')].find((b) => b.textContent!.trim() === tag)!;
    pick('bug').click();
    await fixture.whenStable();
    expect(pick('bug').getAttribute('aria-pressed')).toBe('true');
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter', 'Fix flaky login test']);
    pick('ui').click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter']);
    el.querySelector<HTMLButtonElement>('gr-history-page .narrow .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-history-page li .chat')).toHaveLength(4);

    // A tag is written in place on the chat, and kept by the service.
    const row = (id: string) => el.querySelector<HTMLElement>(`gr-history-page li[data-chat="${id}"]`)!;
    row('c3').querySelector<HTMLButtonElement>('.add')!.click();
    await fixture.whenStable();
    const field = row('c3').querySelector<HTMLInputElement>('.field')!;
    expect(document.activeElement).toBe(field);
    field.value = ' storage ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    const tagCalls = () => calls.filter((c) => c.command === 'agents.tag').map((c) => c.request);
    expect(tagCalls()).toEqual([{ chatId: 'c3', tags: ['storage'] }]);
    expect(texts('gr-history-page li[data-chat="c3"] .tag')).toEqual(['storage']);
    expect(texts('gr-history-page .pick')).toEqual(['bug', 'storage', 'ui']);
    expect(document.activeElement).toBe(row('c3').querySelector('.add'));

    row('c1').querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(tagCalls().at(-1)).toEqual({ chatId: 'c1', tags: ['bug'] });
    expect(texts('gr-history-page .pick')).toEqual(['bug', 'storage']);

    // Tags and titles changed on a chat itself show here too.
    emit('agents.tags', { chatId: 'c2', tags: ['bug', 'login'] });
    emit('agents.title', { chatId: 'c4', title: 'Morning summary' });
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

  it('looks up words through the chats in the History, each with its passage', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', cwd: 'C:/Users/me/git/grimoire', updatedAt: 9, pins: [], tags: [] },
      { id: 'c2', agent: 'claude-code', title: 'Fix flaky login test', cwd: 'C:/Users/me/git/breeder', updatedAt: 8, pins: [], tags: [] },
      { id: 'c3', agent: 'claude-code', title: 'Refactor storage migrations', cwd: 'C:/Users/me/git/grimoire', updatedAt: 7, pins: [], tags: [] },
    ];
    answers['search.chats'] = ({ query }: CommandRequest<'search.chats'>) => {
      if (query === 'boom') throw new Error('the worker stopped');
      if (query !== 'timer') return [];
      return [
        {
          chatId: 'c2',
          agent: 'claude-code',
          kind: 'agent',
          excerpt: [{ text: '…the login test waited on a ' }, { text: 'timer', match: true }, { text: '; it now…' }],
        },
        { chatId: 'c1', agent: 'claude-code', kind: 'title', excerpt: [{ text: 'Context meter' }] },
        // A chat the history doesn't list yet is left out.
        { chatId: 'new', agent: 'claude-code', kind: 'you', excerpt: [{ text: 'timer', match: true }] },
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
      pins: [],
      tags: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('#gr-history-look-up')!;
    expect(document.activeElement).toBe(field);
    const look = async (query: string) => {
      field.value = query;
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    await look('timer');
    expect(calls.filter((c) => c.command === 'search.chats').map((c) => c.request)).toEqual([{ query: 'timer' }]);
    expect(texts('gr-history-page li .chat')).toEqual(['Context meter', 'Fix flaky login test']);
    // A passage is shown with who wrote it; a title that has the words shows as it is.
    expect(texts('gr-history-page .excerpt')).toEqual(['Claude Code …the login test waited on a timer; it now…']);
    expect(texts('gr-history-page .excerpt b')).toEqual(['timer']);
    expect(texts('gr-history-page .count')).toEqual(['2 chapters']);

    // Enter opens the first chat listed.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.open').map((c) => c.request)).toEqual([
      { agent: 'claude-code', chatId: 'c1', settings: { cwd: 'C:/Users/me/git/grimoire' } },
    ]);

    await look('zzz');
    expect(texts('gr-history-page .none')).toEqual(['Nothing in the chapters matches “zzz”.']);
    expect(texts('gr-history-page .count')).toEqual(['0 chapters']);

    await look('boom');
    expect(texts('gr-history-page [role="alert"]')).toEqual([
      'The chapters couldn’t be looked through: the worker stopped',
    ]);

    // Nothing looked up lists every chat again, without asking.
    await look('  ');
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
    expect(texts('gr-history-page .none')).toEqual(['No chapters yet. Each chat you begin is written in here.']);
    expect(el.querySelector('gr-history-page .narrow')).toBeNull();
  });
});
