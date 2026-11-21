import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('browser.providers', () => {
  it('adds the Atlas page tab, which turns the right page to the browser', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Atlas');
    expect(texts('gr-tab-page .title')).toEqual(['Atlas']);
    expect(el.querySelector('gr-browser-page')).not.toBeNull();

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Browser']);
  });
});
