import { TestBed } from '@angular/core/testing';
import { provideShellEntries } from './shell-registry';
import { fakeBridge, render } from '../../testing/app-harness';

describe('page-tabs', () => {
  it('shows the registered page tabs, then the command palette', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-page-tabs button')).toEqual([
      'Table of contents',
      'Front matter',
      'Kanban',
      'Memory map',
      'Scheduled chats',
      'Ledger',
      'Scriptorium',
      'Colophon',
      'Index Ctrl K',
    ]);
  });

  it('prints shortcuts the way the platform writes them', async () => {
    const mac = await render(fakeBridge({ platform: 'mac' }).bridge);
    expect(mac.el.querySelector('gr-page-tabs .command-palette')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Command K',
    );
    expect(mac.texts('gr-page-tabs .gr-kbd')).toEqual(['⌘K']);
    expect(mac.texts('gr-chat-tab.new i')).toEqual(['Last settings · ⌘N']);
    TestBed.resetTestingModule();

    const windows = await render(fakeBridge().bridge);
    expect(
      windows.el.querySelector('gr-page-tabs .command-palette')!.getAttribute('aria-label'),
    ).toBe('Index, the command palette. Control K');
    expect(windows.texts('gr-chat-tab.new i')).toEqual(['Last settings · Ctrl+N']);
  });

  it("turns the right page to a page tab's page, blank until its feature is written", async () => {
    const { fixture, el, texts } = await render(fakeBridge().bridge, [
      provideShellEntries((shell) =>
        shell.pageTabs.add({ id: 'atlas', label: 'Atlas', order: 70 }),
      ),
    ]);
    const atlas = [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')].find(
      (tab) => tab.textContent!.trim() === 'Atlas',
    )!;
    atlas.click();
    await fixture.whenStable();
    expect(atlas.getAttribute('aria-current')).toBe('page');
    expect(texts('gr-tab-page .title')).toEqual(['Atlas']);
    expect(texts('gr-tab-page .blank')).toEqual(['Not written yet.']);
    expect(texts('gr-tab-page .row .gr-link')).toEqual(['Back to the Outline Esc']);

    // Its tab again turns back, and so does Esc.
    atlas.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();
    atlas.click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-tab-page')).toBeNull();
    expect(atlas.getAttribute('aria-current')).toBeNull();
  });
});
