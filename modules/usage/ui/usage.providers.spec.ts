import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('usage.providers', () => {
  it('adds the Ledger page tab, which turns the right page to your agents’ usage', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Ledger');
    expect(texts('gr-tab-page .title')).toEqual(['Ledger']);
    expect(el.querySelector('gr-usage-page')).not.toBeNull();

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Usage']);
  });
});
