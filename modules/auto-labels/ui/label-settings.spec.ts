import type { LabelProgress } from '@grimoire/contract';
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
      'Past chats',
    ]);
    const on = (label: string) =>
      el.querySelector(`gr-label-settings [aria-labelledby="gr-settings-${label}"] .word`)!;
    expect(on('autoTitles').getAttribute('aria-checked')).toBe('false');
    (on('autoTags') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(on('autoTags').getAttribute('aria-checked')).toBe('true');
    expect(sent('settings.set')).toEqual([{ autoTags: true }]);
  });

  it('adds tags the agent suggests to the end of your tag list', async () => {
    const { click, sent, texts } = await withLabels((fake) => {
      fake.answers['labels.suggestTags'] = () => ['bug', 'ui', 'docs'];
      fake.answers['history.tagList'] = () => ['api'];
    });
    await click('Suggest tags from my chats');
    expect(texts('gr-label-settings .suggestions .gr-link')).toEqual([
      '+ bug',
      '+ ui',
      '+ docs',
      'Add them all',
    ]);
    await click('Add ui to the tag list');
    await click('Add them all');
    expect(sent('history.setTagList')).toEqual([
      { tags: ['api', 'ui'] },
      { tags: ['api', 'bug', 'docs'] },
    ]);
    expect(texts('gr-label-settings .suggestions')).toEqual(['No more tags to suggest.']);
  });

  it('labels past chats once you’ve seen how many, showing how far it’s come', async () => {
    const { click, sent, texts, emit, fixture, button, el } = await withLabels((fake) => {
      fake.answers['labels.pastCount'] = () => 12;
    });
    await click('Label past chats');
    expect(texts('gr-label-settings .state')).toEqual(['Label 12 past chats?']);
    // With every label off there's nothing to label them with.
    expect(button('Label them').disabled).toBe(true);
    await click('Cancel');

    el.querySelector<HTMLButtonElement>(
      'gr-label-settings [aria-labelledby="gr-settings-autoSummaries"] .word',
    )!.click();
    await fixture.whenStable();
    await click('Label past chats');
    await click('Label them');
    expect(sent('labels.pastCount')).toHaveLength(2);
    expect(sent('labels.labelPast')).toEqual([{}]);

    const progress = (p: LabelProgress) => emit('labels.progress', p);
    progress({ done: 3, total: 12, running: true });
    await fixture.whenStable();
    expect(texts('gr-label-settings .state')).toEqual(['3 of 12 labelled']);
    await click('Stop');
    expect(sent('labels.stopPast')).toEqual([{}]);
  });
});
