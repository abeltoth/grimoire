import { fakeBridge, render } from '../../testing/app-testing';

describe('right-page', () => {
  it('shows the first right page that can be picked', async () => {
    const { el, texts } = await render(fakeBridge().bridge);
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Outline']);
    expect(texts('.tabs [aria-disabled="true"]')).toEqual([]);
    expect(el.querySelector('gr-plan')).not.toBeNull();
  });
});
