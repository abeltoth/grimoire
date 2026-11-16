import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('page-tab-settings', () => {
  it('drags the page tabs into order and hides them, but never Settings', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const press = async (label: string) => {
      el.querySelector<HTMLButtonElement>(`gr-page-tab-settings [aria-label="${label}"]`)!.click();
      await fixture.whenStable();
    };
    const row = (name: string) =>
      [...el.querySelectorAll<HTMLElement>('gr-page-tab-settings li')].find(
        (li) => li.querySelector('.name')!.textContent!.trim() === name,
      )!;
    /** Drags one tab onto the upper or lower half of another, where jsdom puts every box at 0. */
    const drag = async (from: string, onto: string, half: 'upper' | 'lower') => {
      const target = row(onto);
      target.getBoundingClientRect = () => ({ top: 0, height: 20 }) as DOMRect;
      const at = { bubbles: true, clientY: half === 'upper' ? 5 : 15 };
      row(from).dispatchEvent(new Event('dragstart', { bubbles: true }));
      target.dispatchEvent(Object.assign(new Event('dragover', at), { clientY: at.clientY }));
      target.dispatchEvent(new Event('drop', { bubbles: true }));
      row(from).dispatchEvent(new Event('dragend', { bubbles: true }));
      await fixture.whenStable();
    };
    const tabs = () => texts('gr-page-tabs .page-tab:not(.command-palette)');
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-page-tab-settings .name')).toEqual(tabs());
    expect(el.querySelector('gr-page-tab-settings [aria-label="Hide Colophon"]')).toBeNull();

    await press('Hide Marginalia');
    expect(tabs()).not.toContain('Marginalia');
    expect(texts('gr-page-tab-settings .hidden .name')).toEqual(['Marginalia']);

    await drag('Colophon', 'Table of contents', 'upper');
    expect(tabs()[0]).toBe('Colophon');
    await drag('Kanban', 'Scriptorium', 'lower');
    expect(tabs().at(-1)).toBe('Kanban');
    // Dropped where it already is, it stays and nothing is kept.
    await drag('Ledger', 'Ledger', 'upper');

    await press('Show Marginalia');
    expect(tabs()).toContain('Marginalia');
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { pageTabsHidden: ['notes'] },
      {
        pageTabOrder: [
          'settings',
          'history',
          'workflow-setup',
          'kanban',
          'notes',
          'memories',
          'scheduled-chats',
          'usage',
          'terminals',
        ],
      },
      {
        pageTabOrder: [
          'settings',
          'history',
          'workflow-setup',
          'notes',
          'memories',
          'scheduled-chats',
          'usage',
          'terminals',
          'kanban',
        ],
      },
      { pageTabsHidden: [] },
    ]);
  });
});
