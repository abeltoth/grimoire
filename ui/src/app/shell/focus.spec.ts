import { fakeBridge, render } from '../../testing/app-testing';

describe('focus', () => {
  it('lays the chat alone on the desk at Single page, and brings everything back at Two pages', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);

    const shown = (selector: string) => el.querySelector(selector) !== null;

    [...el.querySelectorAll<HTMLButtonElement>('gr-right-page .gr-link')]
      .find((link) => link.textContent!.includes('Single page'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.classList).toContain('single');
    expect(shown('gr-title-bar')).toBe(false);
    expect(shown('gr-page-tabs')).toBe(false);
    expect(shown('gr-chat-tabs')).toBe(false);
    expect(shown('gr-right-page')).toBe(false);
    expect(shown('.desk.end gr-window-controls [aria-label="Close window"]')).toBe(true);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: true } });

    // The Command palette comes back beside the chat, and goes again with it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.classList).not.toContain('single');
    expect(shown('gr-right-page gr-command-palette')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(false);
    const labels = [...el.querySelectorAll('gr-command-palette .entry .label')].map((n) =>
      n.textContent!.trim(),
    );
    expect(labels).toContain('Two pages');
    expect(labels).not.toContain('Single page');
    expect(el.querySelector('gr-command-palette .gr-link')!.textContent).toContain(
      'Back to the single page',
    );
    expect(el.querySelector('gr-command-palette .hint')!.textContent).not.toContain('thumb notch');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(shown('gr-right-page')).toBe(false);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-header .gr-link')]
      .find((link) => link.textContent!.includes('Two pages'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).not.toContain('focus');
    expect(shown('gr-title-bar')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(true);
    expect(shown('gr-chat-tabs')).toBe(true);
    expect(shown('gr-right-page')).toBe(true);
    expect(shown('.desk')).toBe(false);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: false } });
  });

  it('opens at a single page when the book was left that way', async () => {
    const { bridge, answers } = fakeBridge();
    answers['layout.get'] = () => ({ current: null, lastUsed: null, focus: true });
    const { fixture, el } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.querySelector('gr-title-bar')).toBeNull();
    expect(el.querySelector('gr-right-page')).toBeNull();
  });
});
