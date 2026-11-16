import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';
import { TAGS_AT_ONCE } from './tag-settings';

async function withTagSettings(list: string[], chatTags: string[] = []) {
  const fake = fakeBridge();
  fake.answers['agents.chats'] = () => [
    { id: 'c1', agent: 'claude-code', title: 'Context meter', updatedAt: 9 },
  ];
  fake.answers['history.tagList'] = () => list;
  fake.answers['history.pinsAndTags'] = () => ({ pins: {}, tags: { c1: chatTags } });
  const rendered = await render(fake.bridge);
  await openPageTab(rendered.fixture, rendered.el, 'Colophon');
  const panel = () => rendered.el.querySelector<HTMLElement>('gr-tag-settings')!;
  const toggle = () => panel().querySelector<HTMLButtonElement>('.summary .gr-link')!;
  const find = async (text: string) => {
    const field = panel().querySelector<HTMLInputElement>('[aria-label="Find or add a tag"]')!;
    field.value = text;
    field.dispatchEvent(new Event('input'));
    await rendered.fixture.whenStable();
    return field;
  };
  return { ...fake, ...rendered, panel, toggle, find };
}

describe('TagSettings', () => {
  it('keeps your tag list on the Settings page: shows it A to Z, adds, renames and removes tags', async () => {
    const { answers, calls, emit, fixture, texts, panel, toggle, find } = await withTagSettings(
      ['bug', 'ui'],
      ['docs', 'bug'],
    );
    // The list stays shut until you ask for it.
    expect(texts('gr-tag-settings .summary')).toEqual(['2 tags on your list. Show']);
    expect(panel().querySelector('.tag')).toBeNull();
    toggle().click();
    await fixture.whenStable();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    const button = (label: string) =>
      panel().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const sent = (command: string) =>
      calls.filter((c) => c.command === command).map((c) => c.request);
    expect(texts('gr-tag-settings .tag')).toEqual(['bug', 'ui']);
    // A tag chats have that isn't on the list can be added to it.
    expect(texts('gr-tag-settings .others .gr-link')).toEqual(['+ docs']);

    button('Add docs to the list').click();
    button('Remove bug from the list').click();
    const field = await find(' later ');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(sent('history.setTagList')).toEqual([
      { tags: ['bug', 'ui', 'docs'] },
      { tags: ['ui'] },
      { tags: ['bug', 'ui', 'later'] },
    ]);
    expect(field.value).toBe('');

    // The list shows as the service keeps it, A to Z whatever its case.
    emit('history.tagListChanged', { tags: ['ui', 'Docs'] });
    await fixture.whenStable();
    expect(texts('gr-tag-settings .tag')).toEqual(['Docs', 'ui']);
    expect(texts('gr-tag-settings .others .gr-link')).toEqual(['+ bug']);

    // Renaming writes the new name in place; Esc keeps the old one.
    const rename = async (tag: string, to: string, key: string) => {
      button(`Rename ${tag}`).click();
      await fixture.whenStable();
      const name = panel().querySelector<HTMLInputElement>(`[aria-label="New name for ${tag}"]`)!;
      expect(document.activeElement).toBe(name);
      name.value = to;
      name.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    await rename('Docs', 'bug', 'Escape');
    await rename('Docs', 'Docs', 'Enter');
    await rename('Docs', ' bug ', 'Enter');
    expect(sent('history.renameTag')).toEqual([{ from: 'Docs', to: 'bug' }]);

    answers['history.setTagList'] = () => Promise.reject(new Error('gone'));
    button('Remove ui from the list').click();
    await fixture.whenStable();
    expect(texts('gr-tag-settings [role="alert"]')).toEqual([
      'The tag list couldn’t be kept: gone',
    ]);
  });

  it('finds tags, adds one the list hasn’t, and shows so many at a time', async () => {
    const many = Array.from({ length: TAGS_AT_ONCE + 5 }, (_, i) => `tag ${i + 1}`);
    const { calls, fixture, texts, panel, toggle, find } = await withTagSettings(many);
    toggle().click();
    await fixture.whenStable();
    expect(panel().querySelectorAll('.tag').length).toBe(TAGS_AT_ONCE);
    panel().querySelector<HTMLButtonElement>('.more')!.click();
    await fixture.whenStable();
    expect(panel().querySelectorAll('.tag').length).toBe(TAGS_AT_ONCE + 5);
    expect(panel().querySelector('.more')).toBeNull();

    // Finding narrows the list, whatever the case.
    await find('TAG 6');
    expect(texts('gr-tag-settings .tag')).toEqual([
      'tag 6',
      'tag 60',
      'tag 61',
      'tag 62',
      'tag 63',
      'tag 64',
      'tag 65',
    ]);
    // Enter adds only a tag the list hasn't.
    const field = await find('tag 6');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await find('nothing like it');
    expect(texts('gr-tag-settings .note')).toEqual([
      'Enter adds “nothing like it”.',
      'No tag on your list has “nothing like it”.',
    ]);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'history.setTagList').map((c) => c.request)).toEqual([
      { tags: [...many, 'nothing like it'] },
    ]);
    expect(field.value).toBe('');
  });
});
