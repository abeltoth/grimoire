import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('workflow-setup.providers', () => {
  it('adds the Front matter page tab, which turns the right page to what your agents load', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Front matter');
    expect(texts('gr-tab-page .title')).toEqual(['Front matter']);
    expect(el.querySelector('gr-workflow-setup-page')).not.toBeNull();

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Workflow setup']);
  });
});
