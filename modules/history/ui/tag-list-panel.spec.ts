import { fakeBridge, render } from '@ui/testing/app-testing';

describe('tag-list-panel', () => {
  it('keeps your tag list from the History: adds, moves, renames and removes tags', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Context meter', updatedAt: 9 },
    ];
    answers['history.tagList'] = () => ['bug', 'ui'];
    answers['history.pinsAndTags'] = () => ({ pins: {}, tags: { c1: ['docs', 'bug'] } });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((t) => t.textContent!.trim() === 'Table of contents')!
      .click();
    await fixture.whenStable();
    const toggle = el.querySelector<HTMLButtonElement>('gr-history-page .tags-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const panel = () => el.querySelector<HTMLElement>('gr-tag-list-panel')!;
    const button = (label: string) =>
      panel().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const sent = (command: string) =>
      calls.filter((c) => c.command === command).map((c) => c.request);
    expect(texts('gr-tag-list-panel .tag')).toEqual(['bug', 'ui']);
    // A tag chats have that isn't on the list can be added to it.
    expect(texts('gr-tag-list-panel .others .gr-link')).toEqual(['+ docs']);

    button('Add docs to the list').click();
    button('Move ui up').click();
    button('Remove bug from the list').click();
    const field = panel().querySelector<HTMLInputElement>('[aria-label="Add a tag to the list"]')!;
    field.value = ' later ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(sent('history.setTagList')).toEqual([
      { tags: ['bug', 'ui', 'docs'] },
      { tags: ['ui', 'bug'] },
      { tags: ['ui'] },
      { tags: ['bug', 'ui', 'later'] },
    ]);
    expect(field.value).toBe('');

    // The list shows as the service keeps it.
    emit('history.tagListChanged', { tags: ['ui', 'docs'] });
    await fixture.whenStable();
    expect(texts('gr-tag-list-panel .tag')).toEqual(['ui', 'docs']);
    expect(texts('gr-tag-list-panel .others .gr-link')).toEqual(['+ bug']);

    // Renaming writes the new name in place; Esc keeps the old one.
    const rename = async (tag: string, to: string, key: string) => {
      [...panel().querySelectorAll<HTMLButtonElement>('li')]
        .find((li) => li.querySelector('.tag')?.textContent!.trim() === tag)!
        .querySelector<HTMLButtonElement>('.gr-link')!
        .click();
      await fixture.whenStable();
      const name = panel().querySelector<HTMLInputElement>(`[aria-label="New name for ${tag}"]`)!;
      expect(document.activeElement).toBe(name);
      name.value = to;
      name.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    await rename('docs', 'bug', 'Escape');
    await rename('docs', 'docs', 'Enter');
    await rename('docs', ' bug ', 'Enter');
    expect(sent('history.renameTag')).toEqual([{ from: 'docs', to: 'bug' }]);

    answers['history.setTagList'] = () => Promise.reject(new Error('gone'));
    button('Remove ui from the list').click();
    await fixture.whenStable();
    expect(texts('gr-tag-list-panel [role="alert"]')).toEqual([
      'The tag list couldn’t be kept: gone',
    ]);
  });
});
