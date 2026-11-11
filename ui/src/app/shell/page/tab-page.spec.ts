import { TestBed } from '@angular/core/testing';
import { fakeBridge, render } from '../../../testing/app-testing';
import { RightPageState } from '../right-page/right-page-state';
import { provideShellEntries } from '../shell-registry';

describe('TabPage', () => {
  it('heads a page tab’s page with its label, blank until its feature is written, and turns back with Back or Esc', async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge, [
      provideShellEntries((shell) =>
        shell.pageTabs.add({ id: 'atlas', label: 'Atlas', order: 70 }),
      ),
    ]);
    const rightPage = TestBed.inject(RightPageState);
    rightPage.openPageTab('atlas');
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Atlas']);
    expect(texts('gr-tab-page .blank')).toEqual(['Not written yet.']);
    expect(texts('gr-tab-page .row .gr-link')).toEqual(['Back to the Outline Esc']);

    el.querySelector<HTMLButtonElement>('gr-tab-page .row .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();

    rightPage.openPageTab('atlas');
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();
  });

  it('leaves Esc to what inside took it first', async () => {
    const { fixture, el } = await render(fakeBridge().bridge, [
      provideShellEntries((shell) =>
        shell.pageTabs.add({ id: 'atlas', label: 'Atlas', order: 70 }),
      ),
    ]);
    TestBed.inject(RightPageState).openPageTab('atlas');
    await fixture.whenStable();
    const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    taken.preventDefault();
    document.dispatchEvent(taken);
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).not.toBeNull();
  });
});
