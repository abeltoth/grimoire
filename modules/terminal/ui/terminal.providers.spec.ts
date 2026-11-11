import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('terminal.providers', () => {
  it('adds the Scriptorium page tab, which turns the right page to your shells', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Scriptorium');
    expect(texts('gr-tab-page .title')).toEqual(['Scriptorium']);
    expect(el.querySelector('gr-terminal-page')).not.toBeNull();

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Terminal']);
  });
});
