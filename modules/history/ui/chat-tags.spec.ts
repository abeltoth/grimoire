import { fakeBridge, render, write } from '@ui/testing/app-testing';

describe('chat-tags', () => {
  it('tags a chat in its page header, and takes tags off again', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const toggle = () => el.querySelector<HTMLButtonElement>('gr-chat-tags .toggle')!;
    const add = async (tag: string, key: string) => {
      el.querySelector<HTMLButtonElement>('gr-chat-tags .add')!.click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>('gr-chat-tags input')!;
      expect(document.activeElement).toBe(field);
      field.value = tag;
      field.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true }));
      await fixture.whenStable();
    };
    const tagCalls = () => calls.filter((c) => c.command === 'history.tag').map((c) => c.request);

    expect(toggle().getAttribute('aria-label')).toBe('Tag this chapter');
    expect(el.querySelector('gr-chat-tags .card')).toBeNull();
    toggle().click();
    await fixture.whenStable();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(el.querySelector('gr-chat-tags .add'));

    // A blank chat keeps its tags once it starts.
    await add('ui', 'Enter');
    expect(texts('gr-chat-tags .tag')).toEqual(['ui']);
    await write(fixture, el, 'First');
    expect(tagCalls()).toEqual([{ chatId: 'chat-1', tags: ['ui'] }]);

    // The started chat is another chat to the card, which closes.
    expect(el.querySelector('gr-chat-tags .card')).toBeNull();
    toggle().click();
    await fixture.whenStable();
    await add(' bug ', 'Enter');
    await add('UI', 'Enter');
    // Esc in the field puts the tag away, and leaves the card open.
    await add('later', 'Escape');
    expect(texts('gr-chat-tags .tag')).toEqual(['ui', 'bug']);
    expect(tagCalls()).toEqual([
      { chatId: 'chat-1', tags: ['ui'] },
      { chatId: 'chat-1', tags: ['ui', 'bug'] },
    ]);
    expect(document.activeElement).toBe(el.querySelector('gr-chat-tags .add'));

    el.querySelector<HTMLButtonElement>('[aria-label="Remove tag ui"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-chat-tags .tag')).toEqual(['bug']);
    expect(tagCalls().at(-1)).toEqual({ chatId: 'chat-1', tags: ['bug'] });
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
  });

  it('shows how many tags there are and names them, and Esc or a click elsewhere closes the card', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['history.pinsAndTags'] = () => ({ pins: {}, tags: { 'chat-1': ['ui', 'bug'] } });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    const toggle = () => el.querySelector<HTMLButtonElement>('gr-chat-tags .toggle')!;
    const open = async () => {
      toggle().click();
      await fixture.whenStable();
      expect(el.querySelector('gr-chat-tags .card')).not.toBeNull();
    };

    expect(texts('gr-chat-tags .count')).toEqual(['2']);
    expect(toggle().getAttribute('title')).toBe('Tags: ui, bug');

    // Esc closes the card and doesn't stop the running chat.
    await open();
    el.querySelector('gr-chat-tags .add')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-chat-tags .card')).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);

    await open();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-chat-tags .card')).toBeNull();
  });
});
