import type { OpenChat } from '@grimoire/contract';
import { fakeBridge, pick, render, write } from '../../testing/app-harness';

describe('chat-tabs', () => {
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

  it("opens a chat's settings from a right-click on its chat tab", async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge);
    el.querySelector('gr-chat-tab.chat button')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Agent']);
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
      copied: [],
    });
    answers['agents.openChats'] = () => [chat('c1', 'One'), chat('c2', 'Two'), chat('c3', 'Three')];
    answers['layout.get'] = () => ({ current: 'c2' });
    const { fixture, el, texts } = await render(bridge);
    const closed = () =>
      calls
        .filter((c) => c.command === 'agents.close')
        .map((c) => (c.request as { chatId: string }).chatId);

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
});
