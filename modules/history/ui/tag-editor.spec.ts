import { fakeBridge, render, write } from '@ui/testing/app-testing';

describe('tag-editor', () => {
  it('suggests your tag list, then the tags other chats have, but not those on the chat', async () => {
    const { bridge, answers } = fakeBridge();
    answers['history.tagList'] = () => ['bug', 'ui'];
    answers['history.pinsAndTags'] = () => ({ pins: {}, tags: { other: ['docs', 'Bug'] } });
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'First');
    const options = () =>
      [...el.querySelectorAll<HTMLOptionElement>('gr-chat-tags datalist option')].map(
        (option) => option.value,
      );
    const add = async () => {
      el.querySelector<HTMLButtonElement>('gr-chat-tags .add')!.click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>('gr-chat-tags .field')!;
      expect(field.getAttribute('list')).toBe(
        el.querySelector('gr-chat-tags datalist')!.getAttribute('id'),
      );
      return field;
    };

    let field = await add();
    expect(options()).toEqual(['bug', 'ui', 'docs']);
    field.value = 'UI';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    field = await add();
    expect(options()).toEqual(['bug', 'docs']);
    // Nothing written keeps nothing.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect([...el.querySelectorAll('gr-chat-tags .tag')].map((t) => t.textContent!.trim())).toEqual(
      ['UI'],
    );
  });
});
