import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('page-tab-settings', () => {
  it('moves and hides the page tabs, but never Settings', async () => {
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
    const tabs = () => texts('gr-page-tabs .page-tab:not(.command-palette)');
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-page-tab-settings .name')).toEqual(tabs());
    expect(
      el.querySelector<HTMLButtonElement>(
        'gr-page-tab-settings [aria-label="Move Table of contents up"]',
      )!.disabled,
    ).toBe(true);
    expect(el.querySelector('gr-page-tab-settings [aria-label="Hide Colophon"]')).toBeNull();

    await press('Hide Marginalia');
    expect(tabs()).not.toContain('Marginalia');
    expect(texts('gr-page-tab-settings .hidden .name')).toEqual(['Marginalia']);

    await press('Move Colophon up');
    expect(tabs().slice(-2)).toEqual(['Colophon', 'Scriptorium']);

    await press('Show Marginalia');
    expect(tabs()).toContain('Marginalia');
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { pageTabsHidden: ['notes'] },
      {
        pageTabOrder: [
          'history',
          'workflow-setup',
          'kanban',
          'notes',
          'memories',
          'scheduled-chats',
          'usage',
          'settings',
          'terminals',
        ],
      },
      { pageTabsHidden: [] },
    ]);
  });
});
