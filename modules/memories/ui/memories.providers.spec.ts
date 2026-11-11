import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('memories.providers', () => {
  it('adds the Memory map page tab, which turns the right page to your agents’ memories', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Memory map');
    expect(texts('gr-tab-page .title')).toEqual(['Memory map']);
    expect(el.querySelector('gr-memories-page')).not.toBeNull();

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Memories']);
  });
});
