import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

async function withLabels(setUp: (fake: ReturnType<typeof fakeBridge>) => void = () => {}) {
  const fake = fakeBridge();
  fake.answers['agents.list'] = () => [
    { id: 'claude-code', name: 'Claude Code', capabilities: ['ask'] },
  ];
  setUp(fake);
  const rendered = await render(fake.bridge);
  await openPageTab(rendered.fixture, rendered.el, 'Colophon');
  const button = (text: string) =>
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-label-settings button')].find(
      (b) => b.textContent!.trim() === text || b.getAttribute('aria-label') === text,
    )!;
  const click = async (text: string) => {
    button(text).click();
    await rendered.fixture.whenStable();
  };
  const sent = (command: string) =>
    fake.calls.filter((c) => c.command === command).map((c) => c.request);
  return { ...fake, ...rendered, button, click, sent };
}

describe('LabelSettings', () => {
  it('turns each label on or off, all off to begin with', async () => {
    const { texts, el, sent, fixture } = await withLabels();
    expect(texts('gr-label-settings .label')).toEqual([
      'Name chats',
      'Tag chats',
      'Sum up chats',
      'Tag list',
    ]);
    const on = (label: string) =>
      el.querySelector(`gr-label-settings [aria-labelledby="gr-settings-${label}"] .word`)!;
    expect(on('autoTitles').getAttribute('aria-checked')).toBe('false');
    (on('autoTags') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(on('autoTags').getAttribute('aria-checked')).toBe('true');
    expect(sent('settings.set')).toEqual([{ autoTags: true }]);
  });

  it('shows your tag list, and adds tags the agent suggests to the end of it', async () => {
    const { click, sent, texts, emit, fixture } = await withLabels((fake) => {
      fake.answers['labels.suggestTags'] = () => ['bug', 'API', 'ui', 'docs'];
      fake.answers['history.tagList'] = () => ['api'];
    });
    expect(texts('gr-label-settings .tag')).toEqual(['api']);
    await click('Suggest tags from my chats');
    // A tag already on the list isn't suggested again.
    expect(texts('gr-label-settings .suggestions .gr-link')).toEqual([
      '+ bug',
      '+ ui',
      '+ docs',
      'Add them all',
    ]);
    await click('Add ui to the tag list');
    emit('history.tagListChanged', { tags: ['api', 'ui'] });
    await fixture.whenStable();
    expect(texts('gr-label-settings .tag')).toEqual(['api', 'ui']);
    await click('Add them all');
    expect(sent('history.setTagList')).toEqual([
      { tags: ['api', 'ui'] },
      { tags: ['api', 'bug', 'docs'] },
    ]);
    emit('history.tagListChanged', { tags: ['api', 'ui', 'bug', 'docs'] });
    await fixture.whenStable();
    expect(texts('gr-label-settings .suggestions')).toEqual([
      'Every suggested tag is on your list.',
    ]);
  });
});
