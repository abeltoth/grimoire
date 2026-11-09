import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('chat-tags', () => {
  it('tags a chat in its page header, and takes tags off again', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const add = async (tag: string, key: string) => {
      el.querySelector<HTMLButtonElement>('gr-chat-tags .gr-link')!.click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>('gr-chat-tags input')!;
      expect(document.activeElement).toBe(field);
      field.value = tag;
      field.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      await fixture.whenStable();
    };
    const tagCalls = () => calls.filter((c) => c.command === 'agents.tag').map((c) => c.request);

    // A blank chat keeps its tags once it starts.
    await add('ui', 'Enter');
    expect(texts('gr-chat-tags .tag')).toEqual(['ui']);
    await write(fixture, el, 'First');
    expect(tagCalls()).toEqual([{ chatId: 'chat-1', tags: ['ui'] }]);

    await add(' bug ', 'Enter');
    await add('UI', 'Enter');
    await add('later', 'Escape');
    expect(texts('gr-chat-tags .tag')).toEqual(['ui', 'bug']);
    expect(tagCalls()).toEqual([
      { chatId: 'chat-1', tags: ['ui'] },
      { chatId: 'chat-1', tags: ['ui', 'bug'] },
    ]);
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
    expect(document.activeElement).toBe(el.querySelector('gr-chat-tags .gr-link'));

    el.querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-chat-tags .tag')).toEqual(['bug']);
    expect(tagCalls().at(-1)).toEqual({ chatId: 'chat-1', tags: ['bug'] });
  });
});
