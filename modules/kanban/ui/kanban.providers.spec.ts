import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { Settings } from '@ui/app/core/settings';
import { TestBed } from '@angular/core/testing';
import { render, write } from '@ui/testing/app-testing';
import { card, issue, withBoard } from './kanban-testing';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/Users/me/git/grimoire', at: 0 };

describe('kanban.providers', () => {
  it('gives a chat begun from a card its badge, which turns to the board', async () => {
    const { bridge } = withBoard([card('a', 'Context meter', 'doing', { chats: [chat] })]);
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-header-badges button')).toEqual([]);

    await write(fixture, el, 'Fill in the meter');
    expect(texts('gr-header-badges button')).toEqual(['Context meter']);
    const badge = el.querySelector<HTMLButtonElement>('gr-header-badges button')!;
    expect(badge.getAttribute('title')).toBe(
      'This chapter’s card on the Kanban board, in In progress: Context meter',
    );
    badge.click();
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
  });

  it('names a Jira card’s issue and status on its badge, which opens it in Jira', async () => {
    const { bridge } = withBoard([
      card('a', 'Context meter', 'doing', { chats: [chat] }),
      issue('j1', 'GRIM-12', 'Draw the context meter', 'doing', { chats: [chat] }),
    ]);
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fill in the meter');
    expect(texts('gr-header-badges button')).toEqual(['GRIM-12 · In Review']);
    const badge = el.querySelector<HTMLButtonElement>('gr-header-badges button')!;
    expect(badge.getAttribute('title')).toBe(
      'This chapter’s Jira issue, in In Review: Draw the context meter. Opens it in Jira.',
    );
    badge.click();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://acme.atlassian.net/browse/GRIM-12');
  });

  it('bears no Jira issue’s badge while Jira is off', async () => {
    const { bridge, answers } = withBoard([
      issue('j1', 'GRIM-12', 'Draw the context meter', 'doing', { chats: [chat] }),
    ]);
    answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, jira: false });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fill in the meter');
    expect(texts('gr-header-badges button')).toEqual([]);
  });

  it('shortens a long title on the badge, and says it plainly when asked', async () => {
    const title = 'Draw the context meter from the usage events, in the page footer';
    const { bridge } = withBoard([card('a', title, 'todo', { chats: [chat] })]);
    const { fixture, el, texts } = await render(bridge);
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await write(fixture, el, 'Go');
    expect(texts('gr-header-badges button')).toEqual(['Draw the context meter from the…']);
    expect(el.querySelector('gr-header-badges button')!.getAttribute('title')).toBe(
      `This chat’s card on the Kanban board, in To do: ${title}`,
    );
  });
});
